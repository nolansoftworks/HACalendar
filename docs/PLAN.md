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

- [x] Roster loader ([ADR-0021]) — people, colors, `weekStartsOn`. Now reads
      HA's label registry rather than a file ([ADR-0026]).
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
  touched the HA UI. The roster lives in HA's label registry and is edited in
  the app ([ADR-0026]) — never in this repo, so a fork arrives with nobody in
  it.
- The offered palette is dark enough that `readableTextOn()` returns white for
  every entry, so chip text is uniform rather than flipping between black and
  white across the grid.
- Verified with all six calendars live and one event per person on the **same
  day**: every chip took its owner's color, the all-day event sorted above the
  timed ones, and hiding everyone but one person left exactly that person's
  event.

**Chore lists are deliberately absent from the roster.** `choreList` stays
unset until Phase 3 creates the `todo.chores_<kid>` entities — pointing the
roster at entities that don't exist would be aspirational config, and
[ADR-0021] makes both fields optional precisely so this can be staged.

**Note:** the roster is no longer a file at all. It lives in HA's label
registry and is edited in the app ([ADR-0026]), so changing it needs neither a
rebuild nor a commit.

---

## Phase 2 — Event CRUD ✅ code complete

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

## Phase 2.5 — The appliance shell ✅

**Closed 2026-09-03.** Per [ADR-0027], after the household named a Skylight
Calendar as the reference: this is a family calendar appliance that runs on HA,
not an HA tablet showing a calendar.

- [x] Left rail — Calendar, Chores, Lists, then Settings
- [x] Header — household name from HA's own instance name, live clock,
      date navigation, Week/Month switch
- [x] Person strip — colored chips that filter the grid, each showing how many
      events that person has in view, how many are past, and how many are today
- [x] **Seven-day time grid as the default view** — Sunday to Saturday, day
      columns, hour axis, events positioned and sized by real times, tinted by
      owner ([ADR-0028]; it started as a rolling five days)
- [x] All-day band above the grid
- [x] Floating **+** to add
- [x] Month grid kept as the secondary view

**Exit criterion — met.** Driven in headless Chrome against the live instance
at 1280×800: five day columns starting today, the current day badged, blocks
placed at the right offsets, two overlapping events split into equal
side-by-side lanes with a third reusing the freed lane, all-day items in the
band rather than the grid, and tapping an hour slot opening a *timed* event
prefilled to that hour.

**Notes.**
- The geometry lives in `src/ui/week-layout.ts`, pure and unit-tested like
  `grid.ts` — overlap clustering, lane assignment, clamping and the now-line.
- `app-shell.ts` took ownership of the roster, subscriptions, filters and the
  dialog, so both views are presentational. The subscription window now depends
  on the active view, so switching resubscribes.
- Two things only a real screen revealed: the hour window must always contain
  the current hour, or the now-line vanishes each evening and the display looks
  frozen; and the grid must auto-scroll to now, or it opens at 7am while the
  day is happening at 5pm.

**Settled since:** the strip counts *calendar events*, plus a single "2 chores"
badge for what somebody owes today. The full chore tally lives on the chore
board's own column headers instead — putting it in both places produced two
rows of the same five names, one above the other.

---

## Phase 3 — Chores ✅ mechanics complete

Entity pairs per [ADR-0012]: `calendar.chores_<kid>` + `todo.chores_<kid>`.

- [x] One `local_todo` per person — **everyone**, adults included, per the
      household's decision. Provisioned through the scriptable config flow.
- [x] ~~Today view~~ — replaced by the **Chores rail destination** ([ADR-0027]
      superseded [ADR-0020]). One column per person, reachable in one tap.
- [x] Big-target check-off UI, obvious completion feedback
- [x] Check-off is **one tap** — `todo.update_item(status: completed)` plus
      `logbook.log(name: <id>, …)` credited to the list's owner. The
      "who did this?" picker was built and then removed at the household's
      request; see the note on [ADR-0018].
