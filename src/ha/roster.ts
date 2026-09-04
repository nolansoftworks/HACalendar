import type { HaClient } from "./client.js";
import type { Person, Roster } from "../people.js";

/**
 * The household roster, stored in Home Assistant itself ([ADR-0026]).
 *
 * **A person is an HA label; their calendar is the entity wearing it.**
 *
 * This replaces the `people.json` file. The file was operator config, which
 * meant SSH-ing to the server to add a child. Labels are editable from the app,
 * shared across every HA user and device, survive upgrades, need nothing in
 * this repo, and show up in HA's own UI where they can also be managed.
 *
 * Verified against HA 2026.7.2:
 *   - a label's `color` accepts an arbitrary hex string, not just HA's palette
 *   - `label_id` is **stable across a rename**, which is what [ADR-0021]
 *     requires of a person id -- it is what chore completions get logged
 *     against, so renaming "Emma" must not orphan her history
 *   - labels and entity-registry entries are both readable in one round trip
 */

/** Only labels attached to a calendar entity are people. */
export const CALENDAR_DOMAIN = "calendar.";

interface LabelEntry {
  label_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  description: string | null;
}

interface EntityEntry {
  entity_id: string;
  labels?: string[];
  name?: string | null;
  original_name?: string | null;
}

interface ConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
}

const FALLBACK_COLOR = "#0b7285";

/**
 * Read the roster: every label that is attached to exactly one calendar entity.
 *
 * A label with no calendar is not a person -- it is just an HA label someone
 * made for their own purposes, and this app must not claim it.
 */
export async function fetchRoster(
  client: HaClient,
  weekStartsOn = 0,
): Promise<Roster> {
  const [labels, entities] = await Promise.all([
    client.callWS<LabelEntry[]>({ type: "config/label_registry/list" }),
    client.callWS<EntityEntry[]>({ type: "config/entity_registry/list" }),
  ]);

  const calendarByLabel = new Map<string, string>();
  for (const entity of entities) {
    if (entity.entity_id.indexOf(CALENDAR_DOMAIN) !== 0) continue;
    for (const labelId of entity.labels ?? []) {
      // First calendar wins, so a label on two calendars stays deterministic.
      if (!calendarByLabel.has(labelId)) {
        calendarByLabel.set(labelId, entity.entity_id);
      }
    }
  }

  const people: Person[] = [];
  for (const label of labels) {
    const calendar = calendarByLabel.get(label.label_id);
    if (!calendar) continue;
    people.push({
      id: label.label_id,
      name: label.name,
      color: label.color ?? FALLBACK_COLOR,
      calendar,
    });
  }

  people.sort((a, b) => a.name.localeCompare(b.name));
  return { weekStartsOn, people };
}

/**
 * Add a person: create their label, create their calendar, link the two.
 *
 * The calendar is created through the config entry flow, which is the only
 * way `local_calendar` can be made -- it has no YAML form. That flow is REST,
 * not websocket, which is why `HaClient` carries `callApi`.
 *
 * Not transactional. If a later step fails, the earlier ones are undone so a
 * half-made person doesn't linger in HA's settings.
 */
export async function createPerson(
  client: HaClient,
  name: string,
  color: string,
): Promise<Person> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give this person a name.");

  const label = await client.callWS<LabelEntry>({
    type: "config/label_registry/create",
    name: trimmed,
    color,
  });

  let entryId: string | null = null;
  try {
    entryId = await createCalendar(client, trimmed);
    const entityId = await findCalendarEntity(client, entryId);
    await client.callWS({
      type: "config/entity_registry/update",
      entity_id: entityId,
      labels: [label.label_id],
    });
    return {
      id: label.label_id,
      name: trimmed,
      color,
      calendar: entityId,
    };
  } catch (err) {
    // Roll back so a failed add doesn't leave debris behind.
    await client
      .callWS({
        type: "config/label_registry/delete",
        label_id: label.label_id,
      })
      .catch(() => undefined);
    if (entryId) {
      await client
        .callApi("DELETE", `config/config_entries/entry/${entryId}`)
        .catch(() => undefined);
    }
    throw err;
  }
}

