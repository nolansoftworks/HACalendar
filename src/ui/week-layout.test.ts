import { test } from "node:test";
import assert from "node:assert/strict";
import type { OwnedEvent } from "./grid.js";
import {
  DEFAULT_END_HOUR,
  DEFAULT_START_HOUR,
  dayColumns,
  formatHour,
  hourLabels,
  hourRangeFor,
  layoutDay,
  minutesWithinDay,
  nowOffset,
  splitDay,
} from "./week-layout.js";

/** Local-time ISO with an explicit offset, so parsing never drifts to UTC. */
function at(day: number, hour: number, minute = 0): string {
  const d = new Date(2026, 8, day, hour, minute);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `2026-09-${p(day)}T${p(hour)}:${p(minute)}:00${sign}${p(off / 60)}:${p(off % 60)}`;
}

function timed(summary: string, day: number, from: number, to: number): OwnedEvent {
  return {
    summary, start: at(day, from), end: at(day, to),
    all_day: false, ownerId: "x", color: "#123456",
  };
}
function allDay(summary: string, from: number, to: number): OwnedEvent {
  return {
    summary,
    start: `2026-09-${String(from).padStart(2, "0")}`,
    end: `2026-09-${String(to).padStart(2, "0")}`,
    all_day: true, ownerId: "x", color: "#123456",
  };
}

const DAY = new Date(2026, 8, 17);
const RANGE = { startHour: 8, endHour: 20 };

test("dayColumns walks forward from the start day", () => {
  const days = dayColumns(new Date(2026, 8, 17), 5);
  assert.equal(days.length, 5);
  assert.deepEqual(days.map((d) => d.getDate()), [17, 18, 19, 20, 21]);
});

test("dayColumns crosses a month boundary correctly", () => {
  const days = dayColumns(new Date(2026, 8, 29), 5);
  assert.deepEqual(days.map((d) => d.getMonth()), [8, 8, 9, 9, 9]);
  assert.deepEqual(days.map((d) => d.getDate()), [29, 30, 1, 2, 3]);
});

test("all-day events go to the band, timed ones to the grid", () => {
  const events = [allDay("Trip", 17, 18), timed("Soccer", 17, 17, 18)];
  const split = splitDay(events, DAY);
  assert.deepEqual(split.allDay.map((e) => e.summary), ["Trip"]);
  assert.deepEqual(split.timed.map((e) => e.summary), ["Soccer"]);
});

test("a day a multi-day timed event merely passes through shows it in the band", () => {
  // Starts the 16th, ends the 18th: on the 17th it covers the whole day, and a
  // block taller than the grid tells the reader nothing.
  const flight: OwnedEvent = {
    summary: "Flight", start: at(16, 22), end: at(18, 6),
    all_day: false, ownerId: "x", color: "#123456",
  };
  assert.deepEqual(splitDay([flight], DAY).allDay.map((e) => e.summary), ["Flight"]);
  assert.equal(splitDay([flight], DAY).timed.length, 0);
  // On its first day it is still a timed block.
  assert.equal(splitDay([flight], new Date(2026, 8, 16)).timed.length, 1);
});

test("minutesWithinDay clips to the day it is asked about", () => {
  const evening = timed("Evening", 17, 18, 20);
  assert.deepEqual(minutesWithinDay(evening, DAY), {
    startMinutes: 18 * 60, endMinutes: 20 * 60,
  });
  const overnight: OwnedEvent = {
    summary: "Overnight", start: at(17, 22), end: at(18, 2),
    all_day: false, ownerId: "x", color: "#123456",
  };
  assert.equal(minutesWithinDay(overnight, DAY).startMinutes, 22 * 60);
  assert.equal(minutesWithinDay(overnight, DAY).endMinutes, 24 * 60, "clipped to midnight");
  assert.equal(minutesWithinDay(overnight, new Date(2026, 8, 18)).startMinutes, 0);
});

test("the hour window defaults, then widens for an early event", () => {
  assert.deepEqual(hourRangeFor([], [DAY]), {
    startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR,
  });
  const early = hourRangeFor([timed("Swim", 17, 6, 7)], [DAY]);
  assert.equal(early.startHour, 6, "widened upward");
  assert.equal(early.endHour, DEFAULT_END_HOUR, "unchanged below");
  const late = hourRangeFor([timed("Party", 17, 20, 23)], [DAY]);
  assert.equal(late.endHour, 23);
});

test("the window stretches to keep the current hour visible", () => {
  // 22:30 on a visible day. Without this the now-line vanishes each evening,
  // which on a wall display reads as a frozen screen.
  const late = hourRangeFor([], [DAY], new Date(2026, 8, 17, 22, 30));
  assert.equal(late.endHour, 23, "widened past the 21:00 default");
  assert.notEqual(nowOffset(late, new Date(2026, 8, 17, 22, 30)), null);

  const early = hourRangeFor([], [DAY], new Date(2026, 8, 17, 5, 10));
  assert.equal(early.startHour, 5);
});

