import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChoreItem } from "../ha/chores.js";
import {
  cleanEntry,
  isTicked,
  listProgress,
  listSummary,
  sortListItems,
} from "./list-order.js";

function item(
  summary: string,
  status: ChoreItem["status"] = "needs_action",
): ChoreItem {
  return { summary, uid: "uid-" + summary, status };
}

test("a list keeps the order it was typed in", () => {
  const items = [item("Milk"), item("Eggs"), item("Bread")];
  assert.deepEqual(
    sortListItems(items).map((i) => i.summary),
    ["Milk", "Eggs", "Bread"],
    "no alphabetising -- the aisle order is the point",
  );
});

test("ticked items sink, and keep their order among themselves", () => {
  const items = [
    item("Milk", "completed"),
    item("Eggs"),
    item("Bread", "completed"),
    item("Jam"),
  ];
  assert.deepEqual(
    sortListItems(items).map((i) => i.summary),
    ["Eggs", "Jam", "Milk", "Bread"],
  );
});

test("sorting twice does not move anything again", () => {
  const items = [item("Milk", "completed"), item("Eggs"), item("Bread")];
  const once = sortListItems(items);
  assert.deepEqual(
    sortListItems(once).map((i) => i.summary),
    once.map((i) => i.summary),
  );
});

test("sort does not mutate the list HA pushed us", () => {
  const items = [item("Milk", "completed"), item("Eggs")];
  sortListItems(items);
  assert.deepEqual(
    items.map((i) => i.summary),
    ["Milk", "Eggs"],
  );
});

test("progress counts what is left, not just what is done", () => {
  const items = [item("Milk", "completed"), item("Eggs"), item("Bread")];
  assert.deepEqual(listProgress(items), { done: 1, total: 3, left: 2 });
  assert.deepEqual(listProgress([]), { done: 0, total: 0, left: 0 });
});

test("the header says it in words", () => {
  assert.equal(listSummary([]), "Empty");
  assert.equal(listSummary([item("Milk"), item("Eggs")]), "2 things");
  assert.equal(listSummary([item("Milk")]), "1 thing");
  assert.equal(listSummary([item("Milk", "completed"), item("Eggs")]), "1 left");
  assert.equal(listSummary([item("Milk", "completed")]), "All done");
});

test("isTicked is the one place status is compared", () => {
  assert.equal(isTicked(item("Milk", "completed")), true);
  assert.equal(isTicked(item("Milk")), false);
});

test("entries are tidied, and blank ones rejected", () => {
  assert.equal(cleanEntry("  Milk  "), "Milk");
  assert.equal(
    cleanEntry("Milk\n\teggs"),
    "Milk eggs",
    "pasted text stays one row",
  );
  assert.equal(cleanEntry("   "), null);
  assert.equal(cleanEntry(""), null);
});
