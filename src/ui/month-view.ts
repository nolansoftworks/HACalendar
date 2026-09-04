import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import type { HaClient } from "../ha/client.js";
import {
  createEvent,
  deleteEvent,
  parseHaDate,
  subscribeCalendarEvents,
  updateEvent,
  type CalendarEventInput,
  type HaCalendarEvent,
  type RecurrenceTarget,
} from "../ha/calendar.js";
import {
  buildGrid,
  formatTime,
  readableTextOn,
  startOfMonth,
  visibleRange,
  weekdayLabels,
  type OwnedEvent,
} from "./grid.js";
import { toEventInput } from "./event-form.js";
import "./event-dialog.js";
import type { DialogSaveDetail, EditScope } from "./event-dialog.js";
import {
  DEFAULT_ROSTER,
  FAMILY_COLOR,
  FAMILY_LABEL,
  FAMILY_OWNER_ID,
  ROSTER_SETUP_HINT,
  loadRoster,
  type Roster,
} from "../people.js";

/** One calendar entity to subscribe to, and how its events should look. */
interface CalendarTarget {
  entityId: string;
  ownerId: string;
  label: string;
  color: string;
}

/**
 * Month grid, overlaying the shared calendar and one calendar per person
 * ([ADR-0017]). The household sees one grid; the per-person entities are an
 * implementation detail forced by there being no ATTENDEE field.
 *
 * Writes are optimistic. HA pushes a fresh event list on every calendar change
 * -- verified, and it pushes *twice* for a single create -- so the authoritative
 * state arrives on its own moments later and simply replaces whatever we
 * guessed. On failure the previous state is restored and the dialog stays open
 * with the error, so a mistyped event is never silently lost.
 */
export class MonthView extends LitElement {
  static override properties = {
    client: { attribute: false },
    entityId: { attribute: false },
    rosterUrl: { attribute: false },
    _cursor: { state: true },
    _byCalendar: { state: true },
    _roster: { state: true },
    _hidden: { state: true },
    _error: { state: true },
    _failed: { state: true },
    _rosterLoaded: { state: true },
    _dialogMode: { state: true },
    _dialogDay: { state: true },
    _dialogEvent: { state: true },
    _dialogBusy: { state: true },
    _dialogError: { state: true },
  };

  client!: HaClient;
  /** The shared household calendar. Per-person ones come from the roster. */
  entityId = "calendar.family";
  rosterUrl?: string;

  _cursor: Date = startOfMonth(new Date());
  _byCalendar: Map<string, OwnedEvent[]> = new Map();
  _roster: Roster = DEFAULT_ROSTER;
  /** Owner ids the user has toggled off. */
  _hidden: string[] = [];
  _error: string | null = null;
  /** Entity ids that could not be subscribed -- usually a typo in people.json. */
  _failed: string[] = [];
  /** Distinguishes "no roster configured" from "roster not fetched yet". */
  _rosterLoaded = false;

  _dialogMode: "create" | "edit" | null = null;
  _dialogDay: Date | null = null;
  _dialogEvent: OwnedEvent | null = null;
  _dialogBusy = false;
  _dialogError: string | null = null;

