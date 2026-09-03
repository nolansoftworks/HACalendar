import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROSTER, normalizeRoster } from "./people.js";

test("reads a well-formed roster", () => {
  const roster = normalizeRoster({
    weekStartsOn: 1,
    people: [
      {
        id: "emma",
        name: "Emma",
        color: "#e8590c",
        calendar: "calendar.emma",
        choreList: "todo.chores_emma",
      },
    ],
  });
  assert.equal(roster.weekStartsOn, 1);
  assert.equal(roster.people.length, 1);
  assert.equal(roster.people[0]?.id, "emma");
  assert.equal(roster.people[0]?.calendar, "calendar.emma");
  assert.equal(roster.people[0]?.choreList, "todo.chores_emma");
});

test("drops people with no id -- they cannot be attributed in the logbook", () => {
  const roster = normalizeRoster({
    people: [{ name: "Nameless", color: "#fff" }, { id: "ok", name: "Ok" }],
  });
  assert.equal(roster.people.length, 1);
  assert.equal(roster.people[0]?.id, "ok");
});

test("a person with no calendar is kept -- parents appear in the picker", () => {
  // ADR-0021: the roster cannot be derived from entities precisely because
  // parents own no chore list. Such a person must survive normalisation.
  const roster = normalizeRoster({ people: [{ id: "dad", name: "Dad" }] });
  assert.equal(roster.people.length, 1);
  assert.equal(roster.people[0]?.calendar, undefined);
  assert.equal(roster.people[0]?.choreList, undefined);
});

test("falls back to the id when a display name is missing", () => {
  const roster = normalizeRoster({ people: [{ id: "jake" }] });
  assert.equal(roster.people[0]?.name, "jake");
});

test("defaults weekStartsOn to Sunday when absent or wrong type", () => {
  assert.equal(normalizeRoster({ people: [] }).weekStartsOn, 0);
  assert.equal(normalizeRoster({ weekStartsOn: "1", people: [] }).weekStartsOn, 0);
  assert.equal(normalizeRoster({ weekStartsOn: Number.NaN, people: [] }).weekStartsOn, 0);
});

test("garbage input degrades to the default roster rather than throwing", () => {
  assert.deepEqual(normalizeRoster(null), DEFAULT_ROSTER);
  assert.deepEqual(normalizeRoster("nope"), DEFAULT_ROSTER);
  assert.deepEqual(normalizeRoster(42), DEFAULT_ROSTER);
  assert.deepEqual(normalizeRoster({ people: "not an array" }).people, []);
  assert.deepEqual(normalizeRoster({ people: [null, 7, "x"] }).people, []);
});
