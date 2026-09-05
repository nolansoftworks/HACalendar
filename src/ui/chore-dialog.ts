import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { parseHaDate } from "../ha/calendar.js";
import type { ChoreItem } from "../ha/chores.js";
import type { Person } from "../people.js";
import { findDuplicate } from "./chore-list.js";
import { formatDate } from "./event-form.js";
import {
  REPEAT_CHOICES,
  describeChoice,
  type RepeatChoice,
} from "./repeat-rule.js";

export interface ChoreAddDetail {
  summary: string;
  due: string;
  /**
   * Anything but `none` makes this a *rule* on the person's chore schedule
   * calendar rather than a one-off item ([ADR-0030]). The shell decides what
   * that means; the dialog only asks the question.
   */
  repeat: RepeatChoice;
}

/**
 * Adding a chore to somebody's list.
 *
 * If an outstanding chore already has that name it says so, but does **not**
 * refuse: items are addressed by uid, so duplicates break nothing
 * ([ADR-0029]). Refusing a child's legitimate entry to prevent a corruption
 * that cannot happen would be the worse bug.
 *
 * *"Does this happen again?"* is asked right here rather than behind a
 * separate "make this recurring" screen: a repeating chore is the normal case
 * for a household, and hiding it would mean the wall calendar never grows one.
 * `todo` cannot repeat ([ADR-0008]), so a repeat becomes a calendar rule that
 * the nightly automation materializes — but that is machinery, and what the
 * dialog says is "Every Tuesday".
 *
 * There was briefly a second mode here — *"who did this?"* on check-off. It
 * has gone: the chore already sits on somebody's list, so the question
 * answered itself and cost a child an extra tap. Completion is still credited
 * to the list's owner in the logbook, which is what [ADR-0014] needs.
 *
 * Fires `chore-add` and `chore-cancel`.
 */
export class ChoreDialog extends LitElement {
  static override properties = {
    person: { attribute: false },
    existing: { attribute: false },
    busy: { type: Boolean },
    error: { type: String },
    _summary: { state: true },
    _due: { state: true },
    _repeat: { state: true },
  };

  /** Whose list is being added to. */
  person: Person | null = null;
  /** The current list, used only to notice a same-named chore. */
  existing: ChoreItem[] = [];
  busy = false;
  error: string | null = null;

  _summary = "";
  _due = "";
  _repeat: RepeatChoice = "none";

  #initialized = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (this.#initialized && !changed.has("person")) return;
    this.#initialized = true;
    this._summary = "";
    this._repeat = "none";
    // Default a new chore to today: a chore with no date never becomes
    // overdue, and overdue-ness is the whole accountability signal ([ADR-0013]).
    this._due = formatDate(new Date());
  }

  #cancel(): void {
    this.dispatchEvent(
      new CustomEvent("chore-cancel", { bubbles: true, composed: true }),
    );
  }

  #submit(): void {
    if (!this._summary.trim()) {
      this.error = "Give the chore a name.";
      return;
    }
    // A repeat is anchored to a date -- "every Tuesday" is meaningless without
    // knowing which Tuesday it starts on.
    if (this._repeat !== "none" && !this._due) {
      this.error = "Pick the day it starts.";
      return;
    }
    this.dispatchEvent(
      new CustomEvent<ChoreAddDetail>("chore-add", {
        detail: {
          summary: this._summary.trim(),
          due: this._due,
          repeat: this._repeat,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    // Only worth mentioning for a one-off. A repeat deliberately produces an
    // item of the same name every time it comes round, so saying "they already
    // have one of those" would be noise on every single rule.
    const clash =
      this._repeat === "none"
        ? findDuplicate(this.existing, this._summary)
        : null;

    return html`
      <div class="scrim" @click=${this.#cancel}></div>
      <div class="sheet" role="dialog" aria-modal="true">
        <h1>Add a chore for ${this.person?.name ?? ""}</h1>
        ${this.error
          ? html`<p class="error" role="alert">${this.error}</p>`
          : nothing}

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
              “${clash.summary}” to do. Adding another is fine — it just means
              two.
            </p>`
          : nothing}
        <label class="field">
          <span>${this._repeat === "none" ? "Due" : "Starting"}</span>
          <input
            id="chore-due"
            type="date"
            .value=${this._due}
            @input=${(e: Event) => {
              this._due = (e.target as HTMLInputElement).value;
            }}
          />
        </label>

        <div class="field">
          <span>Does it happen again?</span>
          <div class="repeats" role="radiogroup" aria-label="How often">
            ${REPEAT_CHOICES.map(
              (choice) => html`
                <button
                  class="repeat ${this._repeat === choice ? "on" : ""}"
                  id="repeat-${choice}"
                  role="radio"
                  aria-checked=${this._repeat === choice ? "true" : "false"}
                  @click=${() => {
                    this._repeat = choice;
                  }}
                >
                  ${describeChoice(choice, this._due)}
                </button>
              `,
            )}
          </div>
        </div>
        ${this._repeat === "none"
          ? nothing
          : html`<p class="note repeat-note" role="status">
              ${this.person?.name ?? "They"} gets this on their list each time
              it comes round, from ${startWord(this._due)} on. Ticking one off
              doesn't cancel the rest.
            </p>`}

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
            ${this.busy ? "Saving…" : "Add"}
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
    .repeats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .repeat {
      /* Fingers, not a mouse: these are the same size as the buttons below. */
      min-height: 48px;
      padding: 0 14px;
      background: #f4f4f4;
      border: 2px solid #dcdcdc;
      border-radius: 10px;
      font-family: inherit;
      font-size: 0.95rem;
      color: inherit;
      cursor: pointer;
    }
    .repeat.on {
      background: #0b7285;
      border-color: #0b7285;
      color: #fff;
      font-weight: 600;
    }
    .repeat-note {
      background: #e7f5f8;
      color: #0b5566;
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

/** "today", or a date, so the note reads as a sentence either way. */
function startWord(due: string): string {
  if (!due) return "the day you pick";
  if (due === formatDate(new Date())) return "today";
  return parseHaDate(due).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

customElements.define("hacal-chore-dialog", ChoreDialog);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-chore-dialog": ChoreDialog;
  }
}
