import { test } from "node:test";
import assert from "node:assert/strict";
import type { HaCalendarEvent } from "../ha/calendar.js";
import {
  defaultFormValues,
  formatDate,
  parseDateValue,
  toEventInput,
  toFormValues,
  toLocalIso,
  validateForm,
  type EventFormValues,
} from "./event-form.js";

const base: EventFormValues = {
  summary: "Dentist",
  allDay: true,
  startDate: "2026-09-17",
  startTime: "09:00",
  endDate: "2026-09-17",
  endTime: "10:00",
  location: "",
  description: "",
};

test("a single-day all-day event round-trips through HA's exclusive end", () => {
  const input = toEventInput(base);
  assert.equal(input.start, "2026-09-17");
  assert.equal(input.end, "2026-09-18", "end is the day after, per HA");

  const back = toFormValues({
    summary: "Dentist",
    start: input.start,
    end: input.end,
    all_day: true,
  } as HaCalendarEvent);
  assert.equal(back.startDate, "2026-09-17");
  assert.equal(back.endDate, "2026-09-17", "shown back to the user as one day");
});

test("a multi-day all-day event keeps its span across a round trip", () => {
  const input = toEventInput({ ...base, startDate: "2026-09-10", endDate: "2026-09-12" });
  assert.equal(input.start, "2026-09-10");
  assert.equal(input.end, "2026-09-13");

  const back = toFormValues({
    summary: "Trip", start: input.start, end: input.end, all_day: true,
  } as HaCalendarEvent);
  assert.equal(back.startDate, "2026-09-10");
  assert.equal(back.endDate, "2026-09-12", "still three days, not four");
});

test("an all-day event spanning a month boundary is unharmed", () => {
  const input = toEventInput({ ...base, startDate: "2026-09-30", endDate: "2026-09-30" });
  assert.equal(input.end, "2026-10-01");
  const back = toFormValues({
    summary: "x", start: input.start, end: input.end, all_day: true,
  } as HaCalendarEvent);
  assert.equal(back.startDate, "2026-09-30");
  assert.equal(back.endDate, "2026-09-30");
});

test("a timed event keeps its wall-clock time, not UTC", () => {
  const input = toEventInput({
    ...base, allDay: false, startTime: "17:00", endTime: "18:00",
  });
  // The literal 17:00 must survive; toISOString() would have shifted it.
  assert.match(input.start, /^2026-09-17T17:00:00[+-]\d{2}:\d{2}$/);
  assert.match(input.end, /^2026-09-17T18:00:00[+-]\d{2}:\d{2}$/);
  assert.equal(input.start.slice(11, 16), "17:00");
});

test("toLocalIso writes an offset with the correct sign", () => {
  const iso = toLocalIso(new Date(2026, 8, 17, 17, 0));
  assert.match(iso, /^2026-09-17T17:00:00[+-]\d{2}:\d{2}$/);
  const offsetMinutes = -new Date(2026, 8, 17, 17, 0).getTimezoneOffset();
  const sign = iso.slice(19, 20);
  assert.equal(sign, offsetMinutes >= 0 ? "+" : "-");
});

test("timed events survive a round trip", () => {
  const input = toEventInput({ ...base, allDay: false, startTime: "17:00", endTime: "18:30" });
  const back = toFormValues({
    summary: "Soccer", start: input.start, end: input.end, all_day: false,
  } as HaCalendarEvent);
  assert.equal(back.startTime, "17:00");
  assert.equal(back.endTime, "18:30");
  assert.equal(back.startDate, "2026-09-17");
  assert.equal(back.allDay, false);
});

test("optional fields are omitted rather than sent empty", () => {
  const bare = toEventInput(base);
  assert.equal("location" in bare, false);
  assert.equal("description" in bare, false);
  assert.equal("rrule" in bare, false);

  const full = toEventInput({ ...base, location: " Office ", description: " note " }, "FREQ=WEEKLY");
  assert.equal(full.location, "Office", "trimmed");
  assert.equal(full.description, "note");
  assert.equal(full.rrule, "FREQ=WEEKLY");
});

test("validation rejects what HA would reject", () => {
  assert.equal(validateForm(base), null);
  assert.match(validateForm({ ...base, summary: "   " })!, /name/i);
  assert.match(validateForm({ ...base, endDate: "2026-09-16" })!, /before/i);
  assert.match(validateForm({ ...base, startDate: "nonsense" })!, /valid date/i);
  assert.match(
    validateForm({ ...base, allDay: false, startTime: "10:00", endTime: "10:00" })!,
    /end after it starts/i,
    "zero-length timed events are rejected",
  );
  assert.equal(
    validateForm({ ...base, allDay: false, startTime: "10:00", endTime: "10:01" }),
    null,
  );
});

test("an all-day event may start and end on the same day", () => {
  assert.equal(validateForm({ ...base, startDate: "2026-09-17", endDate: "2026-09-17" }), null);
});

test("toEventInput refuses invalid values instead of sending them", () => {
  assert.throws(() => toEventInput({ ...base, summary: "" }), /name/i);
  assert.throws(() => toEventInput({ ...base, endDate: "2026-09-01" }), /before/i);
});

test("a corrupt stored end does not produce an end before the start", () => {
  // Defensive: if end somehow equals start, the inclusive shift would go
  // backwards. The form should still show a usable single day.
  const back = toFormValues({
    summary: "odd", start: "2026-09-17", end: "2026-09-17", all_day: true,
  } as HaCalendarEvent);
  assert.equal(back.startDate, "2026-09-17");
  assert.equal(back.endDate, "2026-09-17");
  assert.equal(validateForm(back), null);
});

test("defaultFormValues opens on the tapped day as a one-day all-day event", () => {
  const values = defaultFormValues(new Date(2026, 8, 17));
  assert.equal(values.startDate, "2026-09-17");
  assert.equal(values.endDate, "2026-09-17");
  assert.equal(values.allDay, true);
  assert.equal(values.summary, "");
});

test("date helpers work in local time, not UTC", () => {
  assert.equal(formatDate(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(formatDate(new Date(2026, 11, 31)), "2026-12-31");
  const parsed = parseDateValue("2026-09-01")!;
  assert.equal(parsed.getDate(), 1, "not the 31st of August");
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parseDateValue("garbage"), null);
});
