import type { HaClient } from "./client.js";
import type { Roster } from "../people.js";
import {
  TODO_DOMAIN,
  createEntry,
  findConfigEntryFor,
  findEntity,
} from "./roster.js";

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

  const entryId = await createEntry(client, "local_todo", {
    todo_list_name: trimmed,
  });
  try {
    return await findEntity(client, entryId, TODO_DOMAIN);
  } catch (err) {
    // Half-made is worse than not made: roll the entry back rather than
    // leaving an invisible list behind.
    await client
      .callApi("DELETE", `config/config_entries/entry/${entryId}`)
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Delete a list and everything on it.
 *
 * Removing the config entry is the only real delete `local_todo` has, and it
 * takes the items with it. Refuses a chore list outright: those belong to a
 * person ([ADR-0026]) and deleting one from here would silently strip somebody
 * of their chores, which is the roster's business and Settings' screen.
 */
export async function deleteList(
  client: HaClient,
  entityId: string,
  roster: Roster,
): Promise<void> {
  for (const person of roster.people) {
    if (person.choreList === entityId) {
      throw new Error(`That is ${person.name}'s chore list. Remove it in Settings.`);
    }
  }
  const entryId = await findConfigEntryFor(client, entityId);
  if (!entryId) {
    throw new Error("Home Assistant will not let that list be removed.");
  }
  await client.callApi("DELETE", `config/config_entries/entry/${entryId}`);
}
