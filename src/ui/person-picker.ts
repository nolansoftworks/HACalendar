import { LitElement, html, css, nothing } from "lit";
import type { Person } from "../people.js";
import { FAMILY_COLOR, FAMILY_LABEL, FAMILY_OWNER_ID } from "../people.js";
import { readableTextOn } from "./grid.js";

/**
 * The "who?" picker ([ADR-0018]).
 *
 * One component, three call sites: *who is this for?* when creating an event,
 * *who's adding this?* when a kid adds a task, and *who did this?* when a chore
 * is checked off. Only the heading changes.
 *
 * **This is intent, never identity.** The wall tablet is a shared kiosk with no
 * login. Anyone can pick anyone, siblings included. Do not mistake this for
 * auth -- [ADR-0007] governs actual access.
 *
 * Fires `pick` with `detail: { ownerId }`.
 */
export class PersonPicker extends LitElement {
  static override properties = {
    people: { attribute: false },
    includeFamily: { type: Boolean },
    heading: { type: String },
    selected: { type: String },
  };

  people: Person[] = [];
  /** Whether the shared household calendar is an option. */
  includeFamily = true;
  heading = "Who is this for?";
  selected: string | null = null;

  #pick(ownerId: string): void {
    this.selected = ownerId;
    this.dispatchEvent(
      new CustomEvent("pick", {
        detail: { ownerId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const options: Array<{ id: string; name: string; color: string }> = [];
    if (this.includeFamily) {
      options.push({
        id: FAMILY_OWNER_ID,
        name: FAMILY_LABEL,
        color: FAMILY_COLOR,
      });
    }
    for (const person of this.people) {
      options.push({ id: person.id, name: person.name, color: person.color });
    }

    return html`
      ${this.heading ? html`<h2>${this.heading}</h2>` : nothing}
      <div class="options" role="radiogroup" aria-label=${this.heading}>
        ${options.map((option) => {
          const chosen = this.selected === option.id;
          return html`
            <button
              type="button"
              role="radio"
              aria-checked=${chosen ? "true" : "false"}
              class="option ${chosen ? "chosen" : ""}"
              style=${chosen
                ? `background:${option.color};border-color:${option.color};color:${readableTextOn(
                    option.color,
                  )}`
                : `border-color:${option.color};color:inherit`}
              @click=${() => this.#pick(option.id)}
            >
              <span class="dot" style="background:${option.color}"></span>
              ${option.name}
            </button>
          `;
        })}
      </div>
    `;
  }

  // No :has(), :is() or nesting -- Chrome 87 floor ([ADR-0003]).
  static override styles = css`
    :host {
      display: block;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 1rem;
      font-weight: 600;
    }
    .options {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      /* Kids use this. 44px is the floor, not the target. */
      min-height: 52px;
      padding: 0 18px;
      font-size: 1rem;
      font-weight: 600;
      background: transparent;
      border: 2px solid #ccc;
      border-radius: 26px;
      cursor: pointer;
    }
    .dot {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 50%;
    }
    .option.chosen .dot {
      display: none;
    }
  `;
}

customElements.define("hacal-person-picker", PersonPicker);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-person-picker": PersonPicker;
  }
}
