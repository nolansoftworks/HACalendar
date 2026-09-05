import { test } from "node:test";
import assert from "node:assert/strict";
import type { HaCalendarEvent } from "../ha/calendar.js";
import {
  buildRrule,
  choreRules,
  describeChoice,
  describeRrule,
  ordinal,
} from "./repeat-rule.js";

/**
 * The recurrence vocabulary, pinned down without a DOM.
 *
 * These strings are written into an `.ics` file that Phase 6 syncs to iCloud,
 * so a wrong `BYDAY` is not a display bug — it silently moves a child's chore
 * to a different day of the week, and the nightly automation then never
 * materializes it on the day anyone expects.
 */

// A Friday, chosen so the weekday is not the same as the month day.
const FRIDAY = "2026-09-04";
// A Sunday, which is index 0 -- the value a falsy check would eat.
const SUNDAY = "2026-09-06";

test("weekly repeats on the day it starts", () => {
  assert.equal(buildRrule("weekly", FRIDAY), "FREQ=WEEKLY;BYDAY=FR");
  assert.equal(buildRrule("weekly", SUNDAY), "FREQ=WEEKLY;BYDAY=SU");
});

test("monthly repeats on the date it starts", () => {
  assert.equal(buildRrule("monthly", FRIDAY), "FREQ=MONTHLY;BYMONTHDAY=4");
  assert.equal(
    buildRrule("monthly", "2026-01-31"),
    "FREQ=MONTHLY;BYMONTHDAY=31",
  );
});

test("daily and weekdays do not depend on the start date", () => {
  assert.equal(buildRrule("daily", FRIDAY), "FREQ=DAILY");
  assert.equal(buildRrule("daily", SUNDAY), "FREQ=DAILY");
  assert.equal(
    buildRrule("weekdays", SUNDAY),
    "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  );
});

test("a one-off produces no rule at all", () => {
  assert.equal(buildRrule("none", FRIDAY), null);
});

test("an empty date never yields BYDAY=undefined", () => {
  // The date input is empty for as long as it takes to clear and retype it,
  // and a rule built then would be accepted by HA and silently never fire.
  const rule = buildRrule("weekly", "");
  assert.match(rule!, /^FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)$/);
  assert.match(buildRrule("monthly", "")!, /^FREQ=MONTHLY;BYMONTHDAY=\d{1,2}$/);
});

test("rules read back as the words that made them", () => {
  assert.equal(describeRrule("FREQ=DAILY"), "Every day");
  assert.equal(describeRrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), "Weekdays");
  assert.equal(describeRrule("FREQ=WEEKLY;BYDAY=TU"), "Every Tuesday");
  assert.equal(describeRrule("FREQ=WEEKLY;BYDAY=SU"), "Every Sunday");
  assert.equal(
    describeRrule("FREQ=MONTHLY;BYMONTHDAY=22"),
    "Monthly on the 22nd",
  );
});

test("a rule this app did not write says less rather than jargon", () => {
  // Made in HA's own calendar editor, or arrived over Phase 6's sync. The
  // kitchen wall must never show FREQ=YEARLY.
  assert.equal(describeRrule("FREQ=YEARLY"), "Repeats");
  assert.equal(describeRrule("FREQ=DAILY;INTERVAL=2"), "Repeats");
  assert.equal(describeRrule("FREQ=WEEKLY;BYDAY=MO,WE"), "Repeats");
  assert.equal(describeRrule("FREQ=WEEKLY;BYDAY=TU;COUNT=4"), "Repeats");
  assert.equal(describeRrule(""), "Repeats");
});

test("a rule survives the round trip through words", () => {
  const rule = buildRrule("weekly", FRIDAY)!;
  assert.equal(describeRrule(rule), "Every Friday");
  assert.equal(describeChoice("weekly", FRIDAY), "Every Friday");
  assert.equal(describeChoice("none", FRIDAY), "Just once");
});

test("ordinals read the way a child says them", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"],
  );
});

const instance = (
  uid: string,
  summary: string,
  start: string,
  rrule?: string,
): HaCalendarEvent => ({
  uid,
  summary,
  start,
  end: start,
  all_day: true,
  ...(rrule ? { rrule } : {}),
});

test("a window of instances collapses to one row per rule", () => {
  // A daily chore arrives once per day over the whole window. The board shows
  // the rule, not forty copies of it.
  const events = [
    instance("a", "Feed the dog", "2026-09-04", "FREQ=DAILY"),
    instance("a", "Feed the dog", "2026-09-05", "FREQ=DAILY"),
    instance("a", "Feed the dog", "2026-09-06", "FREQ=DAILY"),
    instance("b", "Bins", "2026-09-08", "FREQ=WEEKLY;BYDAY=TU"),
  ];
  const rules = choreRules(events);
  assert.deepEqual(
    rules.map((r) => [r.summary, r.cadence]),
    [
      ["Bins", "Every Tuesday"],
      ["Feed the dog", "Every day"],
    ],
  );
});

test("a one-off left on the schedule calendar is still listed", () => {
  // It will materialize, so it has to be cancellable from the same place.
  const rules = choreRules([instance("c", "Rake leaves", "2026-09-04")]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.rrule, undefined);
  assert.match(rules[0]!.cadence, /^Once, /);
});

test("an event with no uid is skipped rather than shown undeletable", () => {
  const events = [
    { summary: "Ghost", start: "2026-09-04", end: "2026-09-05", all_day: true },
  ] as HaCalendarEvent[];
  assert.deepEqual(choreRules(events), []);
});
