import type { ChoreItem } from "../ha/chores.js";

/**
 * Ordering for a household list.
 *
 * A list is not a chore board, and the difference is the whole reason this is
 * its own module. Chores sort by urgency ([ADR-0013]); a shopping list sorts
 * by *nothing* — it stays in the order somebody typed it, because that order
 * is information. "Milk, eggs, bread" was written walking the aisles, and
 * re-sorting it alphabetically to "bread, eggs, milk" throws that away and
 * makes the list move under a finger already reaching for a row.
 *
 * So the only thing that moves is a ticked item, and it moves once: down.
 */

export interface ListProgress {
  done: number;
  total: number;
  left: number;
}

export function isTicked(item: ChoreItem): boolean {
  return item.status === "completed";
}

/**
 * Outstanding items first, in the order they were added; ticked ones after,
 * also in the order they were added.
 *
 * `Array.prototype.sort` is stable, so a comparator that only knows about
 * done-ness leaves everything else exactly where HA had it.
 */
export function sortListItems(items: ChoreItem[]): ChoreItem[] {
  return items
    .slice()
    .sort((a, b) => (isTicked(a) ? 1 : 0) - (isTicked(b) ? 1 : 0));
}

export function listProgress(items: ChoreItem[]): ListProgress {
  let done = 0;
  for (const item of items) {
    if (isTicked(item)) done++;
  }
  return { done, total: items.length, left: items.length - done };
}

/**
 * What the column header says under the list's name.
 *
 * Words, not a fraction, because the person reading it is picking a list to
 * shop from and "4 left" answers that in one glance. An empty list says so
 * rather than saying "0 left", which reads like something went wrong.
 */
export function listSummary(items: ChoreItem[]): string {
  const { done, total, left } = listProgress(items);
  if (total === 0) return "Empty";
  if (left === 0) return "All done";
  if (done === 0) return left + (left === 1 ? " thing" : " things");
  return left + " left";
}

/**
 * Clean up what somebody typed into the add row.
 *
 * Returns null for anything not worth adding, so the caller has one thing to
 * check. Whitespace collapses: pasting from a notes app is a normal way to
 * fill a list, and a literal newline inside a todo summary comes back from HA
 * looking like a broken row.
 */
export function cleanEntry(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}
