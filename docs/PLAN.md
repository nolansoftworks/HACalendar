# Implementation plan

Phases are ordered by risk, not by size. Each phase names an **exit criterion**
that must be *observed*, not inferred from a passing build.

For current state, see `docs/STATUS.md`. For why, see `docs/DECISIONS.md`.

---

## Phase 0 — Scaffold ✅

Vite + Lit + TS, Chrome 87 target, both mount points, dev HA in Docker.

**Exit criterion:** typecheck clean, build clean, bundle scan clean. ✅

---

## Phase 1 — Live month view ✅

**Closed 2026-09-03** against live HA 2026.7.2 at `192.168.1.197:8123`. The
schemas were *not* right as transcribed — see the `dtstart`/`dtend` finding
below and in [ADR-0024]. Verification was done by driving the real exported
functions over a websocket and the real UI in headless Chrome with
`Emulation.setTimezoneOverride: America/Chicago`.

Prove the spine end to end: auth → websocket → subscription → render. This is
the phase where we find out whether the websocket schemas transcribed from HA's
source are actually correct.

**Full setup runbook: [`docs/DEV-SETUP.md`](DEV-SETUP.md).** Short version:

```bash
npm rm -g node                  # one-time: global node@21 shadows the real one
npm install
npm run build                   # BEFORE ha:up -- panel_custom points at panel.js
npm run ha:up                   # Docker must already be running
npm run ha:logs                 # wait for "Home Assistant initialized"
```

Then, by hand (unavoidable — `local_calendar` is config-flow only):

1. http://localhost:8123 → create owner account → **confirm timezone is
   US/Central**. HA does not always inherit the container's `TZ`.
2. **Settings → Devices & Services → Add Integration → Local Calendar**, name it
   `Family` → yields `calendar.family`.
3. Seed events that exercise the actual bugs, not just the happy path:
   an all-day event on the **1st**, another on the **last day** of the month, a
   **multi-day** event, and a **weekly recurring** one.

```bash
npm run watch                                        # builds into HA's www/
docker compose -f dev/docker-compose.yml restart     # HA reads panel_custom only at startup
```

Checklist:

- [x] Dev HA up; timezone confirmed **US/Central** (`GET /api/config`)
- [x] `calendar.family` exists and is seeded with the five event shapes above
- [x] Panel renders events at `/family-calendar`
- [x] Standalone renders the same at `/local/hacalendar/index.html`
- [x] All-day events land on the **correct** day at both month boundaries
- [x] Multi-day event doesn't bleed one day past its end
- [x] Rapid month-flipping leaves exactly one live subscription
      (12 rapid clicks → 14 subscribes, 13 unsubscribes, exactly 1 left open)

**Exit criterion:** both mount points render real events from `calendar.family`,
all-day events sit on the right day in Central time, and rapid month-flipping
leaves exactly one live subscription.

**Known risks in this phase.**
- All-day events arrive as bare `YYYY-MM-DD`. `new Date("2026-07-09")` parses
  as **UTC** midnight, rendering a day early west of Greenwich. `parseHaDate()`
  handles this — confirm on real data, near a month boundary.
- HA sends `end` **exclusive**. An all-day event on the 9th arrives as
  start=09, end=10 and must not bleed into the 10th.
- The `#subscriptionToken` guard in `month-view.ts` exists to stop an
  out-of-order subscribe from winning. Exercise it by flipping months fast.

---

## Phase 1.5 — Multi-calendar overlay ✅

**Closed 2026-09-03.** Per [ADR-0017]: `calendar.family` + one
`calendar.<person>` each, rendered as a **single** color-coded grid. The
household never sees an entity.

- [x] `people.json` loader ([ADR-0021]) — roster, colors, `weekStartsOn`
- [x] Subscribe to N calendars, merge into one event stream
- [x] Color chips by owning calendar
- [x] Per-person filter toggles
- [x] `weekStartsOn` drives the grid instead of the current Sunday hardcode

**Exit criterion — met.** Verified against live HA with two throwaway
calendars, in headless Chrome pinned to `America/Chicago`: a dentist
appointment on one calendar rendered `rgb(232, 89, 12)` and a book club on the
other rendered `rgb(95, 61, 196)` **on the same day**; toggling the first off
hid only its events and left both the second person's and the shared
calendar's intact. Flipping `weekStartsOn` to `1` moved the headings to
Mon–Sun and opened the grid on Aug 31 instead of Aug 30, with events staying on
their correct dates.

**Notes.**
- The pure grid maths moved to `src/ui/grid.ts` so it can be unit-tested
  without a DOM — this closes the testability debt recorded in `STATUS.md`.
  18 `node:test` assertions, no new dependencies, passing in four timezones.
- A per-person calendar that 404s is **soft-failed**: the other calendars still
  render and the grid shows a small warning naming the bad entity. A blank
  calendar in the kitchen is worse than an incomplete one.
- Verified with a five-person household, each member having a `calendar.<id>`
  created over the scriptable config flow (`CLAUDE.md` gotcha 5). Nobody
  touched the HA UI. The roster itself is operator config and deliberately
  lives outside this repo ([ADR-0025]).
