import type { ChoreItem } from "../ha/chores.js";
import { parseHaDate } from "../ha/calendar.js";
import { startOfDay } from "./grid.js";

/**
 * Ordering and overdue-ness for a chore list.
 *
 * Pure, so the rules a child sees can be pinned down in tests rather than
 * argued about — particularly "overdue", which per [ADR-0013] is the whole
 * accountability signal and must never be quietly reset.
 */

export interface ChoreProgress {
  done: number;
  total: number;
  overdue: number;
  dueToday: number;
}

export const NO_PROGRESS: ChoreProgress = {
  done: 0,
  total: 0,
  overdue: 0,
  dueToday: 0,
};

export function isDone(item: ChoreItem): boolean {
  return item.status === "completed";
}

/**
 * Past its due date and still not done.
 *
 * Due *today* is not overdue — a child has all day. Only yesterday and earlier
 * count, which is what makes the label mean something when it appears.
 */
export function isOverdue(item: ChoreItem, now: Date): boolean {
  if (isDone(item) || !item.due) return false;
  return parseHaDate(item.due).getTime() < startOfDay(now).getTime();
}

export function isDueToday(item: ChoreItem, now: Date): boolean {
  if (!item.due) return false;
  return parseHaDate(item.due).getTime() === startOfDay(now).getTime();
}

/** How many days late, for "3 days late" rather than a bare red flag. */
export function daysOverdue(item: ChoreItem, now: Date): number {
  if (!isOverdue(item, now)) return 0;
  const due = parseHaDate(item.due!).getTime();
  const today = startOfDay(now).getTime();
  return Math.round((today - due) / 86_400_000);
}

export function choreProgress(items: ChoreItem[], now: Date): ChoreProgress {
  let done = 0;
  let overdue = 0;
  let dueToday = 0;
  for (const item of items) {
    if (isDone(item)) done++;
    if (isOverdue(item, now)) overdue++;
    if (isDueToday(item, now) && !isDone(item)) dueToday++;
  }
  return { done, total: items.length, overdue, dueToday };
}

/**
 * Reading order for a child scanning their list:
 *
 *   1. still to do, overdue first and longest-overdue at the top
 *   2. then everything else still to do, soonest due first, undated last
 *   3. completed, at the bottom, so ticking something off moves it out of the way
 *
 * Stable within a group by name, so the list does not reshuffle on every push.
 */
export function sortChores(items: ChoreItem[], now: Date): ChoreItem[] {
  return items.slice().sort((a, b) => {
    const doneA = isDone(a) ? 1 : 0;
    const doneB = isDone(b) ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;

    if (!isDone(a)) {
      const lateA = daysOverdue(a, now);
      const lateB = daysOverdue(b, now);
      if (lateA !== lateB) return lateB - lateA;

      const dueA = a.due ? parseHaDate(a.due).getTime() : Infinity;
      const dueB = b.due ? parseHaDate(b.due).getTime() : Infinity;
      if (dueA !== dueB) return dueA - dueB;
    }
    return a.summary.localeCompare(b.summary);
  });
}

/**
 * An existing item with the same name, if any.
 *
 * Used to *mention* a duplicate, never to refuse one: items are addressed by
 * uid, so duplicates break nothing ([ADR-0029]). Two identical rows are just
 * confusing to read.
 */
export function findDuplicate(
  items: ChoreItem[],
  summary: string,
): ChoreItem | null {
  const wanted = summary.trim().toLowerCase();
  if (!wanted) return null;
  return (
    items.filter(
      (item) => !isDone(item) && item.summary.trim().toLowerCase() === wanted,
    )[0] ?? null
  );
}
