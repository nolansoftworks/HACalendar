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
  createChoreCalendar,
  createChoreList,
  fetchRoster,
} from "../ha/roster.js";
import {
  addChore,
  logCompletion,
  removeChore,
  setChoreStatus,
  subscribeChores,
  type ChoreItem,
} from "../ha/chores.js";
import {
  addDays,
  readableTextOn,
  startOfDay,
  startOfMonth,
  startOfWeek,
  visibleRange,
  type OwnedEvent,
} from "./grid.js";
import { dayColumns } from "./week-layout.js";
import { personStats } from "./person-stats.js";
import { viewLabel } from "./range-label.js";
import { formatDate, toEventInput } from "./event-form.js";
import { buildRrule, choreRules, type ChoreRule } from "./repeat-rule.js";
import "./week-view.js";
import "./month-view.js";
import "./chores-view.js";
import "./chore-dialog.js";
import "./event-dialog.js";
import "./people-settings.js";
import type { DialogSaveDetail, EditScope } from "./event-dialog.js";
import type { ChoreAddDetail } from "./chore-dialog.js";
import { choreProgress, findDuplicate } from "./chore-list.js";
import {
  DEFAULT_ROSTER,
  ROSTER_SETUP_HINT,
  type Person,
  type Roster,
} from "../people.js";

/** Days in the week view. A real Sunday-to-Saturday week, not a rolling window. */
const DAYS_IN_WEEK = 7;

/**
 * How far ahead the chore board looks for repeating chores.
 *
 * Only far enough to catch a monthly rule at least once -- the board shows one
 * row per *rule*, so a longer window would fetch thousands of instances of a
 * daily chore to display the same single line.
 */
const RULE_WINDOW_DAYS = 40;

export type CalendarView = "week" | "month";
/** Which rail destination is showing. */
export type Section = "calendar" | "chores";

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
 *
 * **There is no built-in shared calendar.** Every calendar shown comes from the
 * roster ([ADR-0028]). A household that wants a shared "Family" calendar adds
 * it in Settings like any other entry, which keeps this app free of any
 * assumption about what a particular household's entities are called.
 */
export class AppShell extends LitElement {
  static override properties = {
    client: { attribute: false },
    _section: { state: true },
    _view: { state: true },
    _chores: { state: true },
    _rules: { state: true },
    _choreBusy: { state: true },
    _choreAddFor: { state: true },
    _choreError: { state: true },
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

  _section: Section = "calendar";
  _view: CalendarView = "week";
  /** chore list entity id -> its items, as HA last pushed them. */
  _chores: Map<string, ChoreItem[]> = new Map();
  /** chore schedule calendar -> one row per rule, collapsed from its instances. */
  _rules: Map<string, ChoreRule[]> = new Map();
  /** Item uids with a write in flight, so a double tap cannot double-fire. */
  _choreBusy: string[] = [];
  /** Whose list the add-a-chore dialog is for, or null when it is closed. */
  _choreAddFor: Person | null = null;
  _choreError: string | null = null;
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
  #choreUnsubscribes: Map<string, () => Promise<void>> = new Map();
  #subscriptionToken = 0;
  #choreToken = 0;
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
    void this.#teardownChores();
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("client")) {
      void this.#loadRoster();
      void this.#loadTitle();
    }
    if (
      changed.has("client") ||
      changed.has("_cursor") ||
      changed.has("_view") ||
      changed.has("_roster")
    ) {
      void this.#resubscribe();
    }
    if (changed.has("client") || changed.has("_roster")) {
      void this.#resubscribeChores();
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

  /** One target per roster entry. Nothing is assumed or added on their behalf. */
  #targets(): CalendarTarget[] {
    const targets: CalendarTarget[] = [];
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

  #targetForOwner(ownerId: string): CalendarTarget | null {
    return this.#targets().filter((t) => t.ownerId === ownerId)[0] ?? null;
  }

