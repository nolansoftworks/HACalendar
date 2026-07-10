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
 * 2. The websocket event payload uses `start`/`end`. The `create_event`
 *    *service* uses `dtstart`/`dtend` for the same fields. We speak websocket
 *    everywhere, so it's always `start`/`end` in this file.
 *
 * Backend support is not uniform. local_calendar implements CREATE|UPDATE|
 * DELETE. Google implements CREATE only. CalDAV implements CREATE only. If we
 * ever point this at something other than local_calendar, edit and delete will
 * fail at runtime -- there is no compile-time signal.
 */

/** An event as returned by `calendar/event/subscribe`. */
export interface HaCalendarEvent {
  summary: string;
  /** ISO datetime, or bare `YYYY-MM-DD` when `all_day` is true. */
  start: string;
  end: string;
  description: string | null;
  location: string | null;
  uid: string | null;
  recurrence_id: string | null;
  rrule: string | null;
  all_day: boolean;
}

/** An event as accepted by create/update. */
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
    event,
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
    event,
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
