import type { HaCalendarEvent } from "../ha/calendar.js";
import { parseHaDate } from "../ha/calendar.js";

/**
 * Pure month-grid maths. No lit, no DOM, no custom element registration --
 * deliberately, so this can be unit-tested in Node.
 *
 * It used to live inside month-view.ts, where verifying it meant copying it
 * into a scratch harness (which tests a copy, not the code). Everything here
 * is a pure function of its arguments and the ambient timezone.
 */

export const WEEKS_SHOWN = 6;
export const DAYS_PER_WEEK = 7;

const WEEKDAY_LABELS_SUNDAY_FIRST = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

/** An event tagged with which calendar -- and therefore which person -- owns it. */
export interface OwnedEvent extends HaCalendarEvent {
  /** Roster person id, or `FAMILY_OWNER_ID` for the shared calendar. */
  ownerId: string;
  color: string;
}

export interface DayCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  events: OwnedEvent[];
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Weekday headings rotated so index 0 is `weekStartsOn` (0 = Sunday). */
export function weekdayLabels(weekStartsOn: number): string[] {
  const offset = normalizeWeekStart(weekStartsOn);
  const labels: string[] = [];
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    labels.push(WEEKDAY_LABELS_SUNDAY_FIRST[(offset + i) % DAYS_PER_WEEK]!);
  }
  return labels;
}

function normalizeWeekStart(weekStartsOn: number): number {
  if (!Number.isFinite(weekStartsOn)) return 0;
  return ((Math.trunc(weekStartsOn) % DAYS_PER_WEEK) + DAYS_PER_WEEK) %
    DAYS_PER_WEEK;
}

/**
 * The 6x7 window the grid displays, which spills past the month on both ends.
 * `weekStartsOn` shifts which weekday the grid opens on ([ADR-0021]).
 */
export function visibleRange(
  cursor: Date,
  weekStartsOn = 0,
): { start: Date; end: Date } {
  const offset = normalizeWeekStart(weekStartsOn);
  const lead = (cursor.getDay() - offset + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const start = addDays(cursor, -lead);
  return { start, end: addDays(start, WEEKS_SHOWN * DAYS_PER_WEEK) };
}

export function buildGrid(
  cursor: Date,
  events: OwnedEvent[],
  weekStartsOn = 0,
  today = new Date(),
): DayCell[] {
  const { start } = visibleRange(cursor, weekStartsOn);
  const cells: DayCell[] = [];

  for (let i = 0; i < WEEKS_SHOWN * DAYS_PER_WEEK; i++) {
    const date = addDays(start, i);
    cells.push({
      date,
      inMonth: date.getMonth() === cursor.getMonth(),
      isToday: sameDay(date, today),
      events: eventsOnDay(events, date),
    });
  }
  return cells;
}

/**
 * Events overlapping `day`. HA sends `end` exclusive, so an all-day event on
 * the 9th arrives as start=09, end=10 and must not bleed into the 10th.
 */
export function eventsOnDay<T extends HaCalendarEvent>(
  events: T[],
  day: Date,
): T[] {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();

  return events
    .filter((event) => {
      const start = parseHaDate(event.start).getTime();
      const end = parseHaDate(event.end).getTime();
      return start < dayEnd && end > dayStart;
    })
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return parseHaDate(a.start).getTime() - parseHaDate(b.start).getTime();
    });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Black or white, whichever stays readable on `hex`.
 *
 * Roster colors are author-chosen ([ADR-0021]) and range from pale to very
 * dark, so a fixed chip text color would be unreadable at one end. Uses the
 * sRGB luma coefficients; good enough for a chip and cheap on a Pi.
 */
/**
 * A person's color at low opacity, for event blocks.
 *
 * The time grid tints a block with its owner's color rather than filling it,
 * so a dense day stays readable and the text stays black. `rgba()` rather than
 * `color-mix()`, which is far newer than the Chrome 87 floor ([ADR-0003]).
 */
export function tint(hex: string, alpha: number): string {
  const parsed = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!parsed) return `rgba(11, 114, 133, ${alpha})`;
  const value = parseInt(parsed[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function readableTextOn(hex: string): string {
  const parsed = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!parsed) return "#1c1c1c";
  const value = parseInt(parsed[1]!, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#1c1c1c" : "#ffffff";
}
