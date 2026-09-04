import { LitElement, html, css, nothing } from "lit";
import type { HaClient } from "../ha/client.js";
import {
  createPerson,
  deletePerson,
  fetchRoster,
  fetchUnassignedCalendars,
  updatePerson,
} from "../ha/roster.js";
import {
  PERSON_COLORS,
  suggestColor,
  type Person,
  type Roster,
} from "../people.js";
import { readableTextOn } from "./grid.js";

/**
 * Managing who lives here, from the app.
 *
 * Adding someone creates their Home Assistant label *and* their calendar and
 * links the two ([ADR-0026]), so nobody has to visit HA's settings or edit a
 * file on the server. That is the whole point: a household should be able to
 * add a child without a text editor.
 *
 * Removing someone detaches them and, by default, **keeps their calendar**.
 * Deleting a `local_calendar` destroys its events, so that is opt-in and
 * separately confirmed.
 *
 * Fires `roster-changed` whenever HA was written to, and `settings-close`.
 */
export class PeopleSettings extends LitElement {
  static override properties = {
    client: { attribute: false },
    _roster: { state: true },
    _adoptable: { state: true },
    _editingId: { state: true },
    _name: { state: true },
    _color: { state: true },
    _adoptCalendar: { state: true },
    _confirmingDeleteId: { state: true },
    _alsoDeleteCalendar: { state: true },
    _busy: { state: true },
    _error: { state: true },
    _loaded: { state: true },
  };

  client!: HaClient;

