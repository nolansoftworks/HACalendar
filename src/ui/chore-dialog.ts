import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import type { ChoreItem } from "../ha/chores.js";
import type { Person } from "../people.js";
import { findDuplicate } from "./chore-list.js";
import { formatDate } from "./event-form.js";
import "./person-picker.js";

export type ChoreDialogMode = "add" | "who";

export interface ChoreAddDetail {
  summary: string;
  due: string;
}

/**
 * Two small chore dialogs sharing one shell.
 *
 * **add** — name the chore, optionally give it a due date. If an outstanding
 * chore already has that name it says so, but does **not** refuse: items are
 * addressed by uid, so duplicates break nothing ([ADR-0029]). Refusing a
 * child's legitimate entry to prevent a corruption that cannot happen would be
 * the worse bug.
 *
 * **who** — *"who did this?"* on check-off ([ADR-0018]). Attribution, not auth:
 * anyone may pick anyone, and a sibling emptying the dishwasher is exactly the
 * case this exists for. The chore stays on its owner's list either way.
 *
 * Fires `chore-add`, `chore-who` and `chore-cancel`.
 */
export class ChoreDialog extends LitElement {
  static override properties = {
    mode: { type: String },
    person: { attribute: false },
    people: { attribute: false },
    item: { attribute: false },
    existing: { attribute: false },
    busy: { type: Boolean },
    error: { type: String },
    _summary: { state: true },
    _due: { state: true },
    _who: { state: true },
  };

  mode: ChoreDialogMode = "add";
  /** Whose list is being added to, or whose chore is being ticked. */
  person: Person | null = null;
  /** Everyone, for the "who did this?" picker. */
  people: Person[] = [];
  item: ChoreItem | null = null;
  /** The current list, used only to notice a same-named chore. */
  existing: ChoreItem[] = [];
  busy = false;
  error: string | null = null;

  _summary = "";
  _due = "";
  _who = "";

  #initialized = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (this.#initialized && !changed.has("mode") && !changed.has("item")) return;
    this.#initialized = true;
    this._summary = "";
    // Default a new chore to today: a chore with no date never becomes
    // overdue, and overdue-ness is the whole accountability signal ([ADR-0013]).
    this._due = formatDate(new Date());
    // Pre-select the list's owner -- usually right, and one tap either way.
    this._who = this.person ? this.person.id : "";
  }

  #cancel(): void {
    this.dispatchEvent(
      new CustomEvent("chore-cancel", { bubbles: true, composed: true }),
    );
  }

  #submit(): void {
    if (this.mode === "add") {
      if (!this._summary.trim()) {
        this.error = "Give the chore a name.";
        return;
      }
      this.dispatchEvent(
        new CustomEvent<ChoreAddDetail>("chore-add", {
          detail: { summary: this._summary.trim(), due: this._due },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    if (!this._who) {
      this.error = "Tap a name.";
      return;
    }
    this.dispatchEvent(
      new CustomEvent("chore-who", {
        detail: { personId: this._who },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const adding = this.mode === "add";
    const clash = adding ? findDuplicate(this.existing, this._summary) : null;

    return html`
      <div class="scrim" @click=${this.#cancel}></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <h1>
          ${adding
            ? `Add a chore for ${this.person?.name ?? ""}`
            : "Who did this?"}
        </h1>
        ${!adding && this.item
          ? html`<p class="lede">${this.item.summary}</p>`
          : nothing}
        ${this.error
          ? html`<p class="error" role="alert">${this.error}</p>`
          : nothing}

        ${adding
          ? html`
              <label class="field">
                <span>What needs doing?</span>
                <input
                  id="chore-name"
                  type="text"
                  .value=${this._summary}
                  placeholder="Feed the dog"
                  @input=${(e: Event) => {
                    this._summary = (e.target as HTMLInputElement).value;
                  }}
                />
              </label>
              ${clash
                ? html`<p class="note" role="status">
                    ${this.person?.name ?? "They"} already has a
                    “${clash.summary}” to do. Adding another is fine — it just
                    means two.
                  </p>`
                : nothing}
              <label class="field">
                <span>Due</span>
                <input
                  id="chore-due"
                  type="date"
                  .value=${this._due}
                  @input=${(e: Event) => {
                    this._due = (e.target as HTMLInputElement).value;
                  }}
                />
              </label>
            `
          : html`
              <hacal-person-picker
                .people=${this.people}
                .selected=${this._who}
                heading=""
                @pick=${(e: CustomEvent<{ ownerId: string }>) => {
                  this._who = e.detail.ownerId;
                }}
              ></hacal-person-picker>
            `}

        <div class="actions">
          <span class="spacer"></span>
          <button id="chore-cancel" ?disabled=${this.busy} @click=${this.#cancel}>
            Cancel
          </button>
          <button
            id="chore-ok"
            class="primary"
            ?disabled=${this.busy}
            @click=${this.#submit}
          >
            ${this.busy ? "Saving…" : adding ? "Add" : "Done"}
          </button>
        </div>
      </div>
    `;
  }

  static override styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 20;
      font-family: system-ui, sans-serif;
    }
    .scrim {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.45);
    }
    .sheet {
      position: relative;
      max-width: 30rem;
      max-height: 92vh;
      margin: 4vh auto;
      padding: 20px;
      overflow-y: auto;
      background: #fff;
      color: #1c1c1c;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 1.25rem;
    }
    .lede {
      margin: 0 0 14px;
      font-size: 1rem;
      opacity: 0.7;
    }
    .error {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #fdecea;
      color: #8c1d18;
    }
    .note {
      margin: -6px 0 12px;
      padding: 9px 12px;
      border-radius: 8px;
      background: #fff4e6;
      color: #8a5300;
      font-size: 0.83rem;
    }
    .field {
      display: block;
      margin-bottom: 14px;
    }
    .field span {
      display: block;
      margin-bottom: 4px;
      font-size: 0.85rem;
      opacity: 0.7;
    }
    .field input {
      width: 100%;
      min-height: 48px;
      padding: 0 12px;
      font-size: 1.05rem;
      font-family: inherit;
      color: inherit;
      background: #f4f4f4;
      border: 2px solid #dcdcdc;
      border-radius: 10px;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
    }
    .spacer {
      flex: 1;
    }
    .actions button {
      min-height: 52px;
      padding: 0 20px;
      font-size: 1rem;
      font-family: inherit;
      background: #e6e6e6;
      color: inherit;
      border: none;
      border-radius: 12px;
      cursor: pointer;
    }
    .actions button.primary {
      background: #0b7285;
      color: #fff;
      font-weight: 600;
    }
    .actions button[disabled] {
      opacity: 0.5;
    }
  `;
}

customElements.define("hacal-chore-dialog", ChoreDialog);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-chore-dialog": ChoreDialog;
  }
}
