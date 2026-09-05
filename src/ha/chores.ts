import type { HaClient } from "./client.js";

/**
 * Chore lists, on top of HA's `todo` domain.
 *
 * **Every item is addressed by `uid`, never by name** ([ADR-0029]). Items do
 * carry uids and `update_item`/`remove_item` accept them; passing a *name*
 * while a duplicate exists is accepted, returns no error, and silently does
 * nothing. That is the trap, and it is why nothing in this file takes a
 * summary as an identifier.
 *
 * `add_item` cannot set a uid, so a freshly added item's uid is only knowable
 * by reading the list back — which the subscription does anyway.
 */

export interface ChoreItem {
  summary: string;
  /** Present on every item HA returns. The only safe way to address one. */
  uid: string;
  status: "needs_action" | "completed";
  /** `YYYY-MM-DD` when set. Absent otherwise -- HA omits empty fields. */
  due?: string;
  description?: string;
}

interface ItemsMessage {
  items: ChoreItem[];
}

/**
 * Stream a chore list. HA pushes the whole list on every change, exactly like
 * `calendar/event/subscribe`, so the callback replaces state rather than
 * merging. Returns an unsubscribe function -- callers must store it.
 */
export function subscribeChores(
  client: HaClient,
  entityId: string,
  callback: (items: ChoreItem[]) => void,
): Promise<() => Promise<void>> {
  return client.subscribeMessage<ItemsMessage>(
    (message) => callback(message.items ?? []),
    { type: "todo/item/subscribe", entity_id: entityId },
  );
}

/** One-shot read, for when a subscription is more than the caller needs. */
export async function listChores(
  client: HaClient,
  entityId: string,
): Promise<ChoreItem[]> {
  const result = await client.callWS<ItemsMessage>({
    type: "todo/item/list",
    entity_id: entityId,
  });
  return result.items ?? [];
}

export function addChore(
  client: HaClient,
  entityId: string,
  summary: string,
  dueDate?: string,
): Promise<unknown> {
  return client.callService("todo", "add_item", {
    entity_id: entityId,
    item: summary,
    ...(dueDate ? { due_date: dueDate } : {}),
  });
}

/**
 * Tick a chore off, or un-tick it.
 *
 * `item` is the **uid**. Never pass `summary` here; see the file header.
 */
export function setChoreStatus(
  client: HaClient,
  entityId: string,
  uid: string,
  status: ChoreItem["status"],
): Promise<unknown> {
  return client.callService("todo", "update_item", {
    entity_id: entityId,
    item: uid,
    status,
  });
}

/** Remove one item, by uid. Does not need the unfiltered sweep ([ADR-0022]). */
export function removeChore(
  client: HaClient,
  entityId: string,
  uid: string,
): Promise<unknown> {
  return client.callService("todo", "remove_item", {
    entity_id: entityId,
    item: uid,
  });
}

/**
 * Record *who* completed a chore ([ADR-0014]).
 *
 * The chore lives on its owner's list; this says who actually did it, which is
 * a different question -- a sibling can empty the dishwasher. `name` is the
 * roster id, never the display name, so renaming someone keeps their history
 * ([ADR-0021]).
 */
export function logCompletion(
  client: HaClient,
  personId: string,
  summary: string,
  entityId: string,
): Promise<unknown> {
  return client.callService("logbook", "log", {
    name: personId,
    message: `completed ${summary}`,
    entity_id: entityId,
  });
}
