import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import type { Person } from "../people.js";
import { FAMILY_OWNER_ID } from "../people.js";
import type { OwnedEvent } from "./grid.js";
import {
  defaultFormValues,
  toFormValues,
  validateForm,
  type EventFormValues,
} from "./event-form.js";
import "./person-picker.js";

export type EditScope = "single" | "future";

export interface DialogSaveDetail {
  ownerId: string;
  values: EventFormValues;
  scope: EditScope;
}

/**
 * Touch-first create / edit / delete dialog.
 *
 * Deliberately absent: a "change owner" control. Moving an event between
 * calendars is a delete plus a create, which mints a new UID and quietly
 * undermines [ADR-0009] and the Phase 6 iCloud round trip. `docs/PLAN.md` says
 * not to build it until it has its own decision, so on edit the owner is shown
 * but not editable.
 *
 * Also absent: a recurrence builder. Creating an `RRULE` is not in Phase 2's
 * scope; an existing series keeps its rule untouched through an edit.
 *
 * Fires `dialog-save`, `dialog-delete` and `dialog-close`.
 */
export class EventDialog extends LitElement {
  static override properties = {
    mode: { type: String },
    people: { attribute: false },
    event: { attribute: false },
    day: { attribute: false },
    busy: { type: Boolean },
    error: { type: String },
    _values: { state: true },
    _ownerId: { state: true },
    _scope: { state: true },
    _confirmingDelete: { state: true },
  };

  mode: "create" | "edit" = "create";
  people: Person[] = [];
  event: OwnedEvent | null = null;
  day: Date | null = null;
  /** Set by the parent while a websocket call is in flight. */
  busy = false;
  /** Set by the parent when a call fails, so the dialog can stay open. */
  error: string | null = null;

  _values: EventFormValues = defaultFormValues(new Date());
  _ownerId: string = FAMILY_OWNER_ID;
  _scope: EditScope = "single";
  _confirmingDelete = false;