export async function updatePerson(
  client: HaClient,
  id: string,
  name: string,
  color: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give this person a name.");
  // Only the label changes. `label_id` is stable, so chore history survives a
  // rename -- which is the whole reason a person is a label and not a name.
  await client.callWS({
    type: "config/label_registry/update",
    label_id: id,
    name: trimmed,
    color,
  });
}

/**
 * Remove a person.
 *
 * `deleteCalendar` is opt-in and destructive: a `local_calendar` holds real
 * events, and deleting the config entry deletes them with it. The default
 * detaches the person and leaves their calendar in place, which is recoverable.
 */
export async function deletePerson(
  client: HaClient,
  person: Person,
  deleteCalendar = false,
): Promise<void> {
  if (person.calendar) {
    await client
      .callWS({
        type: "config/entity_registry/update",
        entity_id: person.calendar,
        labels: [],
      })
      .catch(() => undefined);
  }

  await client.callWS({
    type: "config/label_registry/delete",
    label_id: person.id,
  });

  if (deleteCalendar && person.calendar) {
    const entryId = await findConfigEntryFor(client, person.calendar);
    if (entryId) {
      await client.callApi("DELETE", `config/config_entries/entry/${entryId}`);
    }
  }
}

/** Drive the `local_calendar` config flow. Returns the new entry id. */
async function createCalendar(
  client: HaClient,
  calendarName: string,
): Promise<string> {
  const started = await client.callApi<{ flow_id: string; type: string }>(
    "POST",
    "config/config_entries/flow",
    { handler: "local_calendar", show_advanced_options: false },
  );
  const finished = await client.callApi<{
    type: string;
    result?: { entry_id: string };
    errors?: unknown;
  }>("POST", `config/config_entries/flow/${started.flow_id}`, {
    calendar_name: calendarName,
    import: "create_empty",
  });

  if (finished.type !== "create_entry" || !finished.result) {
    throw new Error(`Home Assistant would not create a calendar for ${calendarName}.`);
  }
  return finished.result.entry_id;
}

/**
 * The calendar entity belonging to a config entry.
 *
 * The entity appears a moment after the flow completes, so this retries
 * briefly rather than assuming it is registered by the time we look.
 */
async function findCalendarEntity(
  client: HaClient,
  entryId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const entities = await client.callWS<
      Array<EntityEntry & { config_entry_id?: string | null }>
    >({ type: "config/entity_registry/list" });
    const match = entities.filter(
      (entity) =>
        entity.config_entry_id === entryId &&
        entity.entity_id.indexOf(CALENDAR_DOMAIN) === 0,
    )[0];
    if (match) return match.entity_id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The calendar was created but never appeared.");
}

async function findConfigEntryFor(
  client: HaClient,
  entityId: string,
): Promise<string | null> {
  const entities = await client.callWS<
    Array<EntityEntry & { config_entry_id?: string | null }>
  >({ type: "config/entity_registry/list" });
  const match = entities.filter((e) => e.entity_id === entityId)[0];
  return match?.config_entry_id ?? null;
}

/** Calendars with no person attached -- offered when adopting an existing one. */
export async function fetchUnassignedCalendars(
  client: HaClient,
): Promise<Array<{ entityId: string; name: string }>> {
  const [entities, entries] = await Promise.all([
    client.callWS<Array<EntityEntry & { config_entry_id?: string | null }>>({
      type: "config/entity_registry/list",
    }),
    client
      .callWS<ConfigEntry[]>({ type: "config_entries/get" })
      .catch(() => [] as ConfigEntry[]),
  ]);
  const titleByEntry = new Map(entries.map((e) => [e.entry_id, e.title]));

  return entities
    .filter(
      (entity) =>
        entity.entity_id.indexOf(CALENDAR_DOMAIN) === 0 &&
        (entity.labels ?? []).length === 0,
    )
    .map((entity) => ({
      entityId: entity.entity_id,
      name:
        entity.name ??
        entity.original_name ??
        titleByEntry.get(entity.config_entry_id ?? "") ??
        entity.entity_id,
    }));
}
