import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGrid,
  eventsOnDay,
  readableTextOn,
  visibleRange,
  weekdayLabels,
  type OwnedEvent,
} from "./grid.js";

/**
 * These assertions are deliberately timezone-independent.
 *
 * Everything here works in local time, which is the whole point of
 * `parseHaDate()`: an all-day event on the 1st must land on the 1st in *any*
 * timezone. So these hold on CI in UTC and on the wall Pi in Central alike,
 * and they still catch the bug they exist for -- a regression to bare
 * `new Date("2026-09-01")` fails these anywhere west of Greenwich.
 */

function ev(
  summary: string,
  start: string,
  end: string,
  all_day = true,
  ownerId = "__family",
): OwnedEvent {
  return { summary, start, end, all_day, ownerId, color: "#0b7285" };
}

test("all-day event lands on its own day, not the day before", () => {
  const events = [ev("first", "2026-09-01", "2026-09-02")];
  assert.equal(eventsOnDay(events, new Date(2026, 7, 31)).length, 0, "Aug 31");
  assert.equal(eventsOnDay(events, new Date(2026, 8, 1)).length, 1, "Sep 1");
  assert.equal(eventsOnDay(events, new Date(2026, 8, 2)).length, 0, "Sep 2");
});

test("all-day event on the last of the month does not bleed into the next", () => {
  const events = [ev("last", "2026-09-30", "2026-10-01")];
  assert.equal(eventsOnDay(events, new Date(2026, 8, 29)).length, 0);
  assert.equal(eventsOnDay(events, new Date(2026, 8, 30)).length, 1);
  assert.equal(eventsOnDay(events, new Date(2026, 9, 1)).length, 0);
});

test("multi-day event honours HA's exclusive end", () => {
  const events = [ev("trip", "2026-09-10", "2026-09-13")];
  const on = (d: number) => eventsOnDay(events, new Date(2026, 8, d)).length;
  assert.equal(on(9), 0, "starts on the 10th");
  assert.equal(on(10), 1);
  assert.equal(on(11), 1);
  assert.equal(on(12), 1);
  assert.equal(on(13), 0, "end is exclusive");
});

test("all-day events sort before timed ones", () => {
  const events = [
    ev("timed", "2026-09-15T09:30:00-05:00", "2026-09-15T10:30:00-05:00", false),
    ev("allday", "2026-09-15", "2026-09-16"),
  ];
  const [first, second] = eventsOnDay(events, new Date(2026, 8, 15));
  assert.equal(first?.summary, "allday");
  assert.equal(second?.summary, "timed");
});

test("visibleRange starts on Sunday when weekStartsOn is 0", () => {
  // Sep 2026 starts on a Tuesday, so the grid opens on Sun Aug 30.
  const { start, end } = visibleRange(new Date(2026, 8, 1), 0);
  assert.equal(start.getDay(), 0);
  assert.equal(start.getMonth(), 7);
  assert.equal(start.getDate(), 30);
  assert.equal(Math.round((end.getTime() - start.getTime()) / 86400000), 42);
});

test("visibleRange starts on Monday when weekStartsOn is 1", () => {
  const { start } = visibleRange(new Date(2026, 8, 1), 1);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 31);
  assert.equal(start.getMonth(), 7);
});

test("visibleRange does not skip a week when the month starts on the start day", () => {
  // Nov 2026 starts on a Sunday; with weekStartsOn=0 the lead must be 0.
  const { start } = visibleRange(new Date(2026, 10, 1), 0);
  assert.equal(start.getMonth(), 10);
  assert.equal(start.getDate(), 1);
});

test("weekdayLabels rotate with weekStartsOn", () => {
  assert.deepEqual(weekdayLabels(0).slice(0, 3), ["Sun", "Mon", "Tue"]);
  assert.deepEqual(weekdayLabels(1).slice(0, 3), ["Mon", "Tue", "Wed"]);
  assert.equal(weekdayLabels(6)[0], "Sat");
  assert.equal(weekdayLabels(0).length, 7);
});

test("weekdayLabels tolerates out-of-range input", () => {
  assert.equal(weekdayLabels(7)[0], "Sun");
  assert.equal(weekdayLabels(-1)[0], "Sat");
  assert.equal(weekdayLabels(Number.NaN)[0], "Sun");
});

test("buildGrid produces 42 cells and marks the month correctly", () => {
  const cells = buildGrid(new Date(2026, 8, 1), [], 0, new Date(2026, 8, 3));
  assert.equal(cells.length, 42);
  assert.equal(cells[0]?.inMonth, false, "Aug 30 is outside");
  assert.equal(cells[2]?.inMonth, true, "Sep 1 is inside");
  assert.equal(cells[2]?.date.getDate(), 1);
  assert.equal(cells[4]?.isToday, true, "Sep 3 is 'today' here");
  assert.equal(cells[31]?.date.getDate(), 30, "Sep 30");
  assert.equal(cells[32]?.inMonth, false, "Oct 1 is outside");
});

test("buildGrid places events in the right cells", () => {
  const cells = buildGrid(
    new Date(2026, 8, 1),
    [ev("first", "2026-09-01", "2026-09-02"), ev("last", "2026-09-30", "2026-10-01")],
    0,
    new Date(2026, 8, 3),
  );
  assert.equal(cells[2]?.events[0]?.summary, "first");
  assert.equal(cells[1]?.events.length, 0, "nothing on Aug 31");
  assert.equal(cells[31]?.events[0]?.summary, "last");
  assert.equal(cells[32]?.events.length, 0, "nothing on Oct 1");
});

test("readableTextOn picks a contrasting colour", () => {
  assert.equal(readableTextOn("#000000"), "#ffffff");
  assert.equal(readableTextOn("#ffffff"), "#1c1c1c");
  assert.equal(readableTextOn("#5f3dc4"), "#ffffff", "dark purple");
  assert.equal(readableTextOn("#ffe066"), "#1c1c1c", "pale yellow");
  assert.equal(readableTextOn("not a colour"), "#1c1c1c", "falls back");
});