- [x] **Delete a chore** — two taps on the row's ×, since deleting is not
      undoable. Uses `todo.remove_item` by uid, so it needs no sweep.
- [x] **Anyone adds chores** — the add dialog writes to that column's owner
- [ ] ~~Duplicate-name refusal~~ — **cancelled by [ADR-0029]**. Items carry a
      `uid` and are addressable by it, so duplicates corrupt nothing. Address
      by uid everywhere; never pass a name to `update_item`/`remove_item`,
      which silently no-ops when a duplicate exists. The UI may *mention* an
      existing item of the same name, but must not refuse the add.
- [x] Overdue items visibly overdue — this is the accountability signal
      ([ADR-0013]). "3 days late" in words, a red edge, and sorted to the top
      of the column, longest-overdue first.
- [ ] Kids must not need to read fluently to use it — **needs real children**.
      Status is carried by words, colour, a checkbox and a strikethrough rather
      than colour alone, but whether a five-year-old can work it is not
      something automation can answer.

**Mechanics verified, exit criterion still open.** Driven end to end against
the live instance: the rail navigates, all five columns render, an overdue
chore says "2 days late" and sorts to the top, ticking one completes it
immediately and writes the completion to the logbook against its owner's roster
id, and deleting takes two taps and then removes exactly that item. Adding a
chore whose name already exists is *mentioned* and then allowed, and both
copies came back with distinct uids.

**The person strip does not appear on the chore board at all.** It was first
made informational there — chips that showed chore counts but did not filter,
since the columns are already separate and graying a name out only looked
broken. That was still wrong: the column headers say the same thing, better,
right above the chores themselves, so the screen carried two rows of the same
five names. The strip is now calendar-only, where it filters and where it also
shows how many chores each person owes **today** — due today plus already
overdue — as a single badge.

The exit criterion is about a child, not a protocol: *a child adds a task,
picks their name, checks it off unprompted, it stays checked across a reload,
and the logbook shows who did it.* Nobody's children have tried it.

---

## Phase 4 — Recurring chores ✅ built, one deploy short

Per [ADR-0008]: recurring chore = `RRULE` event on the person's chore schedule
calendar, materialized into their chore list. Chores **roll over until
completed** ([ADR-0013]).

Runs as a plain HA automation — `calendar.get_events` and `todo.get_items` both
support `response_variable`. **No custom integration.**

- [x] The other half of [ADR-0012]'s entity pair — a chore *schedule* calendar
      per person, made on demand and told apart from their own calendar by a
      shared label rather than by its entity id ([ADR-0030])
- [x] Nightly automation, for every person the label registry knows about:
      1. `calendar.get_events` on their schedule calendar for today
      2. `todo.get_items` on their chore list (defaults to `needs_action`)
      3. For each instance whose name is **not** already an incomplete item →
         `todo.add_item(item, due_date)`
- [x] Verify idempotency: run it twice, get one item
- [x] Verify rollover: skip a week, confirm exactly one item with the
      **original** due date. Never bump the due date.
- [x] `todo.remove_completed_items` sweep at **00:05, immediately before**
      materialization ([ADR-0022]). It takes no filter and removes *every*
      completed item — running it during the day erases a checkmark a child
      earned minutes ago.
- [x] **A repeat can be set from the app** — "Does it happen again?" in the
      add-a-chore dialog: just once, every day, weekdays, every *that weekday*,
      or monthly on that date. Anything else is not offered.
- [x] **A repeat can be stopped from the app** — the rules get a quiet
      "Happens again" section at the foot of each column, two taps to cancel,
      one row per rule rather than per instance
- [ ] The automation has never fired **on its own trigger** — see below