  #unsubscribes: Map<string, () => Promise<void>> = new Map();
  // Guards against an out-of-order subscribe landing after a newer one when
  // the user taps through months faster than the websocket round-trips.
  #subscriptionToken = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#loadRoster();
    void this.#resubscribe();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    void this.#teardown();
  }

  override updated(changed: PropertyValues<this>): void {
    if (
      changed.has("_cursor") ||
      changed.has("entityId") ||
      changed.has("client") ||
      changed.has("_roster")
    ) {
      void this.#resubscribe();
    }
  }

  async #loadRoster(): Promise<void> {
    this._roster = await loadRoster(this.rosterUrl);
    this._rosterLoaded = true;
  }

  /** The shared calendar first, then one per person that declares one. */
  #targets(): CalendarTarget[] {
    const targets: CalendarTarget[] = [
      {
        entityId: this.entityId,
        ownerId: FAMILY_OWNER_ID,
        label: FAMILY_LABEL,
        color: FAMILY_COLOR,
      },
    ];

    for (const person of this._roster.people) {
      if (!person.calendar) continue;
      targets.push({
        entityId: person.calendar,
        ownerId: person.id,
        label: person.name,
        color: person.color,
      });
    }
    return targets;
  }

  #targetForOwner(ownerId: string): CalendarTarget {
    const match = this.#targets().filter((t) => t.ownerId === ownerId)[0];
    return match ?? this.#targets()[0]!;
  }

  async #teardown(): Promise<void> {
    const unsubscribes = [...this.#unsubscribes.values()];
    this.#unsubscribes = new Map();
    for (const unsubscribe of unsubscribes) {
      try {
        await unsubscribe();
      } catch {
        // The connection may already be gone; nothing useful to do.
      }
    }
  }

  async #resubscribe(): Promise<void> {
    if (!this.client) return;

    const token = ++this.#subscriptionToken;
    await this.#teardown();

    const { start, end } = visibleRange(this._cursor, this._roster.weekStartsOn);
    this._byCalendar = new Map();
    const failed: string[] = [];

    for (const target of this.#targets()) {
      try {
        const unsubscribe = await subscribeCalendarEvents(
          this.client,
          target.entityId,
          start,
          end,
          (events) => {
            if (token !== this.#subscriptionToken) return;
            // Replace the Map so Lit sees a new identity. HA can push the same
            // list twice for one write; replacing wholesale makes that a no-op.
            const next = new Map(this._byCalendar);
            next.set(target.entityId, events.map((event) => own(event, target)));
            this._byCalendar = next;
            this._error = null;
          },
        );

        // A newer subscription started while we were awaiting this one.
        if (token !== this.#subscriptionToken) {
          await unsubscribe();
          return;
        }
        this.#unsubscribes.set(target.entityId, unsubscribe);
      } catch {
        if (token !== this.#subscriptionToken) return;
        // One bad entity must not blank the wall calendar -- carry on with the
        // rest and say which one failed.
        failed.push(target.entityId);
      }
    }

    if (token !== this.#subscriptionToken) return;
    this._failed = failed;
    if (failed.length && this.#unsubscribes.size === 0) {
      this._error = `Cannot read ${failed.join(", ")}`;
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

  #toggleOwner(ownerId: string): void {
    this._hidden = this._hidden.indexOf(ownerId) === -1
      ? [...this._hidden, ownerId]
      : this._hidden.filter((id) => id !== ownerId);
  }

  /** Every subscribed calendar's events, minus the owners toggled off. */
  #visibleEvents(): OwnedEvent[] {
    const merged: OwnedEvent[] = [];
    this._byCalendar.forEach((events) => {
      for (const event of events) {
        if (this._hidden.indexOf(event.ownerId) === -1) merged.push(event);
      }
    });
    return merged;
  }

  // --- dialog -------------------------------------------------------------

  #openCreate(day: Date): void {
    this._dialogEvent = null;
    this._dialogDay = day;
    this._dialogError = null;
    this._dialogBusy = false;
    this._dialogMode = "create";
  }

  #openEdit(event: OwnedEvent): void {
    this._dialogDay = null;
    this._dialogEvent = event;
    this._dialogError = null;
    this._dialogBusy = false;
    this._dialogMode = "edit";
  }

  #closeDialog(): void {
    this._dialogMode = null;
    this._dialogEvent = null;
    this._dialogDay = null;
    this._dialogError = null;
    this._dialogBusy = false;
  }

  /**
   * Scope a change to a recurring series. Omitting `recurrence_id` entirely
   * addresses the whole series; `THISANDFUTURE` splits it from this instance on.
   */
  #recurrenceTarget(event: OwnedEvent, scope: EditScope): RecurrenceTarget {
    if (!event.recurrence_id) return {};
    return scope === "future"
      ? {
          recurrenceId: event.recurrence_id,
          recurrenceRange: "THISANDFUTURE",
        }
      : { recurrenceId: event.recurrence_id };
  }

  async #onSave(detail: DialogSaveDetail): Promise<void> {
    const snapshot = this._byCalendar;
    this._dialogBusy = true;
    this._dialogError = null;

    try {
      if (this._dialogMode === "create") {
        const target = this.#targetForOwner(detail.ownerId);
        const input = toEventInput(detail.values);
        this.#optimisticAdd(target, input);
        await createEvent(this.client, target.entityId, input);
      } else {
        const event = this._dialogEvent;
        if (!event) throw new Error("Nothing to edit.");
        if (!event.uid) {
          throw new Error("This event has no id, so it cannot be changed.");
        }
        const target = this.#targetForOwner(event.ownerId);
        const input = toEventInput(detail.values, event.rrule);
        this.#optimisticReplace(target, event, input);
        await updateEvent(
          this.client,
          target.entityId,
          event.uid,
          input,
          this.#recurrenceTarget(event, detail.scope),
        );
      }
      this.#closeDialog();
    } catch (err) {
      this._byCalendar = snapshot;
      this._dialogBusy = false;
      this._dialogError = errorMessage(err);
    }
  }

  async #onDelete(scope: EditScope): Promise<void> {
    const event = this._dialogEvent;
    if (!event) return;
    if (!event.uid) {
      this._dialogError = "This event has no id, so it cannot be deleted.";
      return;
    }

    const snapshot = this._byCalendar;
    this._dialogBusy = true;
    this._dialogError = null;

    try {
      const target = this.#targetForOwner(event.ownerId);
      this.#optimisticRemove(target, event);
      await deleteEvent(
        this.client,
        target.entityId,
        event.uid,
        this.#recurrenceTarget(event, scope),
      );
      this.#closeDialog();
    } catch (err) {
      this._byCalendar = snapshot;
      this._dialogBusy = false;
      this._dialogError = errorMessage(err);
    }
  }

  // Optimistic edits are approximate for a recurring series -- a THISANDFUTURE
  // change touches instances we don't rewrite here. HA's push corrects it.
  #optimisticAdd(target: CalendarTarget, input: CalendarEventInput): void {
    const optimistic: OwnedEvent = {
      summary: input.summary,
      start: input.start,
      end: input.end,
      all_day: input.start.indexOf("T") === -1,
      ownerId: target.ownerId,
      color: target.color,
      uid: `pending-${Date.now()}`,
    };
    const next = new Map(this._byCalendar);
    next.set(target.entityId, [
      ...(next.get(target.entityId) ?? []),
      optimistic,
    ]);
    this._byCalendar = next;
  }

  #optimisticReplace(
    target: CalendarTarget,
    event: OwnedEvent,
    input: CalendarEventInput,
  ): void {
    const next = new Map(this._byCalendar);
    next.set(
      target.entityId,
      (next.get(target.entityId) ?? []).map((candidate) =>
        isSameInstance(candidate, event)
          ? {
              ...candidate,
              summary: input.summary,
              start: input.start,
              end: input.end,
              all_day: input.start.indexOf("T") === -1,
            }
          : candidate,
      ),
    );
    this._byCalendar = next;
  }

  #optimisticRemove(target: CalendarTarget, event: OwnedEvent): void {
    const next = new Map(this._byCalendar);
    next.set(
      target.entityId,
      (next.get(target.entityId) ?? []).filter(
        (candidate) => !isSameInstance(candidate, event),
      ),
    );
    this._byCalendar = next;
  }

  override render() {
    const cells = buildGrid(
      this._cursor,
      this.#visibleEvents(),
      this._roster.weekStartsOn,
    );
    const monthLabel = this._cursor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    const targets = this.#targets();

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
      ${this._failed.length && !this._error
        ? html`<p class="warn" role="status">
            Not showing ${this._failed.join(", ")} — check people.json.
          </p>`
        : nothing}
      ${this._rosterLoaded && this._roster.people.length === 0
        ? html`<p class="hint">${ROSTER_SETUP_HINT}</p>`
        : nothing}
      ${targets.length > 1
        ? html`
            <div class="filters">
              ${targets.map((target) => {
                const off = this._hidden.indexOf(target.ownerId) !== -1;
                return html`
                  <button
                    class="filter ${off ? "off" : ""}"
                    aria-pressed=${off ? "false" : "true"}
                    style=${off
                      ? `border-color:${target.color};color:${target.color}`
                      : `background:${target.color};border-color:${target.color};color:${readableTextOn(
                          target.color,
                        )}`}
                    @click=${() => this.#toggleOwner(target.ownerId)}
                  >
                    ${target.label}
                  </button>
                `;
              })}
            </div>
          `
        : nothing}

      <div class="weekdays">
        ${weekdayLabels(this._roster.weekStartsOn).map(
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
              @click=${() => this.#openCreate(cell.date)}
            >
              <span class="daynum">${cell.date.getDate()}</span>
              ${cell.events.map(
                (event) => html`
                  <span
                    class="chip"
                    role="button"
                    tabindex="0"
                    title=${event.summary}
                    style="background:${event.color};color:${readableTextOn(
                      event.color,
                    )}"
                    @click=${(e: Event) => {
                      // Otherwise the cell's create handler fires as well.
                      e.stopPropagation();
                      this.#openEdit(event);
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

      ${this._dialogMode
        ? html`
            <hacal-event-dialog
              .mode=${this._dialogMode}
              .people=${this._roster.people}
              .event=${this._dialogEvent}
              .day=${this._dialogDay}
              .busy=${this._dialogBusy}
              .error=${this._dialogError}
              @dialog-close=${this.#closeDialog}
              @dialog-save=${(e: CustomEvent<DialogSaveDetail>) =>
                void this.#onSave(e.detail)}
              @dialog-delete=${(e: CustomEvent<{ scope: EditScope }>) =>
                void this.#onDelete(e.detail.scope)}
            ></hacal-event-dialog>
          `
        : nothing}
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
    .hint {
      margin: 0 16px 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: #eef6f8;
      color: #22606d;
      font-size: 0.8rem;
    }
    .warn {
      margin: 0 16px 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: #fff4e6;
      color: #8a5300;
      font-size: 0.85rem;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 16px 10px;
    }
    button.filter {
      min-width: 0;
      min-height: 44px;
      padding: 0 16px;
      font-size: 0.95rem;
      font-weight: 600;
      border: 2px solid transparent;
      border-radius: 22px;
    }
    button.filter.off {
      background: transparent;
      opacity: 0.75;
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
      cursor: pointer;
    }
    .cell.outside {
      opacity: 0.35;
    }
    .cell.today {
      outline: 2px solid var(--hacal-accent, #0b7285);
    }
    .cell:active {
      background: var(--hacal-cell-active, #eef6f8);
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
      cursor: pointer;
    }
  `;
}

/**
 * Whether two payload entries are the same occurrence. A recurring series
 * shares one `uid` across every instance, so `recurrence_id` is what separates
 * them -- matching on `uid` alone would rewrite the whole series.
 */
function isSameInstance(a: OwnedEvent, b: OwnedEvent): boolean {
  if (a.uid !== b.uid) return false;
  return (a.recurrence_id ?? "") === (b.recurrence_id ?? "");
}

/**
 * Turn a failure into something a non-technical adult can act on.
 *
 * Our own validation throws real `Error`s whose text is already written for
 * the household, so those pass through untouched. HA is different: the
 * websocket client rejects with a plain `{code, message}` object, and its text
 * is developer-facing ("No existing item with uid/recurrence_id: ..."). That
 * gets translated, and the raw form is logged so a failure is still
 * diagnosable from the console.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;

  const raw = haErrorText(err);
  if (raw) console.error("[hacalendar] write rejected by HA:", raw);

  if (raw && /no existing item/i.test(raw)) {
    return "That event isn't there any more. It may have been changed on another screen.";
  }
  if (raw && /(invalid_format|extra keys|required key)/i.test(raw)) {
    return "Home Assistant wouldn't accept those details.";
  }
  if (raw && /not_found|unknown_error/i.test(raw)) {
    return "That calendar isn't available right now.";
  }
  return "That didn't save. Please try again.";
}

function haErrorText(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as { message?: unknown; code?: unknown };
  const parts: string[] = [];
  if (typeof candidate.code === "string") parts.push(candidate.code);
  if (typeof candidate.message === "string") parts.push(candidate.message);
  return parts.length ? parts.join(": ") : null;
}

function own(event: HaCalendarEvent, target: CalendarTarget): OwnedEvent {
  return { ...event, ownerId: target.ownerId, color: target.color };
}

customElements.define("hacal-month-view", MonthView);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-month-view": MonthView;
  }
}
