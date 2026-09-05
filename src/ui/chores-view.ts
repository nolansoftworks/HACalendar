import { LitElement, html, css, nothing } from "lit";
import type { ChoreItem } from "../ha/chores.js";
import type { Person } from "../people.js";
import { readableTextOn, tint } from "./grid.js";
import {
  choreProgress,
  daysOverdue,
  isDone,
  isDueToday,
  isOverdue,
  sortChores,
} from "./chore-list.js";

/**
 * The chore board: one column per person, tap a row to tick it off.
 *
 * Children use this, so: big targets, no hover affordances, and status carried
 * by more than colour — an overdue chore says "2 days late" in words, because
 * a child who cannot read fluently still counts, and a colour-blind adult
 * still reads.
 *
 * Presentational. The shell owns the subscriptions and does the writing.
 *
 * Fires `toggle-chore` ({ person, item }), `add-chore` ({ person }) and
 * `make-list` ({ person }).
 */
export class ChoresView extends LitElement {
  static override properties = {
    people: { attribute: false },
    itemsByList: { attribute: false },
    now: { attribute: false },
    busyUids: { attribute: false },
  };

  people: Person[] = [];
  /** chore list entity id -> its items, as HA last pushed them. */
  itemsByList: Map<string, ChoreItem[]> = new Map();
  now: Date = new Date();
  /** Item uids with a write in flight, so a double tap can't double-fire. */
  busyUids: string[] = [];

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }

  override render() {
    if (!this.people.length) {
      return html`<p class="empty">
        Add people in Settings and everyone gets a chore list.
      </p>`;
    }

    return html`
      <div class="board">
        ${this.people.map((person) => this.#column(person))}
      </div>
    `;
  }

  #column(person: Person) {
    if (!person.choreList) {
      return html`
        <section class="column">
          ${this.#head(person, null)}
          <p class="nolist">
            ${person.name} doesn't have a chore list yet.
            <button
              class="make"
              @click=${() => this.#emit("make-list", { person })}
            >
              Create one
            </button>
          </p>
        </section>
      `;
    }

    const items = sortChores(
      this.itemsByList.get(person.choreList) ?? [],
      this.now,
    );

    return html`
      <section class="column">
        ${this.#head(person, items)}
        <ul class="chores">
          ${items.length === 0
            ? html`<li class="none">Nothing on the list</li>`
            : items.map((item) => this.#row(person, item))}
        </ul>
        <button
          class="add"
          @click=${() => this.#emit("add-chore", { person })}
        >
          + Add a chore
        </button>
      </section>
    `;
  }

  #head(person: Person, items: ChoreItem[] | null) {
    const progress = items
      ? choreProgress(items, this.now)
      : { done: 0, total: 0, overdue: 0, dueToday: 0 };
    const pct = progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

    return html`
      <header style="background:${tint(person.color, 0.16)}">
        <span
          class="dot"
          style="background:${person.color};color:${readableTextOn(person.color)}"
          >${person.name.slice(0, 1).toUpperCase()}</span
        >
        <span class="who">
          <span class="name">${person.name}</span>
          <span class="tally">
            ${progress.done}/${progress.total} done
            ${progress.overdue
              ? html`<span class="late">${progress.overdue} late</span>`
              : nothing}
          </span>
        </span>
        <span class="ring">
          <span
            class="ring-fill"
            style="width:${pct}%;background:${person.color}"
          ></span>
        </span>
      </header>
    `;
  }

  #row(person: Person, item: ChoreItem) {
    const done = isDone(item);
    const late = isOverdue(item, this.now);
    const busy = this.busyUids.indexOf(item.uid) !== -1;
    const lateDays = daysOverdue(item, this.now);

    return html`
      <li>
        <button
          class="chore ${done ? "done" : ""} ${late ? "late" : ""}"
          ?disabled=${busy}
          aria-pressed=${done ? "true" : "false"}
          @click=${() => this.#emit("toggle-chore", { person, item })}
        >
          <span
            class="box"
            style=${done ? `background:${person.color};border-color:${person.color}` : ""}
            >${done ? "✓" : ""}</span
          >
          <span class="label">
            <span class="summary">${item.summary}</span>
            ${late
              ? html`<span class="when late-text"
                  >${lateDays} ${lateDays === 1 ? "day" : "days"} late</span
                >`
              : isDueToday(item, this.now)
                ? html`<span class="when today">Today</span>`
                : item.due
                  ? html`<span class="when">${formatDue(item.due)}</span>`
                  : nothing}
          </span>
        </button>
      </li>
    `;
  }

  // Chrome 87 floor: no :has(), no nesting, no container queries.
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      overflow: auto;
      font-family: system-ui, sans-serif;
      color: #1c1c1c;
    }
    .empty {
      margin: 2rem;
      opacity: 0.6;
    }
    .board {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px;
    }
    .column {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      background: #fafbfc;
      border-radius: 14px;
    }
    header {
      display: flex;
      align-items: center;
      gap: 9px;
      flex-wrap: wrap;
      padding: 10px 12px;
    }
    .dot {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      font-weight: 700;
    }
    .who {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: 0.95rem;
      font-weight: 700;
    }
    .tally {
      font-size: 0.75rem;
      opacity: 0.75;
    }
    .late {
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 8px;
      background: #c92a2a;
      color: #fff;
      font-weight: 600;
      opacity: 1;
    }
    .ring {
      display: block;
      flex: 0 0 100%;
      height: 5px;
      overflow: hidden;
      background: rgba(0, 0, 0, 0.09);
      border-radius: 3px;
    }
    .ring-fill {
      display: block;
      height: 100%;
      border-radius: 3px;
    }
    ul.chores {
      margin: 0;
      padding: 6px;
      list-style: none;
    }
    li {
      margin-bottom: 6px;
    }
    .none {
      padding: 10px 8px;
      font-size: 0.85rem;
      opacity: 0.5;
    }
    .chore {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      /* Children tap this. 44px is the floor, not the target. */
      min-height: 56px;
      padding: 8px 10px;
      background: #fff;
      border: none;
      border-radius: 10px;
      font-family: inherit;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .chore.late {
      box-shadow: inset 3px 0 0 #c92a2a;
    }
    .chore.done {
      opacity: 0.55;
    }
    .chore[disabled] {
      opacity: 0.4;
    }
    .box {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 30px;
      width: 30px;
      height: 30px;
      border: 2px solid #c9ccd1;
      border-radius: 8px;
      color: #fff;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .label {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .summary {
      font-size: 0.95rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chore.done .summary {
      text-decoration: line-through;
    }
    .when {
      font-size: 0.72rem;
      opacity: 0.6;
    }
    .when.today {
      color: #0b7285;
      font-weight: 600;
      opacity: 1;
    }
    .when.late-text {
      color: #c92a2a;
      font-weight: 700;
      opacity: 1;
    }
    .add,
    .make {
      margin: 4px 6px 8px;
      min-height: 48px;
      padding: 0 14px;
      background: transparent;
      border: 2px dashed #d2d5da;
      border-radius: 10px;
      font-family: inherit;
      font-size: 0.9rem;
      color: inherit;
      cursor: pointer;
    }
    .nolist {
      margin: 10px 12px 14px;
      font-size: 0.85rem;
      opacity: 0.8;
    }
  `;
}

function formatDue(due: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!match) return due;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

customElements.define("hacal-chores-view", ChoresView);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-chores-view": ChoresView;
  }
}
