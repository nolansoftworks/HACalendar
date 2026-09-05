import { parseHaDate, type HaCalendarEvent } from "../ha/calendar.js";

/**
 * Turning "every Tuesday" into an `RRULE`, and back into English.
 *
 * `todo` has no recurrence ([ADR-0008]), so a repeating chore is an all-day
 * `RRULE` event on the person's chore schedule calendar ([ADR-0030]) that the
 * nightly automation materializes. This module is the whole vocabulary: the
 * handful of repeats a household actually asks for, and no general recurrence
 * editor. Pure, so the rules can be pinned down in tests rather than argued
 * about in a Lit template.
 *
 * The strings produced here end up in an `.ics` file that Phase 6 will sync to
 * iCloud, so they stay RFC 5545-clean ([ADR-0009]) -- no `RRULE:` prefix, HA
 * adds that itself.
 */

export type RepeatChoice =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly";

/** In the order they are offered. `none` first: most chores are one-offs. */
export const REPEAT_CHOICES: RepeatChoice[] = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
];

/** RFC 5545 weekday codes, Sunday first, matching `Date.getDay()`. */
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The `RRULE` for a choice, anchored to the date the chore starts on.
 *
 * "Every week" means every week *on that day*, and "every month" means the
 * same date each month -- which is what somebody setting a chore up on a
 * Tuesday means, and it keeps the rule readable in HA's own calendar UI.
 *
 * Returns null for `none`, which is a one-off and never reaches a calendar.
 */
export function buildRrule(choice: RepeatChoice, date: string): string | null {
  // The date input can be empty mid-edit, and an empty string parses to an
  // Invalid Date -- which would silently produce `BYDAY=undefined`. Anchor to
  // today instead, so the picker always has something honest to show.
  const anchor = anchorDate(date);
  switch (choice) {
    case "none":
      return null;
    case "daily":
      return "FREQ=DAILY";
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${BYDAY[anchor.getDay()]}`;
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${anchor.getDate()}`;
  }
}

function anchorDate(date: string): Date {
  const parsed = parseHaDate(date);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** How a choice reads in the picker, once a date is known. */
export function describeChoice(choice: RepeatChoice, date: string): string {
  if (choice === "none") return "Just once";
  const rrule = buildRrule(choice, date);
  return rrule ? describeRrule(rrule) : "Just once";
}

/**
 * An `RRULE` in words, for a child reading the chore board.
 *
 * Anything this app did not write -- a rule made in HA's own calendar editor,
 * or an `.ics` that arrived over Phase 6's sync -- falls back to "Repeats"
 * rather than to jargon. Saying less is better than showing `FREQ=YEARLY`
 * on the kitchen wall.
 */
export function describeRrule(rrule: string): string {
  const parts = new Map<string, string>();
  for (const chunk of rrule.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    parts.set(
      chunk.slice(0, eq).trim().toUpperCase(),
      chunk.slice(eq + 1).trim().toUpperCase(),
    );
  }

  // An INTERVAL or a COUNT/UNTIL means it is not one of ours; say less.
  const plain = !parts.has("INTERVAL") && !parts.has("COUNT");
  const freq = parts.get("FREQ");
  const byDay = parts.get("BYDAY");
  const byMonthDay = parts.get("BYMONTHDAY");

  if (plain && freq === "DAILY" && !byDay) return "Every day";
  if (plain && freq === "WEEKLY" && byDay) {
    if (byDay === "MO,TU,WE,TH,FR") return "Weekdays";
    const days = byDay.split(",");
    if (days.length === 1) {
      const index = BYDAY.indexOf(days[0]!);
      if (index !== -1) return `Every ${DAY_NAMES[index]}`;
    }
  }
  if (plain && freq === "MONTHLY" && byMonthDay) {
    const day = Number(byMonthDay);
    if (day >= 1 && day <= 31) return `Monthly on the ${ordinal(day)}`;
  }
  return "Repeats";
}

/** 1 -> "1st", 22 -> "22nd". Only ever called with 1..31. */
export function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  const suffix = ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `${day}${suffix}`;
}

/** One repeating chore, as the board shows it. */
export interface ChoreRule {
  uid: string;
  summary: string;
  /** Absent on a one-off event somebody put on the schedule calendar by hand. */
  rrule?: string;
  /** In words: "Every Tuesday", or the date when it does not repeat at all. */
  cadence: string;
}

/**
 * Collapse a subscription window into one row per rule.
 *
 * `calendar/event/subscribe` returns one entry per *instance* -- a daily chore
 * over a six-week window arrives forty times, all sharing a `uid`. The board
 * shows the rule, not its instances, so the first of each uid wins.
 *
 * A dateless one-off that somebody added on the schedule calendar directly is
 * kept rather than hidden: it will still materialize, so it has to be
 * deletable from the same place.
 */
export function choreRules(events: readonly HaCalendarEvent[]): ChoreRule[] {
  const seen: string[] = [];
  const rules: ChoreRule[] = [];
  for (const event of events) {
    const uid = event.uid;
    if (!uid || seen.indexOf(uid) !== -1) continue;
    seen.push(uid);
    rules.push({
      uid,
      summary: event.summary,
      ...(event.rrule ? { rrule: event.rrule } : {}),
      cadence: event.rrule ? describeRrule(event.rrule) : onceOn(event.start),
    });
  }
  return rules.sort((a, b) => a.summary.localeCompare(b.summary));
}

function onceOn(start: string): string {
  const date = parseHaDate(start);
  return `Once, ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}