  _roster: Roster = { weekStartsOn: 0, people: [] };
  _adoptable: Array<{ entityId: string; name: string }> = [];
  /** `null` = not editing, `""` = adding someone new, otherwise a person id. */
  _editingId: string | null = null;
  _name = "";
  _color = PERSON_COLORS[0]!;
  /** When adding: adopt this existing calendar instead of creating one. */
  _adoptCalendar = "";
  _confirmingDeleteId: string | null = null;
  _alsoDeleteCalendar = false;
  _busy = false;
  _error: string | null = null;
  _loaded = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#reload();
  }

  async #reload(): Promise<void> {
    try {
      const [roster, adoptable] = await Promise.all([
        fetchRoster(this.client, this._roster.weekStartsOn),
        fetchUnassignedCalendars(this.client),
      ]);
      this._roster = roster;
      this._adoptable = adoptable;
      this._error = null;
    } catch (err) {
      this._error = message(err);
    } finally {
      this._loaded = true;
    }
  }

  #changed(): void {
    this.dispatchEvent(
      new CustomEvent("roster-changed", { bubbles: true, composed: true }),
    );
  }

  #startAdd(): void {
    this._editingId = "";
    this._name = "";
    this._color = suggestColor(this._roster.people.map((p) => p.color));
    this._adoptCalendar = "";
    this._error = null;
  }

  #startEdit(person: Person): void {
    this._editingId = person.id;
    this._name = person.name;
    this._color = person.color;
    this._adoptCalendar = "";
    this._error = null;
  }

  #cancelEdit(): void {
    this._editingId = null;
    this._error = null;
  }

  async #save(): Promise<void> {
    if (!this._name.trim()) {
      this._error = "Give this person a name.";
      return;
    }
    this._busy = true;
    this._error = null;
    try {
      if (this._editingId) {
        await updatePerson(this.client, this._editingId, this._name, this._color);
      } else if (this._adoptCalendar) {
        await this.#adopt(this._name, this._color, this._adoptCalendar);
      } else {
        await createPerson(this.client, this._name, this._color);
      }
      this._editingId = null;
      await this.#reload();
      this.#changed();
    } catch (err) {
      this._error = message(err);
    } finally {
      this._busy = false;
    }
  }

  /** Attach a new person to a calendar that already exists. */
  async #adopt(name: string, color: string, entityId: string): Promise<void> {
    const label = await this.client.callWS<{ label_id: string }>({
      type: "config/label_registry/create",
      name: name.trim(),
      color,
    });
    try {
      await this.client.callWS({
        type: "config/entity_registry/update",
        entity_id: entityId,
        labels: [label.label_id],
      });
    } catch (err) {
      await this.client
        .callWS({ type: "config/label_registry/delete", label_id: label.label_id })
        .catch(() => undefined);
      throw err;
    }
  }

  async #remove(person: Person): Promise<void> {
    if (this._confirmingDeleteId !== person.id) {
      this._confirmingDeleteId = person.id;
      this._alsoDeleteCalendar = false;
      return;
    }
    this._busy = true;
    this._error = null;
    try {
      await deletePerson(this.client, person, this._alsoDeleteCalendar);
      this._confirmingDeleteId = null;
      await this.#reload();
      this.#changed();
    } catch (err) {
      this._error = message(err);
    } finally {
      this._busy = false;
    }
  }

  override render() {
    return html`
      <div class="scrim" @click=${() => this.dispatchEvent(
        new CustomEvent("settings-close", { bubbles: true, composed: true }),
      )}></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Who lives here">
        <h1>Who lives here</h1>
        <p class="lede">
          Everyone here gets their own color and their own calendar.
        </p>

        ${this._error
          ? html`<p class="error" role="alert">${this._error}</p>`
          : nothing}

        ${!this._loaded
          ? html`<p class="muted">Loading…</p>`
          : this._roster.people.length === 0 && this._editingId === null
            ? html`<p class="muted">Nobody yet. Add the first person below.</p>`
            : nothing}

        <ul class="people">
          ${this._roster.people.map((person) =>
            this._editingId === person.id
              ? html`<li class="editing">${this.#form("Save")}</li>`
              : html`
                  <li>
                    <span
                      class="swatch"
                      style="background:${person.color};color:${readableTextOn(
                        person.color,
                      )}"
                      >${person.name.slice(0, 1).toUpperCase()}</span
                    >
                    <span class="who">
                      <b>${person.name}</b>
                      <small>${person.calendar ?? "no calendar"}</small>
                    </span>
                    <button
                      class="ghost"
                      ?disabled=${this._busy}
                      @click=${() => this.#startEdit(person)}
                    >
                      Edit
                    </button>
                    <button
                      class="danger ${this._confirmingDeleteId === person.id
                        ? "confirm"
                        : ""}"
                      ?disabled=${this._busy}
                      @click=${() => void this.#remove(person)}
                    >
                      ${this._confirmingDeleteId === person.id
                        ? "Tap again"
                        : "Remove"}
                    </button>
                  </li>
                  ${this._confirmingDeleteId === person.id
                    ? html`
                        <li class="confirm-row">
                          <label class="toggle">
                            <input
                              type="checkbox"
                              .checked=${this._alsoDeleteCalendar}
                              @change=${(e: Event) => {
                                this._alsoDeleteCalendar = (
                                  e.target as HTMLInputElement
                                ).checked;
                              }}
                            />
                            <span>
                              Also delete their calendar and everything on it
                            </span>
                          </label>
                          <button
                            class="ghost"
                            @click=${() => {
                              this._confirmingDeleteId = null;
                            }}
                          >
                            Cancel
                          </button>
                        </li>
                      `
                    : nothing}
                `,
          )}
        </ul>

        ${this._editingId === ""
          ? html`<div class="editing">${this.#form("Add")}</div>`
          : html`
              <button
                class="primary add"
                ?disabled=${this._busy}
                @click=${this.#startAdd}
              >
                + Add a person
              </button>
            `}

        <div class="actions">
          <span class="spacer"></span>
          <button
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent("settings-close", {
                  bubbles: true,
                  composed: true,
                }),
              )}
          >
            Done
          </button>
        </div>
      </div>
    `;
  }

  #form(verb: string) {
    const adding = this._editingId === "";
    return html`
      <label class="field">
        <span>Name</span>
        <input
          id="person-name"
          type="text"
          .value=${this._name}
          placeholder="e.g. Alex"
          @input=${(e: Event) => {
            this._name = (e.target as HTMLInputElement).value;
          }}
        />
      </label>

      <span class="field-label">Color</span>
      <div class="colors" role="radiogroup" aria-label="Color">
        ${PERSON_COLORS.map(
          (color) => html`
            <button
              type="button"
              role="radio"
              aria-checked=${this._color === color ? "true" : "false"}
              aria-label=${color}
              class="color ${this._color === color ? "on" : ""}"
              style="background:${color}"
              @click=${() => {
                this._color = color;
              }}
            >
              ${this._color === color
                ? html`<span style="color:${readableTextOn(color)}">✓</span>`
                : nothing}
            </button>
          `,
        )}
      </div>

      ${adding && this._adoptable.length
        ? html`
            <label class="field">
              <span>Calendar</span>
              <select
                id="adopt"
                .value=${this._adoptCalendar}
                @change=${(e: Event) => {
                  this._adoptCalendar = (e.target as HTMLSelectElement).value;
                }}
              >
                <option value="">Create a new calendar for them</option>
                ${this._adoptable.map(
                  (calendar) => html`
                    <option value=${calendar.entityId}>
                      Use existing: ${calendar.name}
                    </option>
                  `,
                )}
              </select>
            </label>
          `
        : nothing}

      <div class="actions">
        <span class="spacer"></span>
        <button class="ghost" ?disabled=${this._busy} @click=${this.#cancelEdit}>
          Cancel
        </button>
        <button
          class="primary"
          id="person-save"
          ?disabled=${this._busy}
          @click=${() => void this.#save()}
        >
          ${this._busy ? "Working…" : verb}
        </button>
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
      max-width: 34rem;
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
      margin: 0 0 4px;
      font-size: 1.3rem;
    }
    .lede {
      margin: 0 0 16px;
      font-size: 0.9rem;
      opacity: 0.7;
    }
    .muted {
      margin: 0 0 14px;
      opacity: 0.6;
    }
    .error {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #fdecea;
      color: #8c1d18;
    }
    ul.people {
      margin: 0 0 14px;
      padding: 0;
      list-style: none;
    }
    ul.people li {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #eee;
    }
    li.confirm-row {
      flex-wrap: wrap;
      background: #fff7f6;
      padding: 10px;
      border-radius: 10px;
    }
    .swatch {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      flex: 0 0 40px;
      border-radius: 50%;
      font-weight: 700;
    }
    .who {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .who small {
      font-size: 0.75rem;
      opacity: 0.55;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .editing {
      padding: 12px;
      margin-bottom: 14px;
      background: #f7f7f7;
      border-radius: 12px;
    }
    .field {
      display: block;
      margin-bottom: 12px;
    }
    .field span,
    .field-label {
      display: block;
      margin-bottom: 4px;
      font-size: 0.85rem;
      opacity: 0.7;
    }
    .field input,
    .field select {
      width: 100%;
      min-height: 48px;
      padding: 0 12px;
      font-size: 1.05rem;
      font-family: inherit;
      color: inherit;
      background: #fff;
      border: 2px solid #dcdcdc;
      border-radius: 10px;
      box-sizing: border-box;
    }
    .colors {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    button.color {
      width: 48px;
      height: 48px;
      padding: 0;
      border: 3px solid transparent;
      border-radius: 50%;
      font-size: 1.2rem;
      cursor: pointer;
    }
    button.color.on {
      border-color: #1c1c1c;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 14rem;
      font-size: 0.9rem;
      cursor: pointer;
    }
    .toggle input {
      width: 24px;
      height: 24px;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
    }
    .spacer {
      flex: 1;
    }
    button {
      min-height: 48px;
      padding: 0 18px;
      font-size: 0.95rem;
      font-family: inherit;
      background: #e6e6e6;
      color: inherit;
      border: none;
      border-radius: 12px;
      cursor: pointer;
    }
    button.primary {
      background: #0b7285;
      color: #fff;
      font-weight: 600;
    }
    button.add {
      width: 100%;
    }
    button.ghost {
      background: transparent;
      border: 2px solid #dcdcdc;
    }
    button.danger {
      background: #fdecea;
      color: #8c1d18;
    }
    button.danger.confirm {
      background: #8c1d18;
      color: #fff;
      font-weight: 600;
    }
    button[disabled] {
      opacity: 0.5;
    }
  `;
}

function message(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
  }
  return "Home Assistant wouldn't accept that.";
}

customElements.define("hacal-people-settings", PeopleSettings);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-people-settings": PeopleSettings;
  }
}