- Colors were chosen dark enough that `readableTextOn()` returns white for all
  five, so chip text is uniform rather than flipping between black and white.
- Verified with all six calendars live and one event per person on the **same
  day**: every chip took its owner's color, the all-day event sorted above the
  timed ones, and hiding everyone but one person left exactly that person's
  event.

**Chore lists are deliberately absent from the roster.** `choreList` stays
unset until Phase 3 creates the `todo.chores_<kid>` entities — pointing the
roster at entities that don't exist would be aspirational config, and
[ADR-0021] makes both fields optional precisely so this can be staged.

**Note:** `public/people.json` is a build artifact — Vite copies it from
`public/` into `www/`, and `emptyOutDir` wipes anything hand-edited there. A
roster change is a commit plus a deploy, not an edit on the server.

---

## Phase 2 — Event CRUD 🔴 **← current**

Touch-first create / edit / delete. This is the phase that actually replaces
the dry-erase board — until it lands, the app is read-only and useless to the
household.

- [x] The **"who is this for?" picker** ([ADR-0018]) — `src/ui/person-picker.ts`,
      built generic so Phase 3 can reuse it for the other two questions.
- [x] Tap a day → create event (summary, start, end, all-day toggle)
- [x] Tap an event → edit / delete
- [x] Recurring events: `THISANDFUTURE` vs single-instance on edit and delete
- [x] Optimistic UI, with rollback on websocket error
- [ ] On-screen keyboard doesn't occlude the dialog (real tablet, not emulator)

**Code complete, exit criterion NOT met.** Everything above except the keyboard
was driven end to end in headless Chrome against the live instance: creating an
event on a tapped day wrote it to the picked person's calendar and rendered in
their color; renaming persisted; the inclusive end date became HA's exclusive
one; delete required a second tap and only then removed it. On the recurring
series, "only this one" renamed exactly one instance while `THISANDFUTURE`
changed that instance and all later ones and left the earlier exception intact.
Deleting an event behind the UI's back and then saving produced a rollback, an
error, and no write.

**The exit criterion is deliberately still open**, because it is about a person,
not a protocol: *a non-technical adult adds, edits, and deletes an event on the
touchscreen without help or instruction.* Nobody has tried. So is the keyboard
item — the sheet is top-anchored with `max-height: 92vh` and its own scroll
precisely so a shrinking visual viewport can't bury the fields, but that is a
prediction until it is seen on the real tablet.

**Notes.**
- Date conversion lives in `src/ui/event-form.ts`, pure and unit-tested. The
  dialog shows an **inclusive** end date because that is how people think; HA
  stores an exclusive one. Getting that backwards makes every all-day event a
  day too long, so it has round-trip tests at a month boundary.
- Timed events are sent as local time with an explicit offset. `toISOString()`
  would shift a 5pm event to 22:00.
- HA pushes a fresh list on every change — twice for a single create — so
  optimistic state is corrected automatically and duplicate pushes are a no-op.
- HA's write errors are developer-facing; they are translated for the household
  and the raw text is logged to the console.

**Notes.** Edit/delete are websocket-only — no service exists, so no automation
can do this. `recurrence_id` + `recurrence_range` are the only levers for
scoping a change to a series. Only `local_calendar` will accept these at all
([ADR-0001]).

**Do not build** a "change owner" affordance yet. Moving an event between
calendars is a delete + create, which mints a **new UID** and quietly undermines
[ADR-0009]. If it's wanted, it needs its own decision.

---

## Phase 3 — Chores and the Today view

Entity pairs per [ADR-0012]: `calendar.chores_<kid>` + `todo.chores_<kid>`.

- [ ] One `local_todo` per kid, one chore `local_calendar` per kid
- [ ] **Today view** ([ADR-0020]) — today's agenda plus every kid's chore list.
      This becomes the kiosk default; the month grid moves one tap away.
- [ ] Big-target check-off UI, obvious completion feedback
- [ ] **"Who did this?" picker on check-off** ([ADR-0018]), then
      `todo.update_item(status: completed)` + `logbook.log(name: <id>, …)`
- [ ] **Kids add tasks** ([ADR-0019]) — "who's adding this?" picker routes the
      item to that person's list
- [ ] **Duplicate-name refusal.** A task duplicating an existing incomplete item
      on the same list makes *both* unaddressable. Catch it in the UI, refuse
      kindly. This is data integrity, not polish.
- [ ] Overdue items visibly overdue — this is the accountability signal
      ([ADR-0013])
- [ ] Kids must not need to read fluently to use it

**Exit criterion:** a child adds a task, picks their name, checks it off
unprompted, it stays checked across a reload, and the logbook shows who did it.
Adding a duplicate name produces a friendly refusal, not a corrupted list.

---

## Phase 4 — Recurring chores

Per [ADR-0008]: recurring chore = `RRULE` event on `calendar.chores_<kid>`,
materialized into `todo.chores_<kid>`. Chores **roll over until completed**
([ADR-0013]).

