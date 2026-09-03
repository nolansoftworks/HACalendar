import type { HaClient } from "./client.js";

/**
 * Calendar websocket API.
 *
 * Two things bit us on the way in, both worth remembering:
 *
 * 1. Only `calendar.create_event` and `calendar.get_events` exist as *services*.
 *    Update and delete are websocket-only. That means no YAML automation can
 *    edit or delete an event -- only this app can.
 *
 * 2. The field names are ASYMMETRIC -- and not in the way this comment used to
 *    claim. Verified by live round-trip against HA 2026.7.2:
 *
 *      read  (`calendar/event/subscribe`)          -> `start`   / `end`
 *      write (`calendar/event/create` | `/update`) -> `dtstart` / `dtend`
 *
 *    It is NOT a service-vs-websocket split. It is a read-vs-write split on
 *    the same websocket API. Sending `start`/`end` to create or update fails
 *    at runtime with:
 *
 *      invalid_format: extra keys not allowed @ data['event']['start']
 *                      required key not provided @ data['event']['dtstart']
 *
 *    `toWireEvent()` below is the single translation point. App code speaks
 *    `start`/`end` everywhere and should never mention `dtstart`.
 *
 * Backend support is not uniform. local_calendar implements CREATE|UPDATE|
 * DELETE. Google implements CREATE only. CalDAV implements CREATE only. If we
 * ever point this at something other than local_calendar, edit and delete will
 * fail at runtime -- there is no compile-time signal.
 */

/**
 * An event as returned by `calendar/event/subscribe`.
 *
 * HA *omits* empty fields rather than sending null -- verified against 2026.7.2.
 * An all-day event with no description arrives as exactly
 * `{start, end, summary, uid, all_day}`. So these are optional, not nullable:
 * a guard like `if (e.recurrence_id !== null)` wrongly passes on `undefined`.
 */
export interface HaCalendarEvent {
  summary: string;
  /** ISO datetime, or bare `YYYY-MM-DD` when `all_day` is true. */
  start: string;
  /** Exclusive. An all-day event on the 9th arrives as start=09, end=10. */
  end: string;
  description?: string;
  location?: string;
  /** Present on every event local_calendar returns; shared across a series. */
  uid?: string;
  /** Only on an instance of a recurring series. e.g. `20260908T160000` */
  recurrence_id?: string;
  /** Only on a recurring series. e.g. `FREQ=WEEKLY;BYDAY=TU` */
  rrule?: string;
  all_day: boolean;
}

/**
 * An event as accepted by create/update, in *app* vocabulary.
 * `start`/`end` here become `dtstart`/`dtend` on the wire -- see note 2 above.
 */
export interface CalendarEventInput {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  /** RFC 5545 RRULE, without the `RRULE:` prefix. e.g. `FREQ=WEEKLY;BYDAY=TU` */
  rrule?: string;
}

/**
 * Which instances of a recurring series an edit or delete applies to.
 * Omitted => this instance only. `THISANDFUTURE` => this one and all after it.
 */
export type RecurrenceRange = "THISANDFUTURE";

export interface RecurrenceTarget {
  recurrenceId?: string;
  recurrenceRange?: RecurrenceRange;
}

interface SubscribeMessage {
  events: HaCalendarEvent[];
}

/**
 * Stream events in [start, end). HA pushes a fresh full list whenever the
 * calendar changes, so the callback replaces state rather than merging.
 * Returns an unsubscribe function -- callers must await and store it.
 */
export function subscribeCalendarEvents(
  client: HaClient,
  entityId: string,
  start: Date,
  end: Date,
  callback: (events: HaCalendarEvent[]) => void,
): Promise<() => Promise<void>> {
  return client.subscribeMessage<SubscribeMessage>(
    (message) => callback(message.events),
    {
      type: "calendar/event/subscribe",
      entity_id: entityId,
      start: start.toISOString(),
      end: end.toISOString(),
    },
  );
}

export function createEvent(
  client: HaClient,
  entityId: string,
  event: CalendarEventInput,
): Promise<void> {
  return client.callWS({
    type: "calendar/event/create",
    entity_id: entityId,
    event: toWireEvent(event),
  });
}

export function updateEvent(
  client: HaClient,
  entityId: string,
  uid: string,
  event: CalendarEventInput,
  target: RecurrenceTarget = {},
): Promise<void> {
  return client.callWS({
    type: "calendar/event/update",
    entity_id: entityId,
    uid,
    event: toWireEvent(event),
    ...recurrenceFields(target),
  });
}

export function deleteEvent(
  client: HaClient,
  entityId: string,
  uid: string,
  target: RecurrenceTarget = {},
): Promise<void> {
  return client.callWS({
    type: "calendar/event/delete",
    entity_id: entityId,
    uid,
    ...recurrenceFields(target),
  });
}

/**
 * The one place `dtstart`/`dtend` are allowed to appear. Create and update
 * reject `start`/`end` outright; see note 2 in the file header.
 */
function toWireEvent(event: CalendarEventInput): Record<string, unknown> {
  const { start, end, ...rest } = event;
  return { ...rest, dtstart: start, dtend: end };
}

function recurrenceFields(target: RecurrenceTarget): Record<string, string> {
  const fields: Record<string, string> = {};
  if (target.recurrenceId) fields["recurrence_id"] = target.recurrenceId;
  if (target.recurrenceRange) {
    fields["recurrence_range"] = target.recurrenceRange;
  }
  return fields;
}

/**
 * Parse an HA calendar timestamp into a local Date.
 *
 * All-day events arrive as a bare `YYYY-MM-DD`. `new Date("2026-07-09")` parses
 * that as UTC midnight, which lands on the previous day for anyone west of
 * Greenwich -- an all-day event would render a day early. Build it in local
 * time instead.
 */
export function parseHaDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
  }
  return new Date(value);
}
