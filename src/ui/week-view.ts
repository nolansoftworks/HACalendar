import { LitElement, html, css, nothing } from "lit";
import { parseHaDate } from "../ha/calendar.js";
import { readableTextOn, sameDay, tint, type OwnedEvent } from "./grid.js";
import {
  formatHour,
  hourLabels,
  hourRangeFor,
  layoutDay,
  splitDay,
  nowOffset,
} from "./week-layout.js";

/**
 * The day-column time grid -- the appliance's primary view ([ADR-0027]).
 *
 * Presentational on purpose: it takes events and reports taps. Subscriptions,
 * the roster and the edit dialog all live in the shell, so the month view and
 * this one cannot drift apart or double-subscribe.
 *
 * Fires `pick-day` (with `{ day, hour }`) and `pick-event`.
 */
export class WeekView extends LitElement {
  static override properties = {
    days: { attribute: false },
    events: { attribute: false },
    initials: { attribute: false },
    now: { attribute: false },
  };

  days: Date[] = [];
  events: OwnedEvent[] = [];
  /** ownerId -> the letter shown on an event's avatar dot. */
  initials: Map<string, string> = new Map();
  now: Date = new Date();

  /** Scroll-to-now happens once per mount, not on every event push. */
  #anchored = false;

  override updated(): void {
    if (this.#anchored || !this.days.length) return;
    const scroller = this.renderRoot.querySelector(".scroll");
    if (!(scroller instanceof HTMLElement) || !scroller.scrollHeight) return;

    // A wall calendar that opens at 7am while the day happens at 5pm is
    // useless. Put "now" about a third down, so the rest of the day is the
    // part you can see. Falls back to mid-morning when now is off-grid.
    const range = hourRangeFor(this.events, this.days, this.now);
    const offset = nowOffset(range, this.now) ?? 0.15;
    const target =
      offset * scroller.scrollHeight - scroller.clientHeight / 3;
    scroller.scrollTop = Math.max(0, target);
    this.#anchored = true;
  }

  #pickDay(day: Date, hour: number): void {
    this.dispatchEvent(
      new CustomEvent("pick-day", {
        detail: { day, hour },
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
    const range = hourRangeFor(this.events, this.days, this.now);
    const hours = hourLabels(range);
    const marker = nowOffset(range, this.now);
    const today = this.days.filter((day) => sameDay(day, this.now))[0];

    return html`
      <div class="head">
        <div class="axis-spacer"></div>
        ${this.days.map((day) => {
          const isToday = sameDay(day, this.now);
          return html`
            <div class="daycol head-cell">
              <span class="dow">${WEEKDAYS[day.getDay()]}</span>
              <span class="dom ${isToday ? "today" : ""}"
                >${day.getDate()}</span
              >
            </div>
          `;
        })}
      </div>

      <div class="allday">
        <div class="axis-spacer"></div>
        ${this.days.map((day) => {
          const band = splitDay(this.events, day).allDay;
          return html`
            <div class="daycol band" @click=${() => this.#pickDay(day, 9)}>
              ${band.map(
                (event) => html`
                  <span
                    class="pill"
                    title=${event.summary}
                    style="background:${tint(event.color, 0.9)};color:${readableTextOn(
                      event.color,
                    )}"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.#pickEvent(event);
                    }}
                    >${event.summary}</span
                  >
                `,
              )}
            </div>
          `;
        })}
      </div>

      <div class="scroll">
        <div class="grid">
          <div class="axis">
            ${hours.map(
              (hour) => html`<div class="hour"><span>${formatHour(hour)}</span></div>`,
            )}
          </div>

          ${this.days.map((day) => {
            const blocks = layoutDay(this.events, day, range);
            return html`
              <div class="daycol column">
                ${hours.map(
                  (hour, index) => html`
                    <div
                      class="slot ${index === hours.length - 1 ? "last" : ""}"
                      @click=${() => this.#pickDay(day, hour)}
                    ></div>
                  `,
                )}
                ${blocks.map((block) => {
                  const width = 100 / block.lanes;
                  return html`
                    <button
                      class="block"
                      title=${block.event.summary}
                      style="top:${(block.top * 100).toFixed(3)}%;
                             height:${(block.height * 100).toFixed(3)}%;
                             left:${(block.lane * width).toFixed(3)}%;
                             width:${width.toFixed(3)}%;
                             background:${tint(block.event.color, 0.32)};
                             border-left-color:${block.event.color}"
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this.#pickEvent(block.event);
                      }}
                    >
                      <span class="title">${block.event.summary}</span>
                      <span class="when"
                        >${formatRange(block.event)}</span
                      >
                      <span
                        class="who"
                        style="background:${block.event.color};color:${readableTextOn(
                          block.event.color,
                        )}"
                        >${this.initials.get(block.event.ownerId) ?? ""}</span
                      >
                    </button>
                  `;
                })}
                ${today && sameDay(day, this.now) && marker !== null
                  ? html`<div
                      class="nowline"
                      style="top:${(marker * 100).toFixed(3)}%"
                    ></div>`
                  : nothing}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  // Chrome 87 floor: no :has(), no nesting, no container queries.
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--hacal-bg, #fff);
      color: #1c1c1c;
      font-family: system-ui, sans-serif;
    }
    .head,
    .allday,
    .grid {
      display: flex;
    }
    .axis-spacer {
      flex: 0 0 52px;
    }
    .daycol {
      flex: 1 1 0;
      min-width: 0;
      border-left: 1px solid #ededed;
    }
    .head-cell {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 10px 10px 8px;
    }
    .dow {
      font-size: 0.85rem;
      opacity: 0.55;
    }
    .dom {
      font-size: 1.35rem;
      font-weight: 600;
    }
    .dom.today {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      height: 32px;
      padding: 0 6px;
      border-radius: 16px;
      background: var(--hacal-accent, #e8590c);
      color: #fff;
      font-size: 1.05rem;
    }
    .allday {
      border-bottom: 1px solid #e3e3e3;
    }
    .band {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-height: 26px;
      padding: 3px 4px 5px;
      cursor: pointer;
    }
    .pill {
      overflow: hidden;
      padding: 3px 7px;
      border-radius: 5px;
      font-size: 0.72rem;
      font-weight: 600;
      white-space: nowrap;
      text-overflow: ellipsis;
      cursor: pointer;
    }
    .scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .grid {
      min-height: 100%;
    }
    .axis {
      flex: 0 0 52px;
    }
    .hour {
      position: relative;
      height: 56px;
    }
    .hour span {
      position: absolute;
      top: -8px;
      right: 8px;
      font-size: 0.7rem;
      opacity: 0.5;
    }
    .column {
      position: relative;
    }
    .slot {
      height: 56px;
      border-top: 1px solid #f0f0f0;
      cursor: pointer;
    }
    .slot.last {
      border-bottom: 1px solid #f0f0f0;
    }
    .block {
      position: absolute;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 3px 6px;
      font-family: inherit;
      text-align: left;
      color: inherit;
      border: none;
      border-left: 3px solid;
      border-radius: 6px;
      cursor: pointer;
    }
    .title {
      overflow: hidden;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .when {
      font-size: 0.68rem;
      opacity: 0.7;
    }
    .who {
      position: absolute;
      right: 4px;
      bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 17px;
      height: 17px;
      border-radius: 50%;
      font-size: 0.6rem;
      font-weight: 700;
    }
    .nowline {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: #e03131;
      pointer-events: none;
    }
  `;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatRange(event: OwnedEvent): string {
  const start = parseHaDate(event.start);
  const end = parseHaDate(event.end);
  return `${short(start)} - ${short(end)}`;
}

function short(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours < 12 ? "am" : "pm";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${display}${suffix}`
    : `${display}:${minutes < 10 ? "0" : ""}${minutes}${suffix}`;
}

customElements.define("hacal-week-view", WeekView);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-week-view": WeekView;
  }
}
