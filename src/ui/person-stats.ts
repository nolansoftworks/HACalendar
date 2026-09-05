import { parseHaDate } from "../ha/calendar.js";
import { addDays, startOfDay, type OwnedEvent } from "./grid.js";

/**
 * Per-person counts for the header strip.
 *
 * Everything is scoped to whatever the view is currently showing, because the
 * subscription window *is* the view window — switching from week to month
 * re-subscribes, so "total" always means "in what you are looking at".
 *
 * Pure and DOM-free so the edge cases (an all-day event on today, an event
 * that ended an hour ago) can be pinned down in tests rather than argued about.
 */

export interface PersonStats {
  /** Events for this person anywhere in the visible range. */
  total: number;
  /** Already finished: the event's end has passed. */
  past: number;
  /** Overlapping today, whether or not they have happened yet. */
  today: number;
}

export const EMPTY_STATS: PersonStats = { total: 0, past: 0, today: 0 };

export function personStats(
  events: OwnedEvent[],
  ownerId: string,
  now: Date,
): PersonStats {
  const dayStart = startOfDay(now).getTime();
  const dayEnd = addDays(startOfDay(now), 1).getTime();
  const current = now.getTime();

  let total = 0;
  let past = 0;
  let today = 0;

  for (const event of events) {
    if (event.ownerId !== ownerId) continue;
    total++;

    const start = parseHaDate(event.start).getTime();
    const end = parseHaDate(event.end).getTime();

    // HA's `end` is exclusive, so an all-day event on the 3rd ends at 00:00 on
    // the 4th and is genuinely over then -- not a moment before.
    if (end <= current) past++;
    if (start < dayEnd && end > dayStart) today++;
  }

  return { total, past, today };
}