  #initialized = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (this.#initialized && !changed.has("event") && !changed.has("day")) {
      return;
    }
    if (!this.#initialized || changed.has("event") || changed.has("day")) {
      this.#initialized = true;
      this._values = this.event
        ? toFormValues(this.event)
        : defaultFormValues(this.day ?? new Date());
      this._ownerId = this.event ? this.event.ownerId : this._ownerId;
      this._scope = "single";
      this._confirmingDelete = false;
    }
  }

  get #isRecurring(): boolean {
    return Boolean(this.event && (this.event.rrule || this.event.recurrence_id));
  }

  #set<K extends keyof EventFormValues>(
    key: K,
    value: EventFormValues[K],
  ): void {
    this._values = { ...this._values, [key]: value };
  }

  #close(): void {
    this.dispatchEvent(
      new CustomEvent("dialog-close", { bubbles: true, composed: true }),
    );
  }

  #save(): void {
    const problem = validateForm(this._values);
    if (problem) {
      this.error = problem;
      return;
    }
    this.dispatchEvent(
      new CustomEvent<DialogSaveDetail>("dialog-save", {
        detail: {
          ownerId: this._ownerId,
          values: this._values,
          scope: this._scope,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #delete(): void {
    if (!this._confirmingDelete) {
      this._confirmingDelete = true;
      return;
    }
    this.dispatchEvent(
      new CustomEvent("dialog-delete", {
        detail: { scope: this._scope },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const creating = this.mode === "create";
    const owner = this.people.filter((p) => p.id === this._ownerId)[0];

    return html`
      <div class="scrim" @click=${this.#close}></div>
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-label=${creating ? "New event" : "Edit event"}
      >
        <h1>${creating ? "New event" : "Edit event"}</h1>

        ${this.error
          ? html`<p class="error" role="alert">${this.error}</p>`
          : nothing}

        <label class="field">
          <span>What is it?</span>
          <input
            id="summary"
            type="text"
            .value=${this._values.summary}
            placeholder="Dentist, soccer practice…"
            @input=${(e: Event) =>
              this.#set("summary", (e.target as HTMLInputElement).value)}
          />
        </label>

        ${creating
          ? html`
              <hacal-person-picker
                .people=${this.people}
                .selected=${this._ownerId}
                heading="Who is this for?"
                @pick=${(e: CustomEvent<{ ownerId: string }>) => {
                  this._ownerId = e.detail.ownerId;
                }}
              ></hacal-person-picker>
            `
          : html`
              <p class="owner">
                On
                <b>${owner ? owner.name : "the family calendar"}</b>
              </p>
            `}

        <label class="toggle">
          <input
            id="allday"
            type="checkbox"
            .checked=${this._values.allDay}
            @change=${(e: Event) =>
              this.#set("allDay", (e.target as HTMLInputElement).checked)}
          />
          <span>All day</span>
        </label>

        <div class="row">
          <label class="field">
            <span>Starts</span>
            <input
              id="startdate"
              type="date"
              .value=${this._values.startDate}
              @input=${(e: Event) =>
                this.#set("startDate", (e.target as HTMLInputElement).value)}
            />
          </label>
          ${this._values.allDay
            ? nothing
            : html`
                <label class="field time">
                  <span>at</span>
                  <input
                    id="starttime"
                    type="time"
                    .value=${this._values.startTime}
                    @input=${(e: Event) =>
                      this.#set(
                        "startTime",
                        (e.target as HTMLInputElement).value,
                      )}
                  />
                </label>
              `}
        </div>

        <div class="row">
          <label class="field">
            <span>Ends</span>
            <input
              id="enddate"
              type="date"
              .value=${this._values.endDate}
              @input=${(e: Event) =>
                this.#set("endDate", (e.target as HTMLInputElement).value)}
            />
          </label>
          ${this._values.allDay
            ? nothing
            : html`
                <label class="field time">
                  <span>at</span>
                  <input
                    id="endtime"
                    type="time"
                    .value=${this._values.endTime}
                    @input=${(e: Event) =>
                      this.#set("endTime", (e.target as HTMLInputElement).value)}
                  />
                </label>
              `}
        </div>

        <label class="field">
          <span>Where? (optional)</span>
          <input
            id="location"
            type="text"
            .value=${this._values.location}
            @input=${(e: Event) =>
              this.#set("location", (e.target as HTMLInputElement).value)}
          />
        </label>

        ${this.#isRecurring
          ? html`
              <div class="scope">
                <p>This event repeats. Apply changes to:</p>
                <div class="scope-options">
                  <button
                    type="button"
                    id="scope-single"
                    class="scope-option ${this._scope === "single" ? "on" : ""}"
                    aria-pressed=${this._scope === "single" ? "true" : "false"}
                    @click=${() => {
                      this._scope = "single";
                    }}
                  >
                    Only this one
                  </button>
                  <button
                    type="button"
                    id="scope-future"
                    class="scope-option ${this._scope === "future" ? "on" : ""}"
                    aria-pressed=${this._scope === "future" ? "true" : "false"}
                    @click=${() => {
                      this._scope = "future";
                    }}
                  >
                    This and all later
                  </button>
                </div>
              </div>
            `
          : nothing}

        <div class="actions">
          ${creating
            ? nothing
            : html`
                <button
                  type="button"
                  id="delete"
                  class="danger ${this._confirmingDelete ? "confirm" : ""}"
                  ?disabled=${this.busy}
                  @click=${this.#delete}
                >
                  ${this._confirmingDelete ? "Tap again to delete" : "Delete"}
                </button>
              `}
          <span class="spacer"></span>
          <button type="button" id="cancel" @click=${this.#close} ?disabled=${this.busy}>
            Cancel
          </button>
          <button
            type="button"
            id="save"
            class="primary"
            ?disabled=${this.busy}
            @click=${this.#save}
          >
            ${this.busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    `;
  }

  // Anchored to the top rather than centred: on a tablet the on-screen keyboard
  // shrinks the viewport, and a centred sheet gets pushed under it.
  static override styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
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
      max-width: 32rem;
      max-height: 92vh;
      margin: 3vh auto;
      padding: 20px;
      overflow-y: auto;
      background: #fff;
      color: #1c1c1c;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
    }
    h1 {
      margin: 0 0 14px;
      font-size: 1.3rem;
    }
    .error {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #fdecea;
      color: #8c1d18;
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
    .row {
      display: flex;
      gap: 10px;
    }
    .row .field {
      flex: 2;
    }
    .row .field.time {
      flex: 1;
    }
    .owner {
      margin: 0 0 14px;
      font-size: 0.95rem;
      opacity: 0.8;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 48px;
      margin-bottom: 8px;
      font-size: 1rem;
      cursor: pointer;
    }
    .toggle input {
      width: 26px;
      height: 26px;
    }
    hacal-person-picker {
      margin-bottom: 14px;
    }
    .scope {
      margin: 4px 0 14px;
    }
    .scope p {
      margin: 0 0 8px;
      font-size: 0.9rem;
      opacity: 0.8;
    }
    .scope-options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .scope-option {
      min-height: 48px;
      padding: 0 16px;
      font-size: 0.95rem;
      font-family: inherit;
      background: #f0f0f0;
      color: inherit;
      border: 2px solid #dcdcdc;
      border-radius: 24px;
      cursor: pointer;
    }
    .scope-option.on {
      background: #0b7285;
      border-color: #0b7285;
      color: #fff;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 18px;
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
    .actions button.danger {
      background: #fdecea;
      color: #8c1d18;
    }
    .actions button.danger.confirm {
      background: #8c1d18;
      color: #fff;
      font-weight: 600;
    }
    .actions button[disabled] {
      opacity: 0.5;
    }
  `;
}

customElements.define("hacal-event-dialog", EventDialog);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-event-dialog": EventDialog;
  }
}
