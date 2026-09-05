import { addDays, startOfMonth, startOfWeek } from "./grid.js";

/**
 * What the header says you are looking at.
 *
 * Day columns carry their own dates, but nothing on screen said *which* week or
 * month — so a glance could not tell September's first week from October's.
 *
 * Pure, and the locale is a parameter so tests can pin the language while the
 * app still follows the device.
 */

/** `September 2026`. */
export function monthLabel(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

/**
 * A week as a readable span, collapsing whatever the two ends share.
 *
 *   same month   `September 6 – 12, 2026`
 *   same year    `August 30 – September 5, 2026`
 *   across years `December 27, 2026 – January 2, 2027`
 *
 * `end` is the **last day shown**, not an exclusive bound — this is a label for
 * people, and "– January 3rd" when the 3rd is not on screen would be a lie.
 */
export function weekRangeLabel(start: Date, end: Date, locale?: string): string {
  const month = (d: Date) => d.toLocaleDateString(locale, { month: "long" });
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${month(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    return (
      `${month(start)} ${start.getDate()} – ` +
      `${month(end)} ${end.getDate()}, ${end.getFullYear()}`
    );
  }
  return (
    `${month(start)} ${start.getDate()}, ${start.getFullYear()} – ` +
    `${month(end)} ${end.getDate()}, ${end.getFullYear()}`
  );
}

/** The header label for whichever view is showing. */
export function viewLabel(
  view: "week" | "month",
  cursor: Date,
  weekStartsOn = 0,
  days = 7,
  locale?: string,
): string {
  if (view === "month") return monthLabel(startOfMonth(cursor), locale);
  const start = startOfWeek(cursor, weekStartsOn);
  return weekRangeLabel(start, addDays(start, days - 1), locale);
}
