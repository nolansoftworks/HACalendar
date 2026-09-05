import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoreItem } from "../ha/chores.js";
import {
  choreProgress,
  daysOverdue,
  findDuplicate,
  isDueToday,
  isOverdue,
  sortChores,
} from "./chore-list.js";

const NOW = new Date(2026, 8, 17, 14, 0); // Thursday 2026-09-17, 2pm

function chore(
  summary: string,
  due?: string,
  status: ChoreItem["status"] = "needs_action",
): ChoreItem {
  return { summary, uid: "uid-" + summary, status, ...(due ? { due } : {}) };
}

test("due today is not overdue -- a child has all day", () => {
  assert.equal(isOverdue(chore("Dishes", "2026-09-17"), NOW), false);
  assert.equal(isDueToday(chore("Dishes", "2026-09-17"), NOW), true);
});

test("yesterday is overdue", () => {
  assert.equal(isOverdue(chore("Dishes", "2026-09-16"), NOW), true);
  assert.equal(daysOverdue(chore("Dishes", "2026-09-16"), NOW), 1);
  assert.equal(daysOverdue(chore("Dishes", "2026-09-10"), NOW), 7);
});

test("a completed chore is never overdue, however late it was", () => {
  // ADR-0013: overdue-ness is the record it was missed. Completing it ends
  // that, but must not require bumping the due date to make it go away.
  const late = chore("Dishes", "2026-09-01", "completed");
  assert.equal(isOverdue(late, NOW), false);
  assert.equal(daysOverdue(late, NOW), 0);
  assert.equal(late.due, "2026-09-01", "due date untouched");
});

test("an undated chore is never overdue", () => {
  assert.equal(isOverdue(chore("Tidy up"), NOW), false);
  assert.equal(isDueToday(chore("Tidy up"), NOW), false);
});

test("progress counts done, overdue and due-today separately", () => {
  const items = [
    chore("A", "2026-09-16"),               // overdue
    chore("B", "2026-09-17"),               // due today
    chore("C", "2026-09-20"),               // later
    chore("D", "2026-09-16", "completed"),  // done, was late
    chore("E"),                             // undated
  ];
  assert.deepEqual(choreProgress(items, NOW), {
    done: 1, total: 5, overdue: 1, dueToday: 1,
  });
});

test("an empty list is all zeroes", () => {
  assert.deepEqual(choreProgress([], NOW), { done: 0, total: 0, overdue: 0, dueToday: 0 });
});

test("sort puts overdue first, longest-overdue at the very top", () => {
  const sorted = sortChores(
    [chore("Recent", "2026-09-16"), chore("Ancient", "2026-09-10")],
    NOW,
  );
  assert.deepEqual(sorted.map((c) => c.summary), ["Ancient", "Recent"]);
});

test("sort orders the rest by due date, undated last", () => {
  const sorted = sortChores(
    [chore("NoDate"), chore("Later", "2026-09-25"), chore("Sooner", "2026-09-18")],
    NOW,
  );
  assert.deepEqual(sorted.map((c) => c.summary), ["Sooner", "Later", "NoDate"]);
});

test("completed chores sink to the bottom", () => {
  const sorted = sortChores(
    [
      chore("Done", "2026-09-10", "completed"),
      chore("Todo", "2026-09-25"),
      chore("AlsoDone", "2026-09-01", "completed"),
    ],
    NOW,
  );
  assert.equal(sorted[0]?.summary, "Todo", "outstanding work first");
  assert.deepEqual(sorted.slice(1).map((c) => c.summary), ["AlsoDone", "Done"]);
});

test("ties break by name, so the list does not reshuffle on every push", () => {
  const once = sortChores([chore("Zebra"), chore("Apple"), chore("Mango")], NOW);
  const twice = sortChores(once.slice().reverse(), NOW);
  assert.deepEqual(once.map((c) => c.summary), twice.map((c) => c.summary));
  assert.deepEqual(once.map((c) => c.summary), ["Apple", "Mango", "Zebra"]);
});

test("sort does not mutate the list HA pushed us", () => {
  const items = [chore("B"), chore("A")];
  const sorted = sortChores(items, NOW);
  assert.deepEqual(items.map((c) => c.summary), ["B", "A"]);
  assert.deepEqual(sorted.map((c) => c.summary), ["A", "B"]);
});

test("duplicate detection is for mentioning, and ignores completed items", () => {
  const items = [chore("Dishes", undefined, "completed"), chore("Laundry")];
  assert.equal(findDuplicate(items, "Dishes"), null, "a done one is not a clash");
  assert.equal(findDuplicate(items, "Laundry")?.summary, "Laundry");
  assert.equal(findDuplicate(items, "  laundry  ")?.summary, "Laundry", "trimmed, case-insensitive");
  assert.equal(findDuplicate(items, "   "), null);
});