Runs as a plain HA automation — `calendar.get_events` and `todo.get_items` both
support `response_variable`. **No custom integration.**

- [ ] Nightly automation, per kid:
      1. `calendar.get_events` on `calendar.chores_<kid>` for today
      2. `todo.get_items` on `todo.chores_<kid>` (defaults to `needs_action`)
      3. For each instance whose name is **not** already an incomplete item →
         `todo.add_item(item, due_date)`
- [ ] Verify idempotency: run it twice, get one item
- [ ] Verify rollover: skip a week, confirm exactly one item with the
      **original** due date. Never bump the due date.
- [ ] `todo.remove_completed_items` sweep at **00:05, immediately before**
      materialization ([ADR-0022]). It takes no filter and removes *every*
      completed item — running it during the day erases a checkmark a child
      earned minutes ago.

**Exit criterion:** "trash every Tuesday" appears on Tuesday, once; running the
automation twice adds nothing; skipping a week leaves one increasingly-overdue
item, not two.

**Watch for.** Chore names must be unique within a list — `todo.update_item`
addresses items *by name* and `add_item` cannot set a UID, so same-named items
are unaddressable through HA's API. This is a hard API constraint, not a
convention we can relax.

---

## Phase 5 — Deployment

Server is the always-on laptop; the Pi is a kiosk client ([ADR-0023]). Much of
this is already true — the server *is* the dev instance — so "deployment" here is
mostly the kiosk and the backup story, not standing up a new box.

- [ ] Raspberry Pi: normal OS + Chromium kiosk, autostart, pointed at
      `http://<laptop>:8123/family-calendar`, idling on the Today view
      ([ADR-0020])
- [ ] Screen blanking / wake-on-touch on the Pi
- [ ] **Scheduled backup of the `config/` volume** — no HA OS snapshots on
      Container ([ADR-0023]); `local_calendar` and chores live in that volume
- [ ] Container `restart: unless-stopped` verified across a laptop reboot
- [ ] **Test on a real Fire OS 7 tablet** — the first true check of [ADR-0003]

**Exit criterion:** the calendar survives a laptop reboot and an HA image
upgrade untouched, and the wall Pi returns to the Today view on its own.

---

## Phase 6 — iCloud sync (post-MVP)

Per [ADR-0010]. `vdirsyncer` against `local_calendar`'s `.ics` → iCloud CalDAV.
Explicitly **not** via HA's `caldav` integration, which cannot propagate edits
or deletes.

Blocked on nothing. Phases 1–5 owe this phase exactly one thing — stable,
preserved UIDs — already guaranteed by [ADR-0009].

- [ ] Conflict resolution policy — decided **at Phase 6 entry**, not before
      ([ADR-0016]). Do not invent one earlier.
- [ ] App-specific password handling
- [ ] Verify UIDs survive a round trip ([ADR-0009] pays off or doesn't, here)

`local_todo` also persists as iCalendar (`VTODO`), so chores could sync to Apple
Reminders by the same route. Not planned; noted because it's nearly free.

**Exit criterion:** an event created on the wall panel appears on an iPhone, and
an event deleted on the iPhone disappears from the wall panel.

---

## Deliberately not doing

- **Two-way Google Calendar sync via HA's integration.** Impossible; create-only.
- **Supporting Android < 5.0.** Would force real legacy shims ([ADR-0015]).
  Older-but-supported devices get Firefox, not shims.
- **Internet exposure of the standalone page.** See [ADR-0007].
- **Deciding the sync conflict policy now.** See [ADR-0016]. A future agent
  will be tempted to "resolve" this. Don't.
- **Per-kid HA accounts.** The picker is attribution, not auth ([ADR-0018]).
- **Encoding the person into event text.** No `ATTENDEE` field exists; the
  answer is per-person calendars ([ADR-0017]), not string parsing.
- **A "change event owner" affordance.** It's a delete + create, so it mints a
  new UID. Needs its own decision first.

[ADR-0001]: DECISIONS.md#adr-0001
[ADR-0003]: DECISIONS.md#adr-0003
[ADR-0006]: DECISIONS.md#adr-0006
[ADR-0007]: DECISIONS.md#adr-0007
[ADR-0008]: DECISIONS.md#adr-0008
[ADR-0009]: DECISIONS.md#adr-0009
[ADR-0010]: DECISIONS.md#adr-0010
[ADR-0012]: DECISIONS.md#adr-0012
[ADR-0013]: DECISIONS.md#adr-0013
[ADR-0014]: DECISIONS.md#adr-0014
[ADR-0015]: DECISIONS.md#adr-0015
[ADR-0016]: DECISIONS.md#adr-0016
[ADR-0017]: DECISIONS.md#adr-0017
[ADR-0018]: DECISIONS.md#adr-0018
[ADR-0019]: DECISIONS.md#adr-0019
[ADR-0020]: DECISIONS.md#adr-0020
[ADR-0021]: DECISIONS.md#adr-0021
[ADR-0022]: DECISIONS.md#adr-0022
[ADR-0023]: DECISIONS.md#adr-0023
[ADR-0024]: DECISIONS.md#adr-0024