test("the current hour only stretches the window when today is on screen", () => {
  // Paging to next week must not drag the grid open to 11pm.
  const other = hourRangeFor([], [new Date(2026, 8, 24)], new Date(2026, 8, 17, 22, 30));
  assert.equal(other.startHour, DEFAULT_START_HOUR);
  assert.equal(other.endHour, DEFAULT_END_HOUR);
});

test("the window never inverts", () => {
  const range = hourRangeFor([timed("Late", 17, 23, 24)], [DAY]);
  assert.ok(range.endHour > range.startHour);
});

test("a single event fills its share of the span", () => {
  // 08:00-20:00 visible; a 14:00-15:00 event starts halfway and lasts 1/12.
  const [block] = layoutDay([timed("Meeting", 17, 14, 15)], DAY, RANGE);
  assert.ok(Math.abs(block!.top - 0.5) < 1e-9);
  assert.ok(Math.abs(block!.height - 1 / 12) < 1e-9);
  assert.equal(block!.lanes, 1, "alone, so full width");
  assert.equal(block!.lane, 0);
});

test("two overlapping events split into two lanes", () => {
  const blocks = layoutDay(
    [timed("A", 17, 14, 16), timed("B", 17, 15, 17)], DAY, RANGE,
  );
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.lanes), [2, 2]);
  assert.deepEqual(blocks.map((b) => b.lane).sort(), [0, 1]);
});

test("back-to-back events do not overlap and stay full width", () => {
  const blocks = layoutDay(
    [timed("A", 17, 14, 15), timed("B", 17, 15, 16)], DAY, RANGE,
  );
  assert.deepEqual(blocks.map((b) => b.lanes), [1, 1], "touching is not overlapping");
});

test("a chain of overlaps stays one cluster so columns keep their width", () => {
  // A 14-16, B 15-17, C 16-18. A-B overlap and B-C overlap, but never more
  // than two at once, and C starts exactly as A ends -- so two lanes, with C
  // reusing A's. The point of the cluster is that all three report the *same*
  // lane count, or blocks would change width partway down the column.
  const blocks = layoutDay(
    [timed("A", 17, 14, 16), timed("B", 17, 15, 17), timed("C", 17, 16, 18)],
    DAY, RANGE,
  );
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks.map((b) => b.lanes), [2, 2, 2], "one width for the cluster");
  const byName = new Map(blocks.map((b) => [b.event.summary, b]));
  assert.equal(byName.get("A")!.lane, 0);
  assert.equal(byName.get("B")!.lane, 1);
  assert.equal(byName.get("C")!.lane, 0, "C reuses A's lane; they do not overlap");
});

test("three genuinely concurrent events need three lanes", () => {
  const blocks = layoutDay(
    [timed("A", 17, 14, 17), timed("B", 17, 15, 17), timed("C", 17, 16, 17)],
    DAY, RANGE,
  );
  assert.deepEqual(blocks.map((b) => b.lanes), [3, 3, 3]);
  assert.equal(new Set(blocks.map((b) => b.lane)).size, 3);
});

test("a lane is reused once its event has ended", () => {
  const blocks = layoutDay(
    [timed("A", 17, 14, 15), timed("B", 17, 14, 17), timed("C", 17, 15, 16)],
    DAY, RANGE,
  );
  const byName = new Map(blocks.map((b) => [b.event.summary, b]));
  assert.equal(byName.get("A")!.lane, 0);
  assert.equal(byName.get("B")!.lane, 1);
  assert.equal(byName.get("C")!.lane, 0, "reuses A's lane");
});

test("events outside the window are clamped, not dropped", () => {
  const blocks = layoutDay([timed("Dawn", 17, 5, 6)], DAY, RANGE);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.top, 0);
  assert.ok(blocks[0]!.height > 0, "still tappable");
});

test("a very short event keeps a usable minimum height", () => {
  const [block] = layoutDay([timed("Pill", 17, 14, 14)], DAY, RANGE);
  assert.ok(block!.height >= 0.012);
});

test("hour labels cover the window inclusively and read plainly", () => {
  assert.deepEqual(hourLabels({ startHour: 8, endHour: 11 }), [8, 9, 10, 11]);
  assert.equal(formatHour(0), "12 am");
  assert.equal(formatHour(9), "9 am");
  assert.equal(formatHour(12), "12 pm");
  assert.equal(formatHour(13), "1 pm");
  assert.equal(formatHour(23), "11 pm");
});

test("the now-line appears only when now is on the grid", () => {
  assert.equal(nowOffset(RANGE, new Date(2026, 8, 17, 14, 0)), 0.5);
  assert.equal(nowOffset(RANGE, new Date(2026, 8, 17, 3, 0)), null, "before the window");
  assert.equal(nowOffset(RANGE, new Date(2026, 8, 17, 23, 0)), null, "after it");
});