**Mechanics verified, deployment pending.** Every action in
`dev/config/automations/chores-nightly.yaml` was driven against the live
instance by parsing *that file* and running its `actions:` block over
`execute_script`, so what was tested is the artifact that ships, not a
transcription of it. Seven assertions passed: today's weekly rule materialized
exactly once and due *today*; a daily rule on a second person's list did too; a
rule for tomorrow did not; a second run added nothing; an item missed for a week
stayed a single row with its original due date untouched; and yesterday's
completed item was swept. From the UI: authoring "every Friday" wrote the rule,
put today's instance straight onto the list rather than making a child wait for
midnight, and a later automation run added no duplicate; cancelling the rule
took two taps, removed the series, and left the already-materialized item alone.

**What is not verified: the trigger and the loading.** HA reads automations
only through `configuration.yaml`, and the live instance is running the
server's checkout, which does not have the `!include_dir_merge_list` line yet.
Worth knowing why that matters: the config API **accepts** an automation over
REST and writes `automations.yaml` and then loads nothing, with no error
anywhere — verified 2026-09-04. So until the server pulls and restarts, the
materializer exists and works but nothing runs it at 00:05.

```bash
# on the server, after pulling
npm install && npm run build
docker compose -f dev/docker-compose.yml restart   # configuration.yaml changed
```

**Exit criterion:** "trash every Tuesday" appears on Tuesday, once; running the
automation twice adds nothing; skipping a week leaves one increasingly-overdue
item, not two. All three are observed — but by hand, not by the clock. It stays
open until the automation has fired on its own at 00:05 and a chore appeared
overnight without anyone asking.

**Watch for.** Address items by `uid`, never by name ([ADR-0029]). The
materializer is the *one* legitimate exception: `add_item` cannot set a uid, so
a scheduled chore and its materialized item can only be matched by name, which
is exactly what the dedupe does. That is matching, not addressing — it still
never passes a name to `update_item` or `remove_item`.

---

## Phase 5 — Deployment 🔴 **← current**

Server is the always-on laptop; the Pi is a kiosk client ([ADR-0023]). Much of
this is already true — the server *is* the dev instance — so "deployment" here is
mostly the kiosk and the backup story, not standing up a new box.

**The backup half is done. The kiosk half is waiting on hardware that does not
exist yet** — as of 2026-09-04 there is no Pi and no Fire tablet in the house.
Writing kiosk autostart files and screen-blanking config for an unknown OS
image would be guessing, and guessed config that has never booted is worse than
none: it looks finished. Those items stay unticked and unwritten.

- [x] **Scheduled backup of the `config/` volume** — no HA OS snapshots on
      Container ([ADR-0023]); `local_calendar`, every chore list and the label
      registry that *is* the roster all live in that one directory
- [x] Backup runs **inside the HA container**, so it needs no host cron and no
      Task Scheduler, and behaves the same whether the server is Windows or
      Linux. 03:30, well clear of the 00:05 chore work
- [x] Retention, and a guard against the silent failure that matters: an empty
      archive is discarded rather than counted, so a broken backup cannot age
      out the good ones
- [x] A failed run raises a persistent notification. A backup failing quietly
      for a month is the normal way this goes wrong
- [ ] Point the backups at a NAS — the household's eventual intent. Today they
      land on the server's own disk, which survives a bad config or a mistaken
      delete but **not** a dead drive. One line in `docker-compose.yml`
- [ ] Container `restart: unless-stopped` verified across a laptop reboot —
      it is set; nobody has rebooted
- [ ] Raspberry Pi: normal OS + Chromium kiosk, autostart, pointed at
      `http://<laptop>:8123/family-calendar`, idling on the Today view
      ([ADR-0020]) — **no Pi yet**
- [ ] Screen blanking / wake-on-touch on the Pi — **no Pi yet**
- [ ] **Test on a real Fire OS 7 tablet** — the first true check of
      [ADR-0003] — **no tablet yet**

**Exit criterion:** the calendar survives a laptop reboot and an HA image
upgrade untouched, and the wall Pi returns to the Today view on its own.
Neither half is met: the reboot has not been tried, and there is no Pi.

