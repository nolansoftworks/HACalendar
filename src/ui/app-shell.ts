import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import type { HaClient } from "../ha/client.js";
import {
  createEvent,
  deleteEvent,
  subscribeCalendarEvents,
  updateEvent,
  type CalendarEventInput,
  type HaCalendarEvent,
  type RecurrenceTarget,
} from "../ha/calendar.js";
import { fetchRoster } from "../ha/roster.js";
import {
  addDays,
  readableTextOn,
  startOfMonth,
  visibleRange,
  type OwnedEvent,
} from "./grid.js";
import { dayColumns } from "./week-layout.js";
import { toEventInput } from "./event-form.js";
import "./week-view.js";
import "./month-view.js";
import "./event-dialog.js";
import "./people-settings.js";
import type { DialogSaveDetail, EditScope } from "./event-dialog.js";
import {
  DEFAULT_ROSTER,
  FAMILY_COLOR,
  FAMILY_LABEL,
  FAMILY_OWNER_ID,
  ROSTER_SETUP_HINT,
  type Roster,
} from "../people.js";

export type CalendarView = "week" | "month";

interface CalendarTarget {
  entityId: string;
  ownerId: string;
  label: string;
  color: string;
}

/**
 * The appliance shell ([ADR-0027]).
 *
 * This household wants a family calendar that happens to run on Home
 * Assistant, not an HA tablet that happens to show a calendar. So the calendar
 * is the frame: a left rail for the other surfaces, a header with the family
 * name and the time, and the current view filling everything else. HA itself
 * is a *destination* reachable from the rail, not the thing wrapped around us.
 *
 * The shell owns what both views need -- roster, subscriptions, filters, the
 * edit dialog -- so the views stay presentational and cannot double-subscribe.
 * Writes are optimistic; HA pushes a fresh list on every change (twice for a
 * create), so the authoritative state lands on its own and a failure rolls back.
 */
export class AppShell extends LitElement {
  static override properties = {
    client: { attribute: false },
    entityId: { attribute: false },
    haUrl: { attribute: false },
    daysShown: { type: Number },
    _view: { state: true },
    _cursor: { state: true },
    _byCalendar: { state: true },
    _roster: { state: true },
    _hidden: { state: true },
    _error: { state: true },
    _failed: { state: true },
    _rosterLoaded: { state: true },
    _settingsOpen: { state: true },
    _now: { state: true },
    _title: { state: true },
    _dialogMode: { state: true },
    _dialogDay: { state: true },
    _dialogHour: { state: true },
    _dialogEvent: { state: true },
    _dialogBusy: { state: true },
    _dialogError: { state: true },
  };

  client!: HaClient;
  /** The shared household calendar. Per-person ones come from the roster. */
  entityId = "calendar.family";
  /** Base URL for the "Home Assistant" rail button. Empty = same origin. */
  haUrl = "";
  daysShown = 5;

  _view: CalendarView = "week";
  /** In week view this is the first visible day; in month view, any day in it. */
  _cursor: Date = today();
  _byCalendar: Map<string, OwnedEvent[]> = new Map();
  _roster: Roster = DEFAULT_ROSTER;
  _hidden: string[] = [];
  _error: string | null = null;
  _failed: string[] = [];
  _rosterLoaded = false;
  _settingsOpen = false;
  _now: Date = new Date();
  _title = "Family";

  _dialogMode: "create" | "edit" | null = null;
  _dialogDay: Date | null = null;
  _dialogHour: number | null = null;
  _dialogEvent: OwnedEvent | null = null;
  _dialogBusy = false;
  _dialogError: string | null = null;

