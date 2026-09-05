import type { HaClient } from "./client.js";
import type { Roster } from "../people.js";
import { TODO_DOMAIN } from "./roster.js";

/**
 * Household lists: the shopping list, the packing list, whatever else.
 *
 * **A list is any `todo.*` entity that is not somebody's chore list.** That is
 * the whole rule, and it is deliberately subtractive: chore lists are claimed
 * by the roster ([ADR-0026]), and everything left over belongs here. So the
 * `todo.shopping_list` that Home Assistant already ships appears the moment
 * this screen exists, with nothing to configure -- and a list somebody makes in
 * HA's own settings shows up too.
 *
 * The items themselves are ordinary todo items, so `ha/chores.ts` already
 * speaks the protocol: add, complete, remove, subscribe, all by `uid`
 * ([ADR-0029]). Nothing is duplicated here.
 */

export interface HouseholdList {
  entityId: string;
  name: string;
}

interface EntityEntry {
  entity_id: string;
  name?: string | null;
  original_name?: string | null;
  config_entry_id?: string | null;
  hidden_by?: string | null;
  disabled_by?: string | null;
}

interface ConfigEntry {
  entry_id: string;
  title: string;
}

/**
 * Every list in the house, minus the chore lists.
 *
 * Takes the roster rather than fetching it, because the shell already has one
 * and a second registry round trip on every resubscribe would be waste.
 */
export async function fetchLists(
  client: HaClient,
  roster: Roster,
): Promise<HouseholdList[]> {
  const [entities, entries] = await Promise.all([
    client.callWS<EntityEntry[]>({ type: "config/entity_registry/list" }),
    client
      .callWS<ConfigEntry[]>({ type: "config_entries/get" })
      .catch(() => [] as ConfigEntry[]),
  ]);
  const titleByEntry = new Map(entries.map((e) => [e.entry_id, e.title]));

  const choreLists: string[] = [];
  for (const person of roster.people) {
    if (person.choreList) choreLists.push(person.choreList);
  }

  const lists: HouseholdList[] = [];
  for (const entity of entities) {
    if (entity.entity_id.indexOf(TODO_DOMAIN) !== 0) continue;
    if (choreLists.indexOf(entity.entity_id) !== -1) continue;
    // Somebody hid or disabled it in HA on purpose; honour that rather than
    // dragging it onto the kitchen wall.
    if (entity.hidden_by || entity.disabled_by) continue;

    lists.push({
      entityId: entity.entity_id,
      name:
        entity.name ??
        entity.original_name ??
        titleByEntry.get(entity.config_entry_id ?? "") ??
        entity.entity_id,
    });
  }

  lists.sort((a, b) => a.name.localeCompare(b.name));
  return lists;
}

/**
 * Make a new list.
 *
 * Same scriptable `local_todo` config flow the chore lists use, so a household
 * never has to leave the app to start a packing list. Deliberately unlabelled:
 * a label would make it somebody's chore list ([ADR-0026]).
 */
export async function createList(
  client: HaClient,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the list a name.");

  const started = await client.callApi<{ flow_id: string }>(
    "POST",
    "config/config_entries/flow",
    { handler: "local_todo", show_advanced_options: false },
  );
  const finished = await client.callApi<{
    type: string;
    result?: { entry_id: string };
  }>("POST", `config/config_entries/flow/${started.flow_id}`, {
    todo_list_name: trimmed,
  });
  if (finished.type !== "create_entry" || !finished.result) {
    throw new Error("Home Assistant would not create that list.");
  }

  const entryId = finished.result.entry_id;
  // The entity appears a moment after the flow completes.
  for (let attempt = 0; attempt < 12; attempt++) {
    const entities = await client.callWS<EntityEntry[]>({
      type: "config/entity_registry/list",
    });
    const match = entities.filter(
      (entity) =>
        entity.config_entry_id === entryId &&
        entity.entity_id.indexOf(TODO_DOMAIN) === 0,
    )[0];
    if (match) return match.entity_id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("It was created but never appeared.");
}