**Verified so far.** The backup script was run under busybox `sh` — the
constrained case, since the HA image is Alpine — against a config tree holding
a real `.ics`, a chore list and a label registry. It archived exactly those,
excluded the recorder database, the build output, logs and caches, pruned to
the newest N across repeated runs, exited non-zero with nothing left behind on
an empty `/config`, exited non-zero when `/backup` was not mounted, and four
consecutive failures cost zero good backups. The newest archive was then
extracted and every restored file matched the original by checksum — because a
backup nobody has restored is not a backup.

**Not verified:** that HA's `shell_command` finds the script and that the 03:30
trigger fires. Both need the same deploy Phase 4 does. After restarting the
server, this checks it end to end and prints what the script said:

```yaml
# Developer Tools → Actions → YAML mode
action: shell_command.backup_config
response_variable: result
```

---

## Phase 6 — iCloud sync ⏸ **deferred by the household**

**Opened 2026-09-04, investigated, and closed again without building
anything** — the household's call: *"we aren't worrying about cloud syncing at
this time, it's all local events, we will add cloud functionality later."*
Everything below stands; nothing is blocked.

**Do not start this because it is the next unticked phase.** It is deferred on
purpose, the same way [ADR-0016] was.

Per [ADR-0010]. `vdirsyncer` against `local_calendar`'s `.ics` → iCloud CalDAV.
Explicitly **not** via HA's `caldav` integration, which cannot propagate edits
or deletes.

- [x] Conflict resolution policy — asked at Phase 6 entry as [ADR-0016]
      requires. The household chose two-way sync and **the wall calendar wins**.
      Recorded as intent in [ADR-0031], *not* as a tested design — re-confirm it
      on contact with `vdirsyncer`.
- [x] Verify UIDs survive a round trip ([ADR-0009] pays off — it does, both for
      HA's own events and for externally-authored ones, across a reload)
- [ ] App-specific password handling
- [ ] **A sync must reload the config entry when it finishes** — see below.
      This is not optional and [ADR-0010] does not mention it.

**What the investigation found, and why it matters more than the checklist.**
`local_calendar` reads its `.ics` **once**, at setup, and every write
serializes its whole in-memory copy back over the file. Verified against real
HA in a throwaway container: an event written into the file by anything else is
invisible to HA, and HA's very next write **deletes it, silently**. An event
added on a phone would vanish the moment somebody touched the kitchen screen.

`POST /api/config/config_entries/entry/<id>/reload` makes HA pick the file up,
UIDs intact. So the shape is **sync, then reload, in the same run** — with a
residual race that a sync going through HA's *API* instead of the file would
not have. Full detail and evidence in [ADR-0031].

`local_todo` also persists as iCalendar (`VTODO`), so chores could sync to Apple
Reminders by the same route. Not planned; noted because it's nearly free.

**Exit criterion:** an event created on the wall panel appears on an iPhone, and
an event deleted on the iPhone disappears from the wall panel. Unchanged, and
not being pursued yet.

---

## Deliberately not doing

- **Two-way Google Calendar sync via HA's integration.** Impossible; create-only.
- **Supporting Android < 5.0.** Would force real legacy shims ([ADR-0015]).
  Older-but-supported devices get Firefox, not shims.
- **Internet exposure of the standalone page.** See [ADR-0007].
- **Cloud sync of any kind, for now.** iCloud, Google, anything. Explicit
  household decision on 2026-09-04 ([ADR-0031]): it is all local events until
  they ask otherwise. Phase 6 being unticked is not an invitation.
- **Letting anything but HA write `local_calendar`'s `.ics`.** HA reads it once
  and overwrites it wholesale; an external write is invisible and then deleted
  without a word ([ADR-0031]).
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
[ADR-0026]: DECISIONS.md#adr-0026
[ADR-0028]: DECISIONS.md#adr-0028
[ADR-0029]: DECISIONS.md#adr-0029
[ADR-0030]: DECISIONS.md#adr-0030
[ADR-0031]: DECISIONS.md#adr-0031
