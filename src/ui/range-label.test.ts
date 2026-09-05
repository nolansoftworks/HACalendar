import { test } from "node:test";
import assert from "node:assert/strict";
import { monthLabel, viewLabel, weekRangeLabel } from "./range-label.js";

// Locale is pinned so these assert wording, not the test machine's settings.
const EN = "en-US";

test("month view names the month and year", () => {
  assert.equal(monthLabel(new Date(2026, 8, 1), EN), "September 2026");
  assert.equal(monthLabel(new Date(2026, 0, 1), EN), "January 2026");
});

test("a week inside one month collapses to a single month name", () => {
  assert.equal(
    weekRangeLabel(new Date(2026, 8, 6), new Date(2026, 8, 12), EN),
    "September 6 – 12, 2026",
  );
});

test("a week spanning two months names both", () => {
  assert.equal(
    weekRangeLabel(new Date(2026, 7, 30), new Date(2026, 8, 5), EN),
    "August 30 – September 5, 2026",
  );
});

test("a week spanning new year carries both years", () => {
  assert.equal(
    weekRangeLabel(new Date(2026, 11, 27), new Date(2027, 0, 2), EN),
    "December 27, 2026 – January 2, 2027",
  );
});

test("viewLabel picks the right form for the active view", () => {
  // 2026-09-17 is a Thursday; its Sunday week is the 13th to the 19th.
  const cursor = new Date(2026, 8, 17);
  assert.equal(viewLabel("month", cursor, 0, 7, EN), "September 2026");
  assert.equal(viewLabel("week", cursor, 0, 7, EN), "September 13 – 19, 2026");
});

test("viewLabel respects a Monday-start household", () => {
  const cursor = new Date(2026, 8, 17);
  assert.equal(viewLabel("week", cursor, 1, 7, EN), "September 14 – 20, 2026");
});

test("the label ends on the last day shown, not an exclusive bound", () => {
  // Seven days from Sunday the 13th ends on Saturday the 19th. Naming the 20th
  // would point at a day that is not on screen.
  assert.equal(
    viewLabel("week", new Date(2026, 8, 13), 0, 7, EN),
    "September 13 – 19, 2026",
  );
});

test("month view is anchored to the month, not the cursor's day", () => {
  assert.equal(viewLabel("month", new Date(2026, 8, 30), 0, 7, EN), "September 2026");
  assert.equal(viewLabel("month", new Date(2026, 8, 1), 0, 7, EN), "September 2026");
});
