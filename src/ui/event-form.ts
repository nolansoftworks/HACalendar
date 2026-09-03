import type { CalendarEventInput, HaCalendarEvent } from "../ha/calendar.js";
import { parseHaDate } from "../ha/calendar.js";
import { addDays } from "./grid.js";

/**
 * Translation between the edit dialog's fields and HA's event shape.
 *
 * Pure and DOM-free on purpose -- this is where the two genuinely confusing
 * conversions live, and both are easy to get subtly wrong:
 *
 * 1. **Inclusive vs exclusive end.** HA stores an all-day event's `end` as the
 *    day *after* it finishes. A one-day event on the 9th is stored
 *    `start=09, end=10`. Nobody editing a calendar thinks that way, so the
 *    dialog shows an inclusive end date and this module shifts it by a day in
 *    each direction. Getting this wrong makes every all-day event one day too
 *    long, or refuses to save a single-day one.
 *
 * 2. **Local time with an explicit offset.** A timed event must be sent with
 *    its UTC offset. `toISOString()` would convert to UTC and shift the wall
 *    time -- a 5pm event becomes 22:00 -- so the offset is written out
 *    explicitly instead.
 */

export interface EventFormValues {
  summary: string;
  allDay: boolean;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `HH:mm`, ignored when `allDay`. */
  startTime: string;
  /** `YYYY-MM-DD`, **inclusive** -- the last day the event covers. */
  endDate: string;
  /** `HH:mm`, ignored when `allDay`. */
  endTime: string;
  location: string;
  description: string;
}

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "10:00";

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTimeValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse `YYYY-MM-DD` in *local* time. Never `new Date(string)` -- that is UTC. */
export function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `YYYY-MM-DDTHH:mm:ss±HH:MM` for the local zone.
 *
 * `getTimezoneOffset()` returns minutes *behind* UTC, so Central (UTC-5) gives
 * +300 and the sign is inverted relative to the ISO representation.
 */
export function toLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return (
    `${formatDate(date)}T${formatTimeValue(date)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function combine(dateValue: string, timeValue: string): Date | null {
  const date = parseDateValue(dateValue);
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!date || !match) return null;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

/** A blank form for creating an event on `day`. */
export function defaultFormValues(day: Date): EventFormValues {
  const date = formatDate(day);
  return {
    summary: "",
    allDay: true,
    startDate: date,
    startTime: DEFAULT_START_TIME,
    endDate: date,
    endTime: DEFAULT_END_TIME,
    location: "",
    description: "",
  };
}

/** Populate the form from an existing event, converting the end back to inclusive. */
export function toFormValues(event: HaCalendarEvent): EventFormValues {
  const start = parseHaDate(event.start);
  const end = parseHaDate(event.end);

  if (event.all_day) {
    // Stored end is exclusive; show the last day the event actually covers.
    const inclusiveEnd = addDays(end, -1);
    return {
      summary: event.summary,
      allDay: true,
      startDate: formatDate(start),
      startTime: DEFAULT_START_TIME,
      endDate: formatDate(inclusiveEnd < start ? start : inclusiveEnd),
      endTime: DEFAULT_END_TIME,
      location: event.location ?? "",
      description: event.description ?? "",
    };
  }

  return {
    summary: event.summary,
    allDay: false,
    startDate: formatDate(start),
    startTime: formatTimeValue(start),
    endDate: formatDate(end),
    endTime: formatTimeValue(end),
    location: event.location ?? "",
    description: event.description ?? "",
  };
}

/**
 * Human-readable problem with the form, or `null` if it is sendable.
 * Kept here rather than in the dialog so the rules are testable.
 */
export function validateForm(values: EventFormValues): string | null {
  if (!values.summary.trim()) return "Give the event a name.";

  const start = parseDateValue(values.startDate);
  const end = parseDateValue(values.endDate);
  if (!start || !end) return "Pick a valid date.";

  if (values.allDay) {
    return end.getTime() < start.getTime()
      ? "The end date is before the start date."
      : null;
  }

  const startAt = combine(values.startDate, values.startTime);
  const endAt = combine(values.endDate, values.endTime);
  if (!startAt || !endAt) return "Pick a valid time.";
  if (endAt.getTime() <= startAt.getTime()) {
    return "The event has to end after it starts.";
  }
  return null;
}

/**
 * Convert the form into what create/update accept.
 *
 * Returns app-vocabulary `start`/`end`; `toWireEvent()` in `ha/calendar.ts`
 * renames them to `dtstart`/`dtend` at the boundary ([ADR-0024]).
 * Throws if the values are invalid -- call `validateForm()` first.
 */
export function toEventInput(
  values: EventFormValues,
  rrule?: string,
): CalendarEventInput {
  const problem = validateForm(values);
  if (problem) throw new Error(problem);

  const summary = values.summary.trim();
  const extras = {
    ...(values.location.trim() ? { location: values.location.trim() } : {}),
    ...(values.description.trim()
      ? { description: values.description.trim() }
      : {}),
    ...(rrule ? { rrule } : {}),
  };

  if (values.allDay) {
    const end = parseDateValue(values.endDate)!;
    return {
      summary,
      start: values.startDate,
      // Back to HA's exclusive end: the day after the last day covered.
      end: formatDate(addDays(end, 1)),
      ...extras,
    };
  }

  return {
    summary,
    start: toLocalIso(combine(values.startDate, values.startTime)!),
    end: toLocalIso(combine(values.endDate, values.endTime)!),
    ...extras,
  };
}