  #unsubscribes: Map<string, () => Promise<void>> = new Map();
  #subscriptionToken = 0;
  #clock?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    // The header clock and the "now" line only need minute resolution.
    this.#clock = setInterval(() => {
      this._now = new Date();
    }, 30_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#clock) clearInterval(this.#clock);
    void this.#teardown();
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("client")) {
      void this.#loadRoster();
      void this.#loadTitle();
    }
    if (
      changed.has("client") ||
      changed.has("entityId") ||
      changed.has("_cursor") ||
      changed.has("_view") ||
      changed.has("daysShown") ||
      changed.has("_roster")
    ) {
      void this.#resubscribe();
    }
  }

  async #loadRoster(): Promise<void> {
    if (!this.client) return;
    try {
      this._roster = await fetchRoster(this.client, this._roster.weekStartsOn);
    } catch {
      this._roster = DEFAULT_ROSTER;
    }
    this._rosterLoaded = true;
  }

  /** The household's name, from HA's own instance name. */
  async #loadTitle(): Promise<void> {
    if (!this.client) return;
    try {
      const config = await this.client.callWS<{ location_name?: string }>({
        type: "get_config",
      });
      if (config.location_name) this._title = config.location_name;
    } catch {
      // Keep the default rather than showing an error for a heading.
    }
  }

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

  /** The span to subscribe over, which differs per view. */
  #range(): { start: Date; end: Date } {
    if (this._view === "month") {
      return visibleRange(startOfMonth(this._cursor), this._roster.weekStartsOn);
    }
    return { start: this._cursor, end: addDays(this._cursor, this.daysShown) };
  }

  async #teardown(): Promise<void> {
    const unsubscribes = [...this.#unsubscribes.values()];
    this.#unsubscribes = new Map();
    for (const unsubscribe of unsubscribes) {
      try {
        await unsubscribe();
      } catch {
        // Connection may already be gone.
      }
    }
  }

  async #resubscribe(): Promise<void> {
    if (!this.client) return;
    const token = ++this.#subscriptionToken;
    await this.#teardown();

    const { start, end } = this.#range();
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
            const next = new Map(this._byCalendar);
            next.set(target.entityId, events.map((e) => own(e, target)));
            this._byCalendar = next;
            this._error = null;
          },
        );
        if (token !== this.#subscriptionToken) {
          await unsubscribe();
          return;
        }
        this.#unsubscribes.set(target.entityId, unsubscribe);
      } catch {
        if (token !== this.#subscriptionToken) return;
        failed.push(target.entityId);
      }
    }

    if (token !== this.#subscriptionToken) return;
    this._failed = failed;
    if (failed.length && this.#unsubscribes.size === 0) {
      this._error = `Cannot read ${failed.join(", ")}`;
    }
  }

  #visibleEvents(): OwnedEvent[] {
    const merged: OwnedEvent[] = [];
    this._byCalendar.forEach((events) => {
      for (const event of events) {
        if (this._hidden.indexOf(event.ownerId) === -1) merged.push(event);
      }
    });
    return merged;
  }

  #shift(direction: number): void {
    this._cursor =
      this._view === "month"
        ? new Date(
            this._cursor.getFullYear(),
            this._cursor.getMonth() + direction,
            1,
          )
        : addDays(this._cursor, direction * this.daysShown);
  }

  #goToday(): void {
    this._cursor = this._view === "month" ? startOfMonth(today()) : today();
  }

  #setView(view: CalendarView): void {
    if (view === this._view) return;
    this._view = view;
    // Re-anchor: a month cursor must be the 1st, a week cursor a real day.
    this._cursor = view === "month" ? startOfMonth(this._cursor) : today();
  }

  #toggleOwner(ownerId: string): void {
    this._hidden =
      this._hidden.indexOf(ownerId) === -1
        ? [...this._hidden, ownerId]
        : this._hidden.filter((id) => id !== ownerId);
  }

  // --- dialog -------------------------------------------------------------

  #openCreate(day: Date, hour: number | null = null): void {
    this._dialogEvent = null;
    this._dialogDay = day;
    this._dialogHour = hour;
    this._dialogError = null;
    this._dialogBusy = false;
    this._dialogMode = "create";
  }

  #openEdit(event: OwnedEvent): void {
    this._dialogDay = null;
    this._dialogHour = null;
    this._dialogEvent = event;
    this._dialogError = null;
    this._dialogBusy = false;
    this._dialogMode = "edit";
  }

  #closeDialog(): void {
    this._dialogMode = null;
    this._dialogEvent = null;
    this._dialogDay = null;
    this._dialogHour = null;
    this._dialogError = null;
    this._dialogBusy = false;
  }

  #recurrenceTarget(event: OwnedEvent, scope: EditScope): RecurrenceTarget {
    if (!event.recurrence_id) return {};
    return scope === "future"
      ? { recurrenceId: event.recurrence_id, recurrenceRange: "THISANDFUTURE" }
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

  #optimisticAdd(target: CalendarTarget, input: CalendarEventInput): void {
    const next = new Map(this._byCalendar);
    next.set(target.entityId, [
      ...(next.get(target.entityId) ?? []),
      {
        summary: input.summary,
        start: input.start,
        end: input.end,
        all_day: input.start.indexOf("T") === -1,
        ownerId: target.ownerId,
        color: target.color,
        uid: `pending-${Date.now()}`,
      },
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

  // --- render -------------------------------------------------------------

  override render() {
    const events = this.#visibleEvents();
    const targets = this.#targets();
    const initials = new Map(
      targets.map((t) => [t.ownerId, t.label.slice(0, 1).toUpperCase()]),
    );

    return html`
      <nav class="rail" aria-label="Sections">
        <span class="mark">${this._title.slice(0, 1).toUpperCase()}</span>
        ${this.#railButton("calendar", "Calendar", true)}
        ${this.#railButton("chores", "Chores", false)}
        ${this.#railButton("lists", "Lists", false)}
        <span class="rail-spacer"></span>
        <a class="rail-item" href="${this.haUrl}/lovelace" id="open-ha">
          <span class="glyph">⌂</span><span class="label">Home</span>
        </a>
        <button
          class="rail-item"
          id="open-settings"
          @click=${() => {
            this._settingsOpen = true;
          }}
        >
          <span class="glyph">⚙</span><span class="label">Settings</span>
        </button>
      </nav>

      <main>
        <header>
          <h1>${this._title}</h1>
          <span class="clock">${formatClock(this._now)}</span>
          <span class="grow"></span>
          <button id="prev" aria-label="Previous" @click=${() => this.#shift(-1)}>
            &lsaquo;
          </button>
          <button id="today" @click=${this.#goToday}>Today</button>
          <button id="next" aria-label="Next" @click=${() => this.#shift(1)}>
            &rsaquo;
          </button>
          <span class="switch">
            <button
              id="view-week"
              class=${this._view === "week" ? "on" : ""}
              aria-pressed=${this._view === "week" ? "true" : "false"}
              @click=${() => this.#setView("week")}
            >
              Week
            </button>
            <button
              id="view-month"
              class=${this._view === "month" ? "on" : ""}
              aria-pressed=${this._view === "month" ? "true" : "false"}
              @click=${() => this.#setView("month")}
            >
              Month
            </button>
          </span>
        </header>

        ${this._error
          ? html`<p class="error" role="alert">${this._error}</p>`
          : nothing}
        ${this._failed.length && !this._error
          ? html`<p class="warn" role="status">
              Not showing ${this._failed.join(", ")} — check Settings.
            </p>`
          : nothing}
        ${this._rosterLoaded && this._roster.people.length === 0
          ? html`<p class="hint">${ROSTER_SETUP_HINT}</p>`
          : nothing}

        <div class="people">
          ${targets.map((target) => {
            const off = this._hidden.indexOf(target.ownerId) !== -1;
            return html`
              <button
                class="person ${off ? "off" : ""}"
                aria-pressed=${off ? "false" : "true"}
                @click=${() => this.#toggleOwner(target.ownerId)}
              >
                <span
                  class="dot"
                  style="background:${target.color};color:${readableTextOn(
                    target.color,
                  )}"
                  >${target.label.slice(0, 1).toUpperCase()}</span
                >
                <span class="name">${target.label}</span>
              </button>
            `;
          })}
        </div>

        <div class="view">
          ${this._view === "week"
            ? html`
                <hacal-week-view
                  .days=${dayColumns(this._cursor, this.daysShown)}
                  .events=${events}
                  .initials=${initials}
                  .now=${this._now}
                  @pick-day=${(e: CustomEvent<{ day: Date; hour: number }>) =>
                    this.#openCreate(e.detail.day, e.detail.hour)}
                  @pick-event=${(e: CustomEvent<{ event: OwnedEvent }>) =>
                    this.#openEdit(e.detail.event)}
                ></hacal-week-view>
              `
            : html`
                <hacal-month-view
                  .cursor=${startOfMonth(this._cursor)}
                  .events=${events}
                  .weekStartsOn=${this._roster.weekStartsOn}
                  .now=${this._now}
                  @pick-day=${(e: CustomEvent<{ day: Date }>) =>
                    this.#openCreate(e.detail.day)}
                  @pick-event=${(e: CustomEvent<{ event: OwnedEvent }>) =>
                    this.#openEdit(e.detail.event)}
                ></hacal-month-view>
              `}
        </div>
      </main>

      <button
        class="fab"
        id="add-event"
        aria-label="Add an event"
        @click=${() => this.#openCreate(today())}
      >
        +
      </button>

      ${this._settingsOpen
        ? html`
            <hacal-people-settings
              .client=${this.client}
              @settings-close=${() => {
                this._settingsOpen = false;
              }}
              @roster-changed=${() => void this.#loadRoster()}
            ></hacal-people-settings>
          `
        : nothing}
      ${this._dialogMode
        ? html`
            <hacal-event-dialog
              .mode=${this._dialogMode}
              .people=${this._roster.people}
              .event=${this._dialogEvent}
              .day=${this._dialogDay}
              .hour=${this._dialogHour}
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

  #railButton(id: string, label: string, enabled: boolean) {
    return html`
      <button
        class="rail-item ${id === "calendar" && enabled ? "on" : ""} ${enabled
          ? ""
          : "soon"}"
        id="rail-${id}"
        aria-disabled=${enabled ? "false" : "true"}
        title=${enabled ? label : `${label} — coming soon`}
      >
        <span class="glyph">${RAIL_GLYPHS[id] ?? "•"}</span>
        <span class="label">${label}</span>
      </button>
    `;
  }

  // Chrome 87 floor: no :has(), no nesting, no container queries.
  static override styles = css`
    :host {
      display: flex;
      height: 100%;
      font-family: system-ui, sans-serif;
      background: #fff;
      color: #1c1c1c;
      -webkit-tap-highlight-color: transparent;
    }
    .rail {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      flex: 0 0 72px;
      padding: 8px 0;
      background: #f5f6f8;
      border-right: 1px solid #e6e6e6;
    }
    .mark {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 40px;
      margin-bottom: 6px;
      font-weight: 700;
      opacity: 0.45;
    }
    .rail-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 10px 2px;
      background: transparent;
      border: none;
      border-left: 3px solid transparent;
      color: inherit;
      font-family: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    .rail-item .glyph {
      font-size: 1.25rem;
      line-height: 1;
    }
    .rail-item .label {
      font-size: 0.62rem;
      opacity: 0.75;
    }
    .rail-item.on {
      border-left-color: var(--hacal-accent, #6741d9);
      background: #fff;
    }
    .rail-item.soon {
      opacity: 0.35;
      cursor: default;
    }
    .rail-spacer {
      flex: 1;
    }
    main {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
    }
    h1 {
      margin: 0;
      font-size: 1.25rem;
    }
    .clock {
      font-size: 1.05rem;
      opacity: 0.6;
    }
    .grow {
      flex: 1;
    }
    header button {
      min-width: 44px;
      min-height: 44px;
      padding: 0 12px;
      font-size: 0.95rem;
      font-family: inherit;
      background: #f0f1f3;
      color: inherit;
      border: none;
      border-radius: 10px;
      cursor: pointer;
    }
    .switch {
      display: flex;
      gap: 2px;
      margin-left: 6px;
      padding: 3px;
      background: #f0f1f3;
      border-radius: 12px;
    }
    .switch button {
      min-height: 38px;
      background: transparent;
    }
    .switch button.on {
      background: #fff;
      font-weight: 600;
    }
    .people {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 14px 10px;
    }
    .person {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 40px;
      padding: 0 12px 0 4px;
      background: #f5f6f8;
      border: 2px solid transparent;
      border-radius: 22px;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      color: inherit;
      cursor: pointer;
    }
    .person.off {
      opacity: 0.4;
    }
    .dot {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 0.8rem;
      font-weight: 700;
    }
    .view {
      flex: 1;
      min-height: 0;
      border-top: 1px solid #e6e6e6;
    }
    .error,
    .warn,
    .hint {
      margin: 0 14px 8px;
      padding: 9px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
    }
    .error {
      background: #fdecea;
      color: #8c1d18;
    }
    .warn {
      background: #fff4e6;
      color: #8a5300;
    }
    .hint {
      background: #eef6f8;
      color: #22606d;
    }
    .fab {
      position: fixed;
      right: 22px;
      bottom: 22px;
      width: 60px;
      height: 60px;
      font-size: 1.9rem;
      line-height: 1;
      color: #fff;
      background: var(--hacal-accent, #6741d9);
      border: none;
      border-radius: 50%;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      z-index: 5;
    }
  `;
}

const RAIL_GLYPHS: Record<string, string> = {
  calendar: "🗓",
  chores: "✓",
  lists: "☰",
};

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSameInstance(a: OwnedEvent, b: OwnedEvent): boolean {
  if (a.uid !== b.uid) return false;
  return (a.recurrence_id ?? "") === (b.recurrence_id ?? "");
}

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

customElements.define("hacal-app-shell", AppShell);

declare global {
  interface HTMLElementTagNameMap {
    "hacal-app-shell": AppShell;
  }
}
