import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import type { HaClient } from "../ha/client.js";
import {
  parseHaDate,
  subscribeCalendarEvents,
  type HaCalendarEvent,
} from "../ha/calendar.js";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKS_SHOWN = 6;
const DAYS_PER_WEEK = 7;

interface DayCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  events: HaCalendarEvent[];
}

/**
 * Month grid. Renders whatever `calendar/event/subscribe` pushes for the
 * visible range, and resubscribes when the month or entity changes.
 */
export class MonthView extends LitElement {
  static override properties = {
    client: { attribute: false },
    entityId: { attribute: false },
    _cursor: { state: true },
    _events: { state: true },
    _error: { state: true },
  };

  client!: HaClient;
  entityId = "calendar.family";

  _cursor: Date = startOfMonth(new Date());
  _events: HaCalendarEvent[] = [];
  _error: string | null = null;

  #unsubscribe: (() => Promise<void>) | null = null;
  // Guards against an out-of-order subscribe landing after a newer one when
  // the user taps through months faster than the websocket round-trips.
  #subscriptionToken = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#resubscribe();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    void this.#teardown();
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("_cursor") || changed.has("entityId") || changed.has("client")) {
      void this.#resubscribe();
    }
  }

  async #teardown(): Promise<void> {
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    if (unsubscribe) await unsubscribe();
  }

  async #resubscribe(): Promise<void> {
    if (!this.client) return;

    const token = ++this.#subscriptionToken;
    await this.#teardown();

    const { start, end } = visibleRange(this._cursor);
    try {
      const unsubscribe = await subscribeCalendarEvents(
        this.client,
        this.entityId,
        start,
        end,
        (events) => {
          if (token !== this.#subscriptionToken) return;
          this._events = events;
          this._error = null;
        },
      );

      // A newer subscription started while we were awaiting this one.
      if (token !== this.#subscriptionToken) {
        await unsubscribe();
        return;
      }
      this.#unsubscribe = unsubscribe;
    } catch (err) {
      if (token !== this.#subscriptionToken) return;
      this._error =
        err instanceof Error ? err.message : `Cannot read ${this.entityId}`;
    }
  }

  #shiftMonth(delta: number): void {
    this._cursor = new Date(
      this._cursor.getFullYear(),
      this._cursor.getMonth() + delta,
      1,
    );
  }

  #goToday(): void {
    this._cursor = startOfMonth(new Date());
  }

  override render() {
    const cells = buildGrid(this._cursor, this._events);
    const monthLabel = this._cursor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });

    return html`
      <header>
        <button @click=${() => this.#shiftMonth(-1)} aria-label="Previous month">
          &lsaquo;
        </button>
        <h1>${monthLabel}</h1>
        <button @click=${() => this.#shiftMonth(1)} aria-label="Next month">
          &rsaquo;
        </button>
        <button class="today" @click=${this.#goToday}>Today</button>
      </header>

      ${this._error
        ? html`<p class="error" role="alert">${this._error}</p>`
        : nothing}

      <div class="weekdays">
        ${WEEKDAY_LABELS.map((label) => html`<span>${label}</span>`)}
      </div>

      <div class="grid">
        ${cells.map(
          (cell) => html`
            <div
              class="cell ${cell.inMonth ? "" : "outside"} ${cell.isToday
                ? "today"
                : ""}"
            >
              <span class="daynum">${cell.date.getDate()}</span>
              ${cell.events.map(
                (event) => html`
                  <span class="chip" title=${event.summary}>
                    ${event.all_day
                      ? nothing
                      : html`<b>${formatTime(parseHaDate(event.start))}</b> `}
                    ${event.summary}
                  </span>
                `,
              )}
            </div>
          `,
        )}
      </div>
    `;
  }

  // Touch-first: 44px minimum hit targets, no hover-dependent affordances.
  // No :has(), no container queries, no CSS nesting -- all newer than Chrome 87.
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: system-ui, sans-serif;
      background: var(--hacal-bg, #fafafa);
      color: var(--hacal-fg, #1c1c1c);
      -webkit-tap-highlight-color: transparent;
    }
    header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
    }
    h1 {
      flex: 1;
      margin: 0;
      font-size: 1.5rem;
      text-align: center;
    }
    button {
      min-width: 44px;
      min-height: 44px;
      padding: 0 14px;
      font-size: 1.25rem;
      border: none;
      border-radius: 10px;
      background: var(--hacal-btn, #e6e6e6);
      color: inherit;
      cursor: pointer;
    }
    button.today {
      font-size: 0.95rem;
    }
    button:active {
      background: var(--hacal-btn-active, #d0d0d0);
    }
    .error {
      margin: 0 16px 8px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #fdecea;
      color: #8c1d18;
    }
    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      padding: 0 8px;
      font-size: 0.8rem;
      text-align: center;
      opacity: 0.6;
    }
    .grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-auto-rows: 1fr;
      gap: 4px;
      padding: 8px;
    }
    .cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 64px;
      padding: 4px;
      overflow: hidden;
      border-radius: 8px;
      background: var(--hacal-cell, #fff);
    }
    .cell.outside {
      opacity: 0.35;
    }
    .cell.today {
      outline: 2px solid var(--hacal-accent, #0b7285);
    }
    .daynum {
      font-size: 0.85rem;
      font-weight: 600;
    }
    .chip {
      overflow: hidden;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 0.75rem;
      white-space: nowrap;
      text-overflow: ellipsis;
      background: var(--hacal-chip, #d3f0f5);
    }
  `;
}

customElements.define("hacal-month-view", MonthView);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-month-view": MonthView;
  }
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** The 6x7 window the grid displays, which spills past the month on both ends. */
function visibleRange(cursor: Date): { start: Date; end: Date } {
  const start = addDays(cursor, -cursor.getDay());
  return { start, end: addDays(start, WEEKS_SHOWN * DAYS_PER_WEEK) };
}

function buildGrid(cursor: Date, events: HaCalendarEvent[]): DayCell[] {
  const { start } = visibleRange(cursor);
  const today = new Date();
  const cells: DayCell[] = [];

  for (let i = 0; i < WEEKS_SHOWN * DAYS_PER_WEEK; i++) {
    const date = addDays(start, i);
    cells.push({
      date,
      inMonth: date.getMonth() === cursor.getMonth(),
      isToday: sameDay(date, today),
      events: eventsOnDay(events, date),
    });
  }
  return cells;
}

/**
 * Events overlapping `day`. HA sends `end` exclusive, so an all-day event on
 * the 9th arrives as start=09 end=10 and must not bleed into the 10th.
 */
function eventsOnDay(events: HaCalendarEvent[], day: Date): HaCalendarEvent[] {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();

  return events
    .filter((event) => {
      const start = parseHaDate(event.start).getTime();
      const end = parseHaDate(event.end).getTime();
      return start < dayEnd && end > dayStart;
    })
    .sort((a, b) => {
      if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
      return parseHaDate(a.start).getTime() - parseHaDate(b.start).getTime();
    });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
