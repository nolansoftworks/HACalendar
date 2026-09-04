import { LitElement, html, css, nothing } from "lit";
import { parseHaDate } from "../ha/calendar.js";
import {
  buildGrid,
  formatTime,
  tint,
  weekdayLabels,
  type OwnedEvent,
} from "./grid.js";

/**
 * The month grid.
 *
 * Presentational: it takes events and reports taps. Subscriptions, the roster
 * and the edit dialog live in `app-shell.ts`, so this and the week view cannot
 * drift apart or double-subscribe.
 *
 * Since [ADR-0027] this is the *secondary* view — the appliance opens on the
 * day columns, and the month is one tap away for planning.
 *
 * Fires `pick-day` and `pick-event`.
 */
export class MonthView extends LitElement {
  static override properties = {
    cursor: { attribute: false },
    events: { attribute: false },
    weekStartsOn: { type: Number },
    now: { attribute: false },
  };

  cursor: Date = new Date();
  events: OwnedEvent[] = [];
  weekStartsOn = 0;
  now: Date = new Date();

  #pickDay(day: Date): void {
    this.dispatchEvent(
      new CustomEvent("pick-day", {
        detail: { day },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #pickEvent(event: OwnedEvent): void {
    this.dispatchEvent(
      new CustomEvent("pick-event", {
        detail: { event },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const cells = buildGrid(this.cursor, this.events, this.weekStartsOn, this.now);

    return html`
      <div class="weekdays">
        ${weekdayLabels(this.weekStartsOn).map(
          (label) => html`<span>${label}</span>`,
        )}
      </div>

      <div class="grid">
        ${cells.map(
          (cell) => html`
            <div
              class="cell ${cell.inMonth ? "" : "outside"} ${cell.isToday
                ? "today"
                : ""}"
              role="button"
              tabindex="0"
              aria-label="Add an event on ${cell.date.toDateString()}"
              @click=${() => this.#pickDay(cell.date)}
            >
              <span class="daynum ${cell.isToday ? "is-today" : ""}"
                >${cell.date.getDate()}</span
              >
              ${cell.events.map(
                (event) => html`
                  <span
                    class="chip"
                    role="button"
                    tabindex="0"
                    title=${event.summary}
                    style="background:${tint(
                      event.color,
                      0.3,
                    )};border-left-color:${event.color}"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.#pickEvent(event);
                    }}
                  >
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
  // No :has(), no container queries, no CSS nesting -- newer than Chrome 87.
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      font-family: system-ui, sans-serif;
      background: var(--hacal-bg, #fff);
      color: var(--hacal-fg, #1c1c1c);
    }
    .weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      padding: 6px 8px 2px;
      font-size: 0.78rem;
      text-align: center;
      opacity: 0.55;
    }
    .grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-auto-rows: 1fr;
      gap: 4px;
      padding: 4px 8px 8px;
      min-height: 0;
    }
    .cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-height: 64px;
      padding: 4px;
      overflow: hidden;
      border-radius: 8px;
      background: #fafbfc;
      cursor: pointer;
    }
    .cell.outside {
      opacity: 0.4;
    }
    .cell.today {
      background: #fff;
      outline: 2px solid var(--hacal-accent, #6741d9);
    }
    .daynum {
      font-size: 0.85rem;
      font-weight: 600;
    }
    .daynum.is-today {
      align-self: flex-start;
      min-width: 22px;
      padding: 1px 6px;
      border-radius: 11px;
      background: var(--hacal-accent, #e8590c);
      color: #fff;
      text-align: center;
    }
    .chip {
      overflow: hidden;
      padding: 2px 6px;
      border-left: 3px solid;
      border-radius: 5px;
      font-size: 0.74rem;
      white-space: nowrap;
      text-overflow: ellipsis;
      cursor: pointer;
    }
  `;
}

customElements.define("hacal-month-view", MonthView);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-month-view": MonthView;
  }
}
