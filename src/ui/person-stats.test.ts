import { test } from "node:test";
import assert from "node:assert/strict";
import type { OwnedEvent } from "./grid.js";
import { startOfWeek } from "./grid.js";
import { personStats } from "./person-stats.js";

function iso(day: number, hour: number): string {
  const d = new Date(2026, 8, day, hour);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `2026-09-${p(day)}T${p(hour)}:00:00${sign}${p(off / 60)}:${p(off % 60)}`;
}
const timed = (owner: string, day: number, from: number, to: number): OwnedEvent => ({
  summary: "e", start: iso(day, from), end: iso(day, to),
  all_day: false, ownerId: owner, color: "#123456",
});
const allDay = (owner: string, from: number, to: number): OwnedEvent => ({
  summary: "a",
  start: `2026-09-${String(from).padStart(2, "0")}`,
  end: `2026-09-${String(to).padStart(2, "0")}`,
  all_day: true, ownerId: owner, color: "#123456",
});

// Thursday 2026-09-17, 2pm.
const NOW = new Date(2026, 8, 17, 14, 0);

test("counts only the person asked about", () => {
  const events = [timed("a", 17, 9, 10), timed("b", 17, 9, 10), timed("a", 18, 9, 10)];
  assert.equal(personStats(events, "a", NOW).total, 2);
  assert.equal(personStats(events, "b", NOW).total, 1);
  assert.equal(personStats(events, "nobody", NOW).total, 0);
});

test("past means the event has actually finished", () => {
  const events = [
    timed("a", 17, 9, 10),   // this morning -- done
    timed("a", 17, 13, 15),  // running right now -- not done
    timed("a", 17, 16, 17),  // later today -- not done
  ];
  const stats = personStats(events, "a", NOW);
  assert.equal(stats.total, 3);
  assert.equal(stats.past, 1, "only the finished one");
});

test("an event ending exactly now counts as past", () => {
  assert.equal(personStats([timed("a", 17, 13, 14)], "a", NOW).past, 1);
});

test("today counts anything overlapping today, done or not", () => {
  const events = [
    timed("a", 16, 9, 10),  // yesterday
    timed("a", 17, 9, 10),  // this morning
    timed("a", 17, 16, 17), // this evening
    timed("a", 18, 9, 10),  // tomorrow
  ];
  const stats = personStats(events, "a", NOW);
  assert.equal(stats.today, 2);
  assert.equal(stats.total, 4);
  assert.equal(stats.past, 2, "yesterday's and this morning's");
});

test("an all-day event on today counts as today and is not yet past", () => {
  // Stored 17 -> 18 because HA's end is exclusive.
  const stats = personStats([allDay("a", 17, 18)], "a", NOW);
  assert.equal(stats.today, 1);
  assert.equal(stats.past, 0, "still going at 2pm");
});

test("yesterday's all-day event is past, using the exclusive end correctly", () => {
  // Stored 16 -> 17: it ends at midnight starting today, so by 2pm it is over.
  const stats = personStats([allDay("a", 16, 17)], "a", NOW);
  assert.equal(stats.past, 1);
  assert.equal(stats.today, 0, "must not bleed into today");
});

test("a multi-day event spanning today counts once, as today, not past", () => {
  const stats = personStats([allDay("a", 16, 19)], "a", NOW);
  assert.equal(stats.total, 1);
  assert.equal(stats.today, 1);
  assert.equal(stats.past, 0);
});

test("an empty list is all zeroes rather than a crash", () => {
  assert.deepEqual(personStats([], "a", NOW), { total: 0, past: 0, today: 0 });
});

test("startOfWeek anchors a real Sunday-to-Saturday week", () => {
  // 2026-09-17 is a Thursday; its Sunday is the 13th.
  const sunday = startOfWeek(new Date(2026, 8, 17), 0);
  assert.equal(sunday.getDay(), 0);
  assert.equal(sunday.getDate(), 13);

  // Asking on the Sunday itself must not jump back a week.
  assert.equal(startOfWeek(new Date(2026, 8, 13), 0).getDate(), 13);

  // Monday-start households get the 14th.
  const monday = startOfWeek(new Date(2026, 8, 17), 1);
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getDate(), 14);
});

test("startOfWeek crosses a month boundary", () => {
  // 2026-10-01 is a Thursday; its Sunday is 2026-09-27.
  const sunday = startOfWeek(new Date(2026, 9, 1), 0);
  assert.equal(sunday.getMonth(), 8);
  assert.equal(sunday.getDate(), 27);
});