  /** The span to subscribe over, which differs per view. */
  #range(): { start: Date; end: Date } {
    if (this._view === "month") {
      return visibleRange(startOfMonth(this._cursor), this._roster.weekStartsOn);
    }
    const start = startOfWeek(this._cursor, this._roster.weekStartsOn);
    return { start, end: addDays(start, DAYS_IN_WEEK) };
  }

  /** The seven days the week view shows. */
  #weekDays(): Date[] {
    return dayColumns(
      startOfWeek(this._cursor, this._roster.weekStartsOn),
      DAYS_IN_WEEK,
    );
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

  async #teardownChores(): Promise<void> {
    const unsubscribes = [...this.#choreUnsubscribes.values()];
    this.#choreUnsubscribes = new Map();
    for (const unsubscribe of unsubscribes) {
      try {
        await unsubscribe();
      } catch {
        // Connection may already be gone.
      }
    }
  }

  /**
   * Subscribe to every chore list. Kept live even on the calendar section,
   * because the person strip's counts come from here too -- and HA pushes the
   * whole list on change, so this is cheap.
   */
  async #resubscribeChores(): Promise<void> {
    if (!this.client) return;
    const token = ++this.#choreToken;
    await this.#teardownChores();
    this._chores = new Map();
    this._rules = new Map();

    const ruleStart = startOfDay(this._now);
    const ruleEnd = addDays(ruleStart, RULE_WINDOW_DAYS);

    for (const person of this._roster.people) {
      const listId = person.choreList;
      if (listId) {
        try {
          const unsubscribe = await subscribeChores(
            this.client,
            listId,
            (items) => {
              if (token !== this.#choreToken) return;
              const next = new Map(this._chores);
              next.set(listId, items);
              this._chores = next;
            },
          );
          if (token !== this.#choreToken) {
            await unsubscribe();
            return;
          }
          this.#choreUnsubscribes.set(listId, unsubscribe);
        } catch {
          // A missing list must not take the board down; the column offers to
          // create one instead.
        }
      }

      // The repeating half ([ADR-0030]). Absent until somebody schedules one,
      // which is the normal state for a household that only uses one-offs.
      const scheduleId = person.choreCalendar;
      if (!scheduleId) continue;
      try {
        const unsubscribe = await subscribeCalendarEvents(
          this.client,
          scheduleId,
          ruleStart,
          ruleEnd,
          (events) => {
            if (token !== this.#choreToken) return;
            const next = new Map(this._rules);
            // One row per rule, not per instance -- a daily chore arrives forty
            // times over this window.
            next.set(scheduleId, choreRules(events));
            this._rules = next;
          },
        );
        if (token !== this.#choreToken) {
          await unsubscribe();
          return;
        }
        this.#choreUnsubscribes.set(scheduleId, unsubscribe);
      } catch {
        // Same rule as the list: one bad entity must not blank the board.
      }
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

  /** Everything subscribed, filters ignored -- the strip's counts use this. */
  #allEvents(): OwnedEvent[] {
    const merged: OwnedEvent[] = [];
    this._byCalendar.forEach((events) => {
      for (const event of events) merged.push(event);
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
        : addDays(this._cursor, direction * DAYS_IN_WEEK);
  }

  #goToday(): void {
    this._cursor =
      this._view === "month"
        ? startOfMonth(today())
        : startOfWeek(today(), this._roster.weekStartsOn);
  }

  #setView(view: CalendarView): void {
    if (view === this._view) return;
    this._view = view;
    // Re-anchor: a month cursor must be the 1st, a week cursor the week start.
    this._cursor =
      view === "month"
        ? startOfMonth(this._cursor)
        : startOfWeek(this._cursor, this._roster.weekStartsOn);
  }

  #toggleOwner(ownerId: string): void {
    this._hidden =
      this._hidden.indexOf(ownerId) === -1
        ? [...this._hidden, ownerId]
        : this._hidden.filter((id) => id !== ownerId);
  }

  // --- dialog -------------------------------------------------------------

  #openCreate(day: Date, hour: number | null = null): void {
    // With nobody in the roster there is no calendar to write to, so send them
    // where they can fix that instead of opening a form that cannot save.
    if (this._roster.people.length === 0) {
      this._settingsOpen = true;
      return;
    }
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
        if (!target) throw new Error("Pick who this is for.");
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
        if (!target) throw new Error("That calendar is no longer available.");
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
      if (!target) throw new Error("That calendar is no longer available.");
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

  // --- chores ---------------------------------------------------------------

  #openAddChore(person: Person): void {
    this._choreError = null;
    this._choreAddFor = person;
  }

  /**
   * Ticking a chore completes it immediately -- one tap, no question.
   *
   * We used to ask "who did this?" ([ADR-0018]'s third call site), but the
   * chore already sits on somebody's list, so the answer was on screen. The
   * completion is still credited to the list's owner in the logbook, which is
   * what [ADR-0014] actually needs; we just stopped making a child confirm it.
   */
  #onToggleChore(person: Person, item: ChoreItem): void {
    const next = item.status === "completed" ? "needs_action" : "completed";
    void this.#setChore(person, item, next, person.id);
  }

  async #onDeleteChore(person: Person, item: ChoreItem): Promise<void> {
    const listId = person.choreList;
    if (!listId) return;
    this._choreBusy = [...this._choreBusy, item.uid];
    try {
      // By uid, never by name ([ADR-0029]).
      await removeChore(this.client, listId, item.uid);
    } catch (err) {
      this._error = errorMessage(err);
    } finally {
      this._choreBusy = this._choreBusy.filter((uid) => uid !== item.uid);
    }
  }

  async #setChore(
    person: Person,
    item: ChoreItem,
    status: ChoreItem["status"],
    creditTo: string | null,
  ): Promise<void> {
    const listId = person.choreList;
    if (!listId) return;

    this._choreBusy = [...this._choreBusy, item.uid];
    try {
      // By uid, never by name -- a name silently no-ops against a duplicate
      // ([ADR-0029]).
      await setChoreStatus(this.client, listId, item.uid, status);
      if (status === "completed" && creditTo) {
        // Attribution is a nicety; losing it must not undo the checkmark.
        await logCompletion(this.client, creditTo, item.summary, listId).catch(
          () => undefined,
        );
      }
      this.#closeChoreDialog();
    } catch (err) {
      this._choreError = errorMessage(err);
    } finally {
      this._choreBusy = this._choreBusy.filter((uid) => uid !== item.uid);
    }
  }

  async #onAddChore(detail: ChoreAddDetail): Promise<void> {
    const person = this._choreAddFor;
    if (!person || !person.choreList) return;
    this._choreError = null;
    try {
      if (detail.repeat === "none") {
        await addChore(
          this.client,
          person.choreList,
          detail.summary,
          detail.due,
        );
      } else {
        await this.#addRepeatingChore(person, detail);
      }
      this.#closeChoreDialog();
    } catch (err) {
      this._choreError = errorMessage(err);
    }
  }

  /**
   * A repeating chore is a rule, not an item ([ADR-0008]).
   *
   * It becomes an all-day `RRULE` event on the person's chore schedule
   * calendar, and the nightly automation puts today's instance on their list
   * at 00:05. Two consequences handled here:
   *
   * 1. The schedule calendar is made on demand, so nobody carries a third
   *    entity until they use it.
   * 2. If the rule starts *today*, the item is added now as well. Waiting
   *    until after midnight to see the chore you just typed would read as the
   *    app having lost it — and the automation will skip it tomorrow because
   *    it dedupes on outstanding names, exactly as a rollover does.
   */
  async #addRepeatingChore(
    person: Person,
    detail: ChoreAddDetail,
  ): Promise<void> {
    const rrule = buildRrule(detail.repeat, detail.due);
    if (!rrule || !person.choreList) return;

    let scheduleId = person.choreCalendar;
    if (!scheduleId) {
      scheduleId = await createChoreCalendar(this.client, person);
      await this.#loadRoster();
    }

    await createEvent(this.client, scheduleId, {
      summary: detail.summary,
      start: detail.due,
      // All-day, and HA's end is exclusive: one day means start + 1.
      end: formatDate(addDays(parseHaDate(detail.due), 1)),
      rrule,
    });

    if (detail.due !== formatDate(this._now)) return;
    const outstanding = this._chores.get(person.choreList) ?? [];
    if (findDuplicate(outstanding, detail.summary)) return;
    await addChore(this.client, person.choreList, detail.summary, detail.due);
  }

  /**
   * Stop a chore repeating: delete the whole series, not one instance.
   *
   * No `recurrence_id`, so this is the "and all the future ones" delete —
   * which is what "stop it" means. Items already materialized onto somebody's
   * list stay there; cancelling a rule is not the same as saying today's chore
   * was done.
   */
  async #onDeleteRule(person: Person, rule: ChoreRule): Promise<void> {
    const scheduleId = person.choreCalendar;
    if (!scheduleId) return;
    this._choreBusy = [...this._choreBusy, rule.uid];
    try {
      await deleteEvent(this.client, scheduleId, rule.uid);
    } catch (err) {
      this._error = errorMessage(err);
    } finally {
      this._choreBusy = this._choreBusy.filter((uid) => uid !== rule.uid);
    }
  }

  async #onMakeList(person: Person): Promise<void> {
    try {
      await createChoreList(this.client, person);
      await this.#loadRoster();
    } catch (err) {
      this._error = errorMessage(err);
    }
  }

  #closeChoreDialog(): void {
    this._choreAddFor = null;
    this._choreError = null;
  }

  /** Chore counts for one person, for the header strip. */
  #choreProgressFor(person: Person) {
    const items = person.choreList ? this._chores.get(person.choreList) : null;
    return choreProgress(items ?? [], this._now);
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
        ${this.#railButton("calendar")}
        ${this.#railButton("chores")}
        ${this.#railButton("lists")}
        <span class="rail-spacer"></span>
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
          ${this._section !== "calendar" ? nothing : html`
          <button id="prev" aria-label="Previous" @click=${() => this.#shift(-1)}>
            &lsaquo;
          </button>
          <span class="range" id="range-label" aria-live="polite"
            >${viewLabel(
              this._view,
              this._cursor,
              this._roster.weekStartsOn,
              DAYS_IN_WEEK,
            )}</span
          >
          <button id="next" aria-label="Next" @click=${() => this.#shift(1)}>
            &rsaquo;
          </button>
          <button id="today" @click=${this.#goToday}>Today</button>
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
          `}
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
            // Stats ignore the filter: hiding someone must not zero their
            // counts, or the strip would stop telling you why you hid them.
            const person = this._roster.people.filter(
              (p) => p.id === target.ownerId,
            )[0];
            const allChores = person ? this.#choreProgressFor(person) : null;
            const chores = this._section === "chores" ? allChores : null;
            // On the calendar, say whether they owe chores *today*.
            const choresToday =
              this._section === "calendar" && allChores
                ? allChores.dueToday + allChores.overdue
                : 0;
            // Filtering is a calendar idea. On the chore board every column is
            // already separate, so graying a name out just looked broken.
            const filterable = this._section === "calendar";
            const stats = personStats(
              this.#allEvents(),
              target.ownerId,
              this._now,
            );
            const shownDone = chores ? chores.done : stats.past;
            const shownTotal = chores ? chores.total : stats.total;
            const badge = chores ? chores.overdue : stats.today;
            const badgeWord = chores ? "late" : "today";
            const done = shownTotal
              ? Math.round((shownDone / shownTotal) * 100)
              : 0;
            return html`
              <button
                class="person ${filterable && off ? "off" : ""} ${
                  filterable ? "" : "static"
                }"
                aria-pressed=${filterable ? (off ? "false" : "true") : "false"}
                title="${target.label}: ${shownDone} of ${shownTotal} ${
                  chores ? "chores done" : "events past"
                }"
                @click=${() => {
                  if (filterable) this.#toggleOwner(target.ownerId);
                }}
              >
                <span
                  class="dot"
                  style="background:${target.color};color:${readableTextOn(
                    target.color,
                  )}"
                  >${target.label.slice(0, 1).toUpperCase()}</span
                >
                <span class="who">
                  <span class="name">${target.label}</span>
                  <span class="counts">
                    <b>${shownDone}</b>/${shownTotal}
                    ${badge
                      ? html`<span class="badge ${chores ? "overdue" : ""}"
                          >${badge} ${badgeWord}</span
                        >`
                      : nothing}
                    ${choresToday
                      ? html`<span class="badge chores"
                          >${choresToday}
                          ${choresToday === 1 ? "chore" : "chores"}</span
                        >`
                      : nothing}
                  </span>
                  <span class="bar">
                    <span
                      class="fill"
                      style="width:${done}%;background:${target.color}"
                    ></span>
                  </span>
                </span>
              </button>
            `;
          })}
        </div>

        <div class="view">
          ${this._section === "chores"
            ? html`
                <hacal-chores-view
                  .people=${this._roster.people}
                  .itemsByList=${this._chores}
                  .rulesByCalendar=${this._rules}
                  .now=${this._now}
                  .busyUids=${this._choreBusy}
                  @toggle-chore=${(
                    e: CustomEvent<{ person: Person; item: ChoreItem }>,
                  ) => this.#onToggleChore(e.detail.person, e.detail.item)}
                  @add-chore=${(e: CustomEvent<{ person: Person }>) =>
                    this.#openAddChore(e.detail.person)}
                  @delete-chore=${(
                    e: CustomEvent<{ person: Person; item: ChoreItem }>,
                  ) => void this.#onDeleteChore(e.detail.person, e.detail.item)}
                  @delete-rule=${(
                    e: CustomEvent<{ person: Person; rule: ChoreRule }>,
                  ) => void this.#onDeleteRule(e.detail.person, e.detail.rule)}
                  @make-list=${(e: CustomEvent<{ person: Person }>) =>
                    void this.#onMakeList(e.detail.person)}
                ></hacal-chores-view>
              `
            : this._view === "week"
            ? html`
                <hacal-week-view
                  .days=${this.#weekDays()}
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

      ${this._section !== "calendar" ? nothing : html`
      <button
        class="fab"
        id="add-event"
        aria-label="Add an event"
        @click=${() => this.#openCreate(today())}
      >
        +
      </button>`}

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
      ${this._choreAddFor
        ? html`
            <hacal-chore-dialog
              .person=${this._choreAddFor}
              .existing=${
                this._choreAddFor.choreList
                  ? this._chores.get(this._choreAddFor.choreList) ?? []
                  : []
              }
              .busy=${this._choreBusy.length > 0}
              .error=${this._choreError}
              @chore-cancel=${this.#closeChoreDialog}
              @chore-add=${(e: CustomEvent<ChoreAddDetail>) =>
                void this.#onAddChore(e.detail)}
            ></hacal-chore-dialog>
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

  #railButton(id: string) {
    const label = RAIL_LABELS[id] ?? id;
    const section = id === "calendar" || id === "chores" ? (id as Section) : null;
    const active = section !== null && this._section === section;

    return html`
      <button
        class="rail-item ${active ? "on" : ""} ${section ? "" : "soon"}"
        id="rail-${id}"
        aria-current=${active ? "page" : "false"}
        aria-disabled=${section ? "false" : "true"}
        title=${section ? label : `${label} — not built yet`}
        @click=${() => {
          if (section) this._section = section;
        }}
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
    .range {
      min-width: 15rem;
      font-size: 1.05rem;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
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
      gap: 9px;
      flex: 1 1 8rem;
      min-width: 0;
      min-height: 52px;
      padding: 6px 14px 6px 6px;
      background: #f5f6f8;
      border: 2px solid transparent;
      border-radius: 26px;
      font-family: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .person.off {
      opacity: 0.4;
    }
    .dot {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 34px;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      font-size: 0.9rem;
      font-weight: 700;
    }
    .who {
      display: flex;
      flex-direction: column;
      flex: 1;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font-size: 0.85rem;
      font-weight: 600;
      line-height: 1.1;
    }
    .counts {
      font-size: 0.72rem;
      opacity: 0.7;
    }
    .counts b {
      font-weight: 700;
      opacity: 1;
    }
    .badge.overdue {
      background: #c92a2a;
    }
    .badge.chores {
      background: #495057;
    }
    .person.static {
      cursor: default;
    }
    .badge {
      margin-left: 5px;
      padding: 1px 6px;
      border-radius: 8px;
      background: #e8590c;
      color: #fff;
      font-weight: 600;
    }
    .bar {
      display: block;
      height: 4px;
      margin-top: 2px;
      overflow: hidden;
      background: #e2e4e8;
      border-radius: 2px;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: 2px;
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

const RAIL_LABELS: Record<string, string> = {
  calendar: "Calendar",
  chores: "Chores",
  lists: "Lists",
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
