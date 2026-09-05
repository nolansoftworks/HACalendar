import { LitElement, html, css, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { ChoreItem } from "../ha/chores.js";
import type { HouseholdList } from "../ha/lists.js";
import { cleanEntry, isTicked, listProgress, listSummary, sortListItems } from "./list-order.js";

/**
 * The lists board: the shopping list, the packing list, whatever else.
 *
 * Columns like the chore board, so the appliance has one visual grammar — but
 * the interaction is deliberately different in one way: **adding is inline,
 * not a dialog.** A chore is added once and thought about; a list is filled in
 * bursts, and "milk, eggs, bread" must be three quick types into a box that is
 * already there, not three round trips through a sheet that opens, takes a
 * name, and closes. The box keeps focus after each add for exactly that
 * reason.
 *
 * No due dates, no owner, no logbook attribution: a list is not a chore, and
 * [ADR-0014]'s "who did it" question is a chores question. Nobody needs a
 * record of who ticked off the milk.
 *
 * Presentational. The shell owns the subscriptions and does the writing.
 *
 * Fires `toggle-item` ({ list, item }), `add-item` ({ list, summary }),
 * `delete-item` ({ list, item }), `clear-done` ({ list }),
 * `delete-list` ({ list }) and `create-list` ({ name }).
 */
export class ListsView extends LitElement {
  static override properties = {
    lists: { attribute: false },
    itemsByList: { attribute: false },
    busyUids: { attribute: false },
    creating: { attribute: false },
    _confirming: { state: true },
  };

  lists: HouseholdList[] = [];
  /** list entity id -> its items, as HA last pushed them. */
  itemsByList: Map<string, ChoreItem[]> = new Map();
  /** Item uids with a write in flight, so a double tap can't double-fire. */
  busyUids: string[] = [];
  /** True while a new list is being made, so the button can say so. */
  creating = false;
  /**
   * What is awaiting a second tap, as a prefixed key — `item:<uid>`,
   * `clear:<entity>` or `kill:<entity>`. One field, because only one thing can
   * be half-confirmed at a time and a stray tap elsewhere should cancel it.
   */
  _confirming: string | null = null;

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }

  /** Two taps for anything that cannot be undone. Returns true on the second. */
  #confirm(key: string): boolean {
    if (this._confirming !== key) {
      this._confirming = key;
      return false;
    }
    this._confirming = null;
    return true;
  }

  override render() {
    return html`
      <div class="board">
        ${repeat(
          this.lists,
          (list) => list.entityId,
          (list) => this.#column(list),
        )}
        ${this.#newColumn()}
      </div>
    `;
  }

  #column(list: HouseholdList) {
    const items = sortListItems(this.itemsByList.get(list.entityId) ?? []);
    const { done } = listProgress(items);
    const clearKey = `clear:${list.entityId}`;
    const killKey = `kill:${list.entityId}`;

    return html`
      <section class="column">
        <header>
          <span class="who">
            <span class="name">${list.name}</span>
            <span class="tally">${listSummary(items)}</span>
          </span>
          <button
            class="kill ${this._confirming === killKey ? "confirm" : ""}"
            aria-label=${this._confirming === killKey
              ? `Tap again to delete the ${list.name} list and everything on it`
              : `Delete the ${list.name} list`}
            title=${this._confirming === killKey
              ? "Tap again to delete the whole list"
              : "Delete this list"}
            @click=${() => {
              if (this.#confirm(killKey)) {
                this.#emit("delete-list", { list });
              }
            }}
          >
            ${this._confirming === killKey ? "Delete list?" : "×"}
          </button>
        </header>

        <ul class="items">
          ${items.length === 0
            ? html`<li class="none">Nothing on it yet</li>`
            : repeat(
                items,
                (item) => item.uid,
                (item) => this.#row(list, item),
              )}
        </ul>

        <form
          class="addrow"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.#submit(list, e.currentTarget as HTMLFormElement);
          }}
        >
          <input
            id="add-${cssId(list.entityId)}"
            type="text"
            name="entry"
            autocomplete="off"
            placeholder="Add something"
            aria-label="Add something to ${list.name}"
          />
          <button class="plus" type="submit" aria-label="Add to ${list.name}">
            +
          </button>
        </form>

        ${done
          ? html`
              <button
                class="clear ${this._confirming === clearKey ? "confirm" : ""}"
                @click=${() => {
                  if (this.#confirm(clearKey)) {
                    this.#emit("clear-done", { list });
                  }
                }}
              >
                ${this._confirming === clearKey
                  ? `Remove ${done} ticked ${done === 1 ? "thing" : "things"}?`
                  : "Clear ticked"}
              </button>
            `
          : nothing}
      </section>
    `;
  }

  /**
   * Making a list is the same inline gesture as adding to one.
   *
   * It sits at the end of the board rather than behind a settings screen: a
   * household that decides mid-week it wants a "Camping" list should be able
   * to have one without leaving the wall.
   */
  #newColumn() {
    return html`
      <section class="column new">
        <form
          class="addrow"
          @submit=${(e: Event) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement;
            const input = form.elements.namedItem("entry") as HTMLInputElement;
            const name = cleanEntry(input.value);
            if (!name) return;
            input.value = "";
            this.#emit("create-list", { name });
          }}
        >
          <input
            id="new-list"
            type="text"
            name="entry"
            autocomplete="off"
            placeholder="New list"
            aria-label="Name for a new list"
            ?disabled=${this.creating}
          />
          <button
            class="plus"
            type="submit"
            aria-label="Make this list"
            ?disabled=${this.creating}
          >
            +
          </button>
        </form>
        <p class="hint">
          ${this.creating
            ? "Making it…"
            : this.lists.length
              ? "Name it and it appears here."
              : "No lists yet. Name one and it appears here."}
        </p>
      </section>
    `;
  }

  #submit(list: HouseholdList, form: HTMLFormElement): void {
    const input = form.elements.namedItem("entry") as HTMLInputElement;
    const summary = cleanEntry(input.value);
    if (!summary) return;
    input.value = "";
    // Straight back to an empty box, still focused: the next thing is usually
    // one word away.
    input.focus();
    this.#emit("add-item", { list, summary });
  }

  #row(list: HouseholdList, item: ChoreItem) {
    const ticked = isTicked(item);
    const busy = this.busyUids.indexOf(item.uid) !== -1;
    const key = `item:${item.uid}`;
    const confirming = this._confirming === key;

    return html`
      <li class="row">
        <button
          class="item ${ticked ? "ticked" : ""}"
          ?disabled=${busy}
          aria-pressed=${ticked ? "true" : "false"}
          @click=${() => this.#emit("toggle-item", { list, item })}
        >
          <span class="box">${ticked ? "✓" : ""}</span>
          <span class="summary">${item.summary}</span>
        </button>
        <button
          class="kill ${confirming ? "confirm" : ""}"
          ?disabled=${busy}
          aria-label=${confirming
            ? `Tap again to delete ${item.summary}`
            : `Delete ${item.summary}`}
          title=${confirming ? "Tap again to delete" : "Delete this"}
          @click=${() => {
            if (this.#confirm(key)) this.#emit("delete-item", { list, item });
          }}
        >
          ${confirming ? "Delete?" : "×"}
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
    .column.new {
      background: transparent;
      border: 2px dashed #e0e3e8;
    }
    header {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 10px 12px;
      background: #eef1f6;
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
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tally {
      font-size: 0.75rem;
      opacity: 0.7;
    }
    ul.items {
      margin: 0;
      padding: 6px;
      list-style: none;
    }
    li {
      margin-bottom: 6px;
    }
    li.row {
      display: flex;
      align-items: stretch;
      gap: 4px;
    }
    .none {
      padding: 10px 8px;
      font-size: 0.85rem;
      opacity: 0.5;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
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
    .item.ticked {
      opacity: 0.5;
    }
    .item[disabled] {
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
      color: #495057;
      font-size: 1.1rem;
      font-weight: 700;
    }
    .item.ticked .box {
      background: #e9ecef;
    }
    .summary {
      font-size: 0.95rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item.ticked .summary {
      text-decoration: line-through;
    }
    .kill {
      flex: 0 0 44px;
      min-height: 56px;
      padding: 0;
      background: #fff;
      border: none;
      border-radius: 10px;
      font-family: inherit;
      font-size: 1.3rem;
      line-height: 1;
      color: #b0b4bb;
      cursor: pointer;
    }
    .kill.confirm {
      flex: 0 0 auto;
      padding: 0 10px;
      background: #8c1d18;
      color: #fff;
      font-size: 0.85rem;
      font-weight: 700;
    }
    .kill[disabled] {
      opacity: 0.4;
    }
    header .kill {
      min-height: 44px;
      background: transparent;
    }
    .addrow {
      display: flex;
      gap: 4px;
      margin: 2px 6px 8px;
    }
    .addrow input {
      flex: 1;
      min-width: 0;
      min-height: 48px;
      padding: 0 12px;
      background: #fff;
      border: 2px solid #e0e3e8;
      border-radius: 10px;
      font-family: inherit;
      font-size: 0.95rem;
      color: inherit;
    }
    .addrow input:focus {
      outline: none;
      border-color: var(--hacal-accent, #6741d9);
    }
    .plus {
      flex: 0 0 48px;
      min-height: 48px;
      padding: 0;
      background: var(--hacal-accent, #6741d9);
      border: none;
      border-radius: 10px;
      color: #fff;
      font-family: inherit;
      font-size: 1.4rem;
      line-height: 1;
      cursor: pointer;
    }
    .plus[disabled],
    .addrow input[disabled] {
      opacity: 0.5;
    }
    .clear {
      margin: 0 6px 8px;
      min-height: 44px;
      padding: 0 12px;
      background: transparent;
      border: 2px dashed #d2d5da;
      border-radius: 10px;
      font-family: inherit;
      font-size: 0.85rem;
      color: inherit;
      cursor: pointer;
    }
    .clear.confirm {
      background: #8c1d18;
      border-color: #8c1d18;
      color: #fff;
      font-weight: 700;
    }
    .hint {
      margin: 0 8px 10px;
      font-size: 0.78rem;
      opacity: 0.55;
    }
  `;
}

/** Entity ids carry a dot, which is not valid in the middle of an id here. */
function cssId(entityId: string): string {
  return entityId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

customElements.define("hacal-lists-view", ListsView);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-lists-view": ListsView;
  }
}
