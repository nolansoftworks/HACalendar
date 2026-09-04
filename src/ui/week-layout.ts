import { parseHaDate } from "../ha/calendar.js";
import { addDays, eventsOnDay, sameDay, type OwnedEvent } from "./grid.js";

/**
 * Time-grid geometry for the day-column view.
 *
 * Pure and DOM-free, like `grid.ts`, so the fiddly parts -- where a block sits,
 * how tall it is, and how overlapping events share a column -- can be tested
 * without a browser.
 *
 * Positions come back as fractions of the visible span (0..1) rather than
 * pixels, so the same numbers drive a wall panel and a phone.
 */

/** The window the grid shows when nothing forces it wider. */
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 21;

const MINUTES_PER_HOUR = 60;

export interface HourRange {
  startHour: number;
  endHour: number;
}

export interface PositionedEvent {
  event: OwnedEvent;
  /** 0..1 down the visible span. */
  top: number;
  /** 0..1 of the visible span. Never zero -- a short event stays tappable. */
  height: number;
  /** Which sub-column this event occupies among its overlapping neighbours. */
  lane: number;
  /** How many sub-columns that cluster needs. */
  lanes: number;
}

export interface DaySplit {
  allDay: OwnedEvent[];
  timed: OwnedEvent[];
}

/** The consecutive days the view shows, starting at `start`. */
export function dayColumns(start: Date, count: number): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < count; i++) days.push(addDays(start, i));
  return days;
}

/**
 * Split a day's events into the all-day band and the timed grid.
 *
 * A multi-day timed event (rare, but a flight does it) is treated as all-day
 * on the days it merely passes through, because a block taller than the grid
 * tells the reader nothing.
 */
export function splitDay(events: OwnedEvent[], day: Date): DaySplit {
  const onDay = eventsOnDay(events, day);
  const allDay: OwnedEvent[] = [];
  const timed: OwnedEvent[] = [];

  for (const event of onDay) {
    if (event.all_day) {
      allDay.push(event);
      continue;
    }
    const start = parseHaDate(event.start);
    const end = parseHaDate(event.end);
    if (sameDay(start, day) && sameDay(end, day)) timed.push(event);
    else if (sameDay(start, day) || sameDay(end, day)) timed.push(event);
    else allDay.push(event);
  }
  return { allDay, timed };
}

/**
 * The hour window wide enough to show every timed event, never narrower than
 * the default. A day with a 06:00 swim practice widens the grid rather than
 * hiding it above the top edge.
 */
export function hourRangeFor(
  events: OwnedEvent[],
  days: Date[],
  now?: Date,
): HourRange {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;

  // Always keep the current hour on the grid when today is visible. Otherwise
  // the now-line silently disappears late in the evening, which on a wall
  // calendar reads as the display having frozen.
  if (now && days.some((day) => sameDay(day, now))) {
    startHour = Math.min(startHour, now.getHours());
    endHour = Math.max(endHour, now.getHours() + 1);
  }

  for (const day of days) {
    for (const event of splitDay(events, day).timed) {
      const { startMinutes, endMinutes } = minutesWithinDay(event, day);
      startHour = Math.min(startHour, Math.floor(startMinutes / MINUTES_PER_HOUR));
      endHour = Math.max(endHour, Math.ceil(endMinutes / MINUTES_PER_HOUR));
    }
  }
  return {
    startHour: Math.max(0, startHour),
    endHour: Math.min(24, Math.max(endHour, startHour + 1)),
  };
}

/** Where an event begins and ends in minutes from midnight, clipped to `day`. */
export function minutesWithinDay(
  event: OwnedEvent,
  day: Date,
): { startMinutes: number; endMinutes: number } {
  const start = parseHaDate(event.start);
  const end = parseHaDate(event.end);

  const startMinutes = sameDay(start, day)
    ? start.getHours() * MINUTES_PER_HOUR + start.getMinutes()
    : 0;
  const endMinutes = sameDay(end, day)
    ? end.getHours() * MINUTES_PER_HOUR + end.getMinutes()
    : 24 * MINUTES_PER_HOUR;

  return { startMinutes, endMinutes: Math.max(endMinutes, startMinutes + 1) };
}

/**
 * Place a day's timed events, splitting overlapping ones into side-by-side
 * lanes.
 *
 * Events are clustered by transitive overlap: A overlaps B and B overlaps C
 * puts all three in one cluster, three lanes wide, even when A and C do not
 * themselves overlap. That keeps a column's blocks aligned instead of
 * reflowing halfway down.
 */
export function layoutDay(
  events: OwnedEvent[],
  day: Date,
  range: HourRange,
): PositionedEvent[] {
  const spanStart = range.startHour * MINUTES_PER_HOUR;
  const spanEnd = range.endHour * MINUTES_PER_HOUR;
  const span = Math.max(1, spanEnd - spanStart);

  const items = splitDay(events, day)
    .timed.map((event) => {
      const { startMinutes, endMinutes } = minutesWithinDay(event, day);
      return { event, startMinutes, endMinutes };
    })
    .sort((a, b) =>
      a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
    );

  const positioned: PositionedEvent[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    // Greedy lane assignment: reuse the first lane whose last event has ended.
    const laneEnds: number[] = [];
    const lanes: number[] = [];
    for (const item of cluster) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane]! > item.startMinutes) {
        lane++;
      }
      laneEnds[lane] = item.endMinutes;
      lanes.push(lane);
    }
    const laneCount = laneEnds.length;
    cluster.forEach((item, index) => {
      const top = (item.startMinutes - spanStart) / span;
      const bottom = (item.endMinutes - spanStart) / span;
      positioned.push({
        event: item.event,
        top: clamp(top),
        // A 15-minute event would otherwise be an unreadable sliver.
        height: Math.max(clamp(bottom) - clamp(top), 0.012),
        lane: lanes[index]!,
        lanes: laneCount,
      });
    });
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (cluster.length && item.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flush();

  return positioned;
}

/** Hour labels down the time axis, inclusive of both ends. */
export function hourLabels(range: HourRange): number[] {
  const hours: number[] = [];
  for (let hour = range.startHour; hour <= range.endHour; hour++) {
    hours.push(hour);
  }
  return hours;
}

/** `2 pm`, `11 am` -- short, because the axis is narrow. */
export function formatHour(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized < 12 ? "am" : "pm";
  const display = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${display} ${suffix}`;
}

/** Where "now" sits in the visible span, or `null` if it is off-grid. */
export function nowOffset(range: HourRange, now = new Date()): number | null {
  const minutes = now.getHours() * MINUTES_PER_HOUR + now.getMinutes();
  const spanStart = range.startHour * MINUTES_PER_HOUR;
  const spanEnd = range.endHour * MINUTES_PER_HOUR;
  if (minutes < spanStart || minutes > spanEnd) return null;
  return (minutes - spanStart) / Math.max(1, spanEnd - spanStart);
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
