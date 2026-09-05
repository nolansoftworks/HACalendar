# Architecture decisions

Append-only log. Don't rewrite history — supersede an entry with a new one and
mark the old `Superseded by ADR-NNNN`.

Every entry cites **Evidence**. Several of these contradict Home Assistant's
own documentation, which is stale in places. Where evidence is "read the
source," the docs were checked first and found wrong or silent.

---

## ADR-0001

**`local_calendar` is the source of truth. Not Google, not iCloud.**

Status: **Accepted** · 2026-07-09

HA's calendar entity API defines `CREATE_EVENT`, `UPDATE_EVENT`, and
`DELETE_EVENT`, but each integration chooses what to implement. Support is not
uniform:

| Backend | Read | Create | Update | Delete |
|---|:--:|:--:|:--:|:--:|
| `local_calendar` | ✅ | ✅ | ✅ | ✅ |
| Google Calendar | ✅ | ✅ | ❌ | ❌ |
| CalDAV / iCloud | ✅ | ✅ | ❌ | ❌ |

If Google or iCloud were the source of truth, **a user could add an event from
the tablet but never edit or delete one.** That is strictly worse than the
dry-erase board this replaces, so it is disqualifying.

**Consequences.** Phone sync is not free and is deferred ([ADR-0010]). Pointing
the app at a non-`local_calendar` entity compiles cleanly and fails at runtime.

**Evidence.** `local_calendar/calendar.py` sets
`CREATE_EVENT | DELETE_EVENT | UPDATE_EVENT`. `caldav/calendar.py` sets
`CREATE_EVENT` only. The `google` integration exposes only a
`google.create_event` action. The HA docs for these integrations do not state
any of this.

---

## ADR-0002

**One bundle, two mount points: `panel_custom` + a standalone page.**

Status: **Accepted** · 2026-07-09

HA's frontend `.browserslistrc` targets `last 7 years`, `not dead` for its
legacy build. That is a **sliding window** — every year another cohort of
browsers is evicted. HA 2024.5 broke Chrome 71; 2026.04 reportedly broke old
iOS browsers entirely. Affected users were told to downgrade HA.

A custom panel loads *inside* the HA frontend shell, so it inherits that
window. A family calendar cannot be one HA upgrade away from bricking on a
schedule we don't control.

So the same bundle is exposed twice:

1. **`panel_custom`** — full-viewport element inside HA. The wall touchscreen.
2. **`/local/hacalendar/index.html`** — loads only our bundle. HA's frontend
   never boots, so its browserslist stops being our problem. We own the floor.

**Consequences.** The standalone page needs its own auth ([ADR-0007]). Both
mount points must stay thin ([ADR-0005]).

**Evidence.** [`frontend/.browserslistrc`](https://github.com/home-assistant/frontend/blob/dev/.browserslistrc),
[frontend#20713](https://github.com/home-assistant/frontend/issues/20713),
[Old tablets / browsers / iOS](https://community.home-assistant.io/t/old-tablets-browsers-ios/931892).

---

## ADR-0003

**Compatibility floor is Chromium 87.**

Status: **Accepted** · 2026-07-09

Fire OS 7 ships Amazon's own Chromium WebView, reported across 7.3.x patch
levels as 87 → 94 → 104. Worst realistic case is **87** (Dec 2020).

`vite.config.ts` sets `build.target: "chrome87"`.

Chromium 87 gives ES2020, nearly all ES2021, Custom Elements v1, Shadow DOM,
CSS Grid, and custom properties. Lit 3 runs on it. **No source-level compromise
is required** — the compromise lives entirely in the build target.

**Consequences.** These are banned; they compile and then throw:

| Banned | Requires |
|---|---|
| `Array.prototype.at()` | Chrome 92 |
| `Object.hasOwn()` | Chrome 93 |
| `structuredClone()` | Chrome 98 |
| `:has()`, container queries | Chrome 105 |
| CSS nesting | Chrome 112 |
| `:is()`, `:where()` | Chrome 88 |

esbuild's `target` transpiles syntax, not built-ins. Enforcement is the grep in
`CLAUDE.md`, not the compiler. DevTools emulation cannot catch violations.

**Evidence.** [Fire tablet hybrid app FAQ](https://developer.amazon.com/docs/fire-tablets/web-hybrid-app-faq.html);
Fire OS 7.3.x WebView version reports on XDA.

---

## ADR-0004

**TypeScript + Lit + Vite. Not React.**

Status: **Accepted** · 2026-07-09

The `panel_custom` contract *is* a custom element, so Lit has no impedance
mismatch to pay for. HA's own frontend is Lit, so `hass` arriving as a property
update gives us reactivity for free. And this runs on a Pi driving a
touchscreen, where skipping a reconciler is worth real frames.

React would work, but we'd pay for it at the element boundary and in bundle
size, for no gain here.

**Consequences.** `useDefineForClassFields: false` is mandatory in
`tsconfig.json` — native class fields would shadow Lit's prototype accessors
and silently break reactivity. We use `static properties` rather than
decorators, which sidesteps decorator configuration entirely.

---

## ADR-0005

**All UI code depends on `HaClient`. Never on `hass`, never on `Connection`.**

Status: **Accepted** · 2026-07-09

`src/ha/client.ts` defines a three-method interface: `callWS`,
`subscribeMessage`, `callService`. Two ~15-line adapters satisfy it — one
wrapping HA's `hass` object, one wrapping a raw websocket `Connection`.

This seam is the entire reason [ADR-0002] is cheap rather than a fork.

**Consequences.** `panel.ts` and `standalone.ts` must contain no application
logic. Anything that lands there has to be written twice, and will drift.

The adapter is cached on a `WeakMap` keyed by `Connection`. HA replaces the
`hass` object on every state change; building a fresh adapter per render would
hand the UI a new `client` identity each time and tear down every websocket
subscription.

---

## ADR-0006

**Production is two devices: HA OS headless + a separate kiosk device.**

Status: **Superseded by [ADR-0023]** · 2026-07-09

> Superseded 2026-07-12. The server moved off the Pi and onto an existing
> always-on laptop; the Pi became a thin kiosk client instead of the server.
> The core *fact* below still holds — HA OS can't drive an attached display —
> but the chosen topology changed. See [ADR-0023]. Retained for the reasoning.

**Home Assistant OS only outputs a boot console on HDMI.** It has no desktop
and no browser. A Pi running HA OS with a touchscreen attached displays a login
prompt, forever. "Raspberry Pi running HA with a touchscreen" is not a
configuration that exists.

The alternatives were: run HA in Docker on Raspberry Pi OS (one device, but
loses Supervisor, the add-on store, and managed backups), or HA Supervised on
Debian (narrow, breaks on upgrade).

Chosen: **HA OS on the Pi, headless.** A second device drives the touchscreen
in Chromium kiosk mode. This keeps Supervisor and add-ons for the planned
cameras and automation, keeps the family-critical box boring and upgradeable,
and keeps camera decoding off the machine compositing a fullscreen browser.

**Consequences.** Two devices to maintain. The dev environment uses HA
*Container* ([ADR-0011]) and therefore has no add-on store — expected, not a
bug.

**Evidence.** [Native HDMI screens — home-assistant discussion #1668](https://github.com/orgs/home-assistant/discussions/1668).

---

## ADR-0007

**Standalone page authenticates with a long-lived token in `localStorage`.**

Status: **Accepted, with reservations** · 2026-07-09

The panel gets auth from HA's frontend. The standalone page ([ADR-0002]) has
none, and implementing HA's IndieAuth flow is disproportionate for a LAN
appliance.

**This is a real security tradeoff, taken deliberately.** The token is full HA
API access, sitting in `localStorage` on a child's tablet. Anyone holding the
tablet holds the token.

Acceptable because these devices are LAN-only and physically in the house.

**Consequences. Never expose `/local/hacalendar/index.html` through a reverse
proxy or to the internet without real auth in front of it.** If remote access
is ever wanted, this ADR must be superseded first.

---

## ADR-0008

**Recurring chores are RRULE calendar events materialized into `local_todo`.**

Status: **Accepted** · 2026-07-09

`todo` has **no recurrence support** — its feature flags cover create, update,
delete, move, due date, and description, and nothing else. But "trash every
Tuesday" is a core requirement.

`local_calendar` *does* support real `RRULE` recurrence. So a recurring chore
is stored as a recurring calendar event, and a nightly automation materializes
today's instances into the relevant kid's `local_todo` list.

This fits the primitives instead of fighting them, and reuses the recurrence
engine we already depend on.

**Consequences.** Completion state lives on the todo item, not the event. The
mapping is settled in [ADR-0012]; rollover and idempotency in [ADR-0013].

**Evidence.** `todo/__init__.py` — `TodoListEntityFeature` has no recurrence
flag.

---

## ADR-0009

**Events stay RFC 5545-clean.**

Status: **Accepted** · 2026-07-09

Stable UIDs, standard fields, nothing custom stuffed into `description` or
`summary`.

`local_calendar` persists a real `.ics`. iCloud speaks CalDAV. So the future
sync ([ADR-0010]) is plausibly a `vdirsyncer` job against that file — *if* the
data model is still standards-compliant when we get there.

This costs nothing today. Violating it converts a weekend of sync work into a
data migration.

---

## ADR-0010

**Google/Apple calendar sync is post-MVP.**

Status: **Accepted** · 2026-07-09

Explicit user decision. Ship the wall calendar and chores first.

When it happens, it will **not** go through HA's `caldav` integration, which
implements create only ([ADR-0001]) and so could never propagate an edit or a
delete. The path is `vdirsyncer` against `local_calendar`'s `.ics`, targeting
iCloud CalDAV directly.

iCloud is the primary sync target; the household is Apple-centric.

---

## ADR-0011

**Development uses HA Container in Docker on a laptop.**

Status: **Accepted; scope widened by [ADR-0023]** · 2026-07-09

`dev/docker-compose.yml` runs `ghcr.io/home-assistant/home-assistant:stable`
with `dev/config` mounted. `vite build` writes straight into
`dev/config/www/hacalendar/`, which HA serves at `/local/hacalendar/`.

HA Container has **no Supervisor and no add-on store**. Neither is needed for
the calendar.

> Updated 2026-07-12. This Docker-Container setup is now **also production**
> ([ADR-0023]), not just dev — the same always-on laptop serves the household.
> The "no add-on store" note therefore stops being a dev-only quirk and becomes
> a permanent architectural fact: add-on-style software (e.g. Frigate for
> cameras) must run as its own container alongside HA, not from within it.

---

---

## ADR-0012

**Chore assignment is one `calendar.chores_<kid>` + `todo.chores_<kid>` pair per child.**

Status: **Accepted** · 2026-07-09 · resolves an open question from [ADR-0008]

The websocket event schema accepts exactly six fields: `start`, `end`,
`summary`, `description`, `location`, `rrule`. **There is no `CATEGORIES` and no
`ATTENDEE`.** So an event cannot carry "this belongs to Emma" through HA's API.

The alternative — encoding the child in `summary` (`"Emma: trash"`) or in
`description` — means parsing structured data back out of a free-text field.
That is exactly the RFC 5545 corruption [ADR-0009] forbids, and it would poison
the future iCloud sync.

Therefore assignment is carried by **entity naming**. A recurring chore lives on
`calendar.chores_emma`; its materialized items land on `todo.chores_emma`. The
automation loops over pairs. No parsing, nothing custom in the event body.

This is not a preference. It is the only option the API leaves open.

**Consequences.** N children = 2N entities. Chore calendars are separate from
`calendar.family`, so they don't clutter the month view (show them behind a
toggle). Adding a child is a config-flow click, twice.

**Evidence.** `WEBSOCKET_EVENT_SCHEMA` in `calendar/__init__.py`.

---

## ADR-0013

**Chores roll over until completed. Original due date is never bumped.**

Status: **Accepted** · 2026-07-09 · user decision

An uncompleted chore persists. It is never auto-removed at midnight.

This collides with recurrence: "trash every Tuesday", never done, would
materialize a second item the following Tuesday, and a third after that.

**Resolution.** Materialization is idempotent. Before adding today's instance,
check `todo.get_items` (defaults to `status: needs_action`) and **skip if an
incomplete item with the same name already exists.** A chore never done stays as
exactly *one* item, whose original due date recedes further into the past.

**That growing overdue-ness is the accountability signal.** Do not bump the due
date to "refresh" the item — that erases the miss.

**Consequences.** Chore names must be unique within a list. This is not our
convention: **`todo.update_item` addresses items by name (`item:`), and
`todo.add_item` cannot set a UID.** Two same-named items in one list are
literally unaddressable through HA's API.

Because a missed chore is one persistent item rather than N, the logbook records
completions only — "missed 3 weeks running" is read off the due date, not from
history.

Completed items accumulate in `local_todo` until `todo.remove_completed_items`
is called. Sweep them periodically; [ADR-0014]'s logbook is the durable record,
not the todo list. Dedupe filters on `needs_action`, so sweeping cannot cause a
duplicate.

**Evidence.** `todo/services.yaml` — `get_items.status` filter defaults to
`needs_action` and `supports_response`; `add_item` has no `uid` field;
`update_item.item` is name-based. The whole materialization is therefore a plain
automation with `response_variable`. No custom integration needed.

---

## ADR-0014

**Completion asks "who did this?" and logs it via `logbook.log`. This is attribution, not authentication.**

Status: **Accepted** · 2026-07-09 · user decision

The wall tablet is a shared kiosk with no login. Anyone can check off anything.

On check-off the app shows a large-target picker — *who did this?* — then calls
`todo.update_item(status: completed)` **and** `logbook.log(name: <person>,
message: "completed <chore>", entity_id: todo.chores_<kid>)`.

**Assignment and completion are deliberately separate.** A chore on
`todo.chores_emma` is Emma's. If Jake does it, the logbook says Jake completed
Emma's chore. Both facts are true and both are worth keeping.

Recorder persists the logbook, so "who did their chores this week" is answerable
whenever we build a UI for it. The data accumulates from day one; the history
*view* is post-MVP. Cost today is a few lines at one call site.

**Consequences.** The picker captures intent and can be lied to. That is
acceptable and expected for a family appliance; do not mistake it for auth
([ADR-0007] governs actual access).

A chore completed through HA's **own** todo card, bypassing this app, gets no
attribution and no logbook entry. Unavoidable.

The person roster is app config, not HA state — parents appear in the picker but
own no chore list, so the roster cannot be derived from `todo.chores_*` entities.

**Evidence.** `logbook.log` accepts `name`, `message`, `entity_id`, `domain`,
and is recorder-backed.

---

## ADR-0015

**Browser support is a policy, not a device list.**

Status: **Accepted** · 2026-07-09

- Chromium **87+** → supported ([ADR-0003]).
- Anything older → install **Firefox**, which ships its own engine and updates
  independently of the frozen system WebView. Firefox for Android supports
  5.0+, which covers essentially any Android tablet in the house.
- Android **< 5.0** → **out of scope.** Supporting it requires genuine legacy
  shims, which is explicitly not wanted.

This resolves the "unknown Android tablet" question without knowing the model.
When a device turns up it either clears the bar or gets Firefox.

**Consequences.** Firefox is not usable with Fully Kiosk (which drives the
system WebView). A hallway "check the calendar" tablet running plain Firefox is
fine; a locked-down kiosk on an ancient device is not.

---

## ADR-0016

**Sync conflict policy is deferred to Phase 6 entry, deliberately.**

Status: **Accepted** · 2026-07-09 · supersedes a note in `docs/PLAN.md`

`PLAN.md` originally said "decide before writing code." Correct, but *before
writing code* is not *now*. Phase 6 is five phases out, and any policy chosen
today would be a guess about failure modes of a tool (`vdirsyncer`) we have not
run, against an iCloud account we have not connected.

We checked what Phases 1–5 owe Phase 6. It is exactly one thing: **stable,
preserved UIDs**, already guaranteed by [ADR-0009]. Nothing else leaks backward.

Deferring is therefore safe, and deciding now would manufacture a fake decision
we'd overturn on contact with reality.

**Consequences.** Phase 6 is blocked on nothing and may begin whenever wanted.
Do not let a future agent "resolve" this by inventing a policy.

---

## ADR-0017

**A person *is* a calendar entity. The single unified calendar is a view, not a store.**

Status: **Accepted** · 2026-07-09

Requirement: one calendar to look at, color-coded and filterable by person.

The event schema has six fields — `start`, `end`, `summary`, `description`,
`location`, `rrule`. **No `ATTENDEE`, no `CATEGORIES`.** There is nowhere to put
"this is Emma's appointment."

Encoding the person into `summary` (`"Emma: Dentist"`) and parsing it back was
rejected: filtering would depend on string-parsing user-typed text (one typo and
the event silently leaves the filter), it violates [ADR-0009], and it breaks the
Phase 6 iCloud round trip.

So: **`calendar.family` plus one `calendar.<person>` per household member**,
rendered as a *single* overlay — one grid, one color per calendar, per-person
filter toggles. The household never sees an entity. A "who is this for?" picker
at event creation decides which entity receives the write.

Same forcing function as [ADR-0012]. Person is expressed by calendar membership
because the API offers no other place to express it. This also maps 1:1 onto
iCloud calendars for [ADR-0010].

**Consequences.** An event genuinely shared by two people goes on
`calendar.family`, not on both. Reassigning an event means moving it between
calendars — a delete plus a create, and therefore **a new UID**. Do not build a
"change owner" affordance that silently breaks UID stability without saying so.

**Evidence.** `WEBSOCKET_EVENT_SCHEMA` in `calendar/__init__.py`.

---

## ADR-0018

**One "who?" picker, three uses. It is intent, never identity.**

Status: **Accepted** · 2026-07-09 · user decision

The wall tablet is a shared kiosk with no login, and explicitly **not
profile-based**. Rather than infer a person, the app asks:

| Moment | Question | Effect |
|---|---|---|
| Creating an event | who is this for? | selects target `calendar.<person>` ([ADR-0017]) |
| Adding a task | who's adding this? | selects the target chore list |
| ~~Completing a chore~~ | ~~who did this?~~ | **dropped 2026-09-04** — see below |

> **The third call site is gone.** Asking "who did this?" on check-off was
> built and then removed the same day, at the household's request: the chore
> already sits on somebody's list, so the question answered itself while
> costing a child an extra tap on the one interaction they perform most.
> Completion is still written to the logbook against the list owner's roster
> id, so [ADR-0014]'s history survives intact — we stopped asking, not
> recording. The cost is that a sibling doing someone else's chore is now
> credited to the owner; the household judged the extra tap the worse trade,
> and the picker can come back if that ever bites.

One component, one roster ([ADR-0021]), three call sites.

**Consequences.** Anyone can pick anyone — siblings will assign each other
chores as a joke. Accepted; this is a family appliance, not an access-control
system. Do not mistake the picker for auth; [ADR-0007] governs actual access.

Assignment and completion stay separate: a chore on `todo.chores_emma` is
Emma's, and the logbook records that Jake completed it.

---

## ADR-0019

**Kids add their own tasks. Duplicate names must be refused, kindly.**

Status: **Accepted** · 2026-07-09 · user decision

From the original brief: kids should *add* and check off tasks, not just check
them off.

The "who's adding this?" picker ([ADR-0018]) routes the new item to that
person's list. Not profile-based; a kid picks their own name.

**This has a sharp edge.** `todo.update_item` addresses items **by name** and
`todo.add_item` cannot set a UID ([ADR-0013]). A task whose name duplicates an
existing incomplete item on the same list makes **both items unaddressable**.

Therefore adding a duplicate name must be caught in the UI and refused with a
friendly message ("you already have that one"), never silently written. This is
data-integrity work, not polish.

---

## ADR-0020

**The wall display defaults to Today: agenda plus every kid's chore list.**

Status: **Superseded by [ADR-0027]** · 2026-07-09 · user decision

> Superseded 2026-09-03 after the household named a concrete reference product.
> The instinct — the idle screen should answer "what is happening and who owes
> what" from across the kitchen — survives intact. What changed is its form: a
> **rolling multi-day time grid** rather than a single-day agenda, with chores
> reached from a left rail instead of stacked beside the agenda. See
> [ADR-0027].

Idle state shows today's events alongside each child's chores — the information
a family needs at a glance from across the kitchen.

The month grid remains, one tap away. It is what the dry-erase board was, and
still answers "what's happening on the 14th?"

**Consequences.** Month view is built first ([Phase 1]) because it exercises the
websocket spine hardest. The Today view is the *default*, but not the first
thing built. Do not reorder the phases on the assumption that default == first.

---

## ADR-0021

**The person roster is app config, not derived from entities.**

Status: **Accepted** · 2026-07-09 · storage changed by [ADR-0026]

> The reasoning below still holds: the roster cannot be derived from
> `todo.chores_*` entities because parents own no chore list, and `id` must be
> permanent because the logbook records it. Only the **storage** changed — the
> roster now lives in HA's label registry rather than a `people.json` file, so
> a household can edit it in the app instead of on the server. See [ADR-0026].
> The `Person` shape below is still what the code uses.

Parents appear in the picker ([ADR-0018]) but own no chore list, so the roster
**cannot** be derived from `todo.chores_*` entities. It is app config, not HA
state.

```json
{
  "weekStartsOn": 0,
  "people": [
    { "id": "emma", "name": "Emma", "color": "#e8590c",
      "choreList": "todo.chores_emma", "calendar": "calendar.emma" },
    { "id": "mom",  "name": "Mom",  "color": "#5f3dc4",
      "calendar": "calendar.mom" }
  ]
}
```

Served from `/local/hacalendar/people.json`, same origin as both mount points.

`id` is stable and is what gets written to `logbook.log` — **never the display
name.** Renaming "Emma" must not orphan her history. `choreList` and `calendar`
are both optional. `color` drives event chips and chore accents.

`weekStartsOn` is `0` (Sunday) per user decision. It lives here rather than as a
constant so the grid isn't re-hardcoded.

---

## ADR-0022

**Sweep completed chores at 00:05, immediately before materialization.**

Status: **Accepted** · 2026-07-09

`todo.remove_completed_items` accepts **no filter** — it removes *every*
completed item on the list. Running it during the day would erase a chore a
child checked off minutes earlier, before anyone saw the checkmark.

At 00:05 everything completed belongs to yesterday. Sweep, then materialize
today ([Phase 4]).

Incomplete items are untouched, so rollover ([ADR-0013]) is unaffected, and
dedupe inspects only `needs_action`, so the sweep can never cause a duplicate.

The logbook ([ADR-0014]) is the durable record. The todo list is a working
surface.

---

## ADR-0023

**The server is an always-on laptop running HA Container. The Pi and tablets are thin browser clients.**

Status: **Accepted** · 2026-07-12 · supersedes [ADR-0006], widens [ADR-0011]

HA is client–server. The server holds all state and logic; every display — the
wall touchscreen, tablets, phones — is just a browser loading the dashboard the
server serves. Nothing but the server needs to be powerful or trusted.

[ADR-0006] put the server on a Pi (HA OS, headless) with a *separate* kiosk
device for the screen, because HA OS can't drive an attached display. The user
already runs an **always-on laptop configured never to sleep**, which is a
strictly better server than a Pi: more CPU for camera decoding, already
provisioned, already reliable.

So the topology is:

| Role | Device |
|---|---|
| **Server** | the always-on laptop — HA Container in Docker ([ADR-0011]) |
| **Wall touchscreen** | Raspberry Pi running a normal OS + Chromium kiosk, pointed at the laptop |
| **Tablets / phones** | browsers, pointed at the laptop |

This is cleaner than [ADR-0006]: the Pi does the one thing a Pi is good at —
fullscreen Chromium — instead of being a headless server that then needs a
second device bolted on. Same device count, one fewer awkward constraint. It
also keeps camera decoding on the laptop and off the box compositing the
browser, which was a goal of [ADR-0006] and still holds.

**The always-on concern is resolved, not ignored.** A Windows laptop is normally
a poor 24/7 server (sleep, forced-reboot updates, Docker Desktop wanting a login
session). This one is already configured against sleep and runs continuously, so
the standard objection doesn't apply. If that ever changes, this ADR is at risk
— the whole house depends on that laptop staying up.

**Consequences.**

- Production has **no add-on store** ([ADR-0011]). Add-on-style software —
  Frigate (camera NVR/object detection) is the common one — runs as its own
  Docker container beside HA, wired via config, not installed through HA.
- **Backups are manual.** HA OS gives one-click snapshots; Docker does not. Back
  up the `config/` volume on a schedule. This is the biggest thing lost versus
  [ADR-0006], and it matters because `local_calendar` and every chore live in
  that volume ([ADR-0001], [ADR-0009]).
- **Migration stays open.** HA's backup/restore moves the entire instance to new
  hardware in one file. Starting on the laptop commits to nothing; a move to a
  Pi/mini-PC on HA OS later is a restore, not a rebuild.
- The `dev/` directory is now a misnomer — it's the real config. Left as-is for
  now to avoid churn; a future rename to `server/` or `ha/` is reasonable.
- The whole house is one laptop's uptime. Accepted, given it's a real 24/7
  server. Revisit if it ever becomes a daily-driver machine again.

---

## ADR-0024

**Calendar websocket field names are asymmetric: reads use `start`/`end`, writes use `dtstart`/`dtend`.**

Status: **Accepted** · 2026-09-03 · corrects a claim in [ADR-0009]'s neighbourhood and in `CLAUDE.md`

**Evidence.** Live round-trip against HA 2026.7.2 on 2026-09-03, driving the
websocket directly (no client library, so this is the wire protocol itself):

- `calendar/event/subscribe` **returns** events keyed `start` / `end`.
- `calendar/event/create` and `calendar/event/update` **reject** those keys:

  ```
  invalid_format: extra keys not allowed @ data['event']['start']
                  required key not provided @ data['event']['dtstart']
  ```

- The same call with `dtstart` / `dtend` succeeds. Verified for create, update,
  update-with-`recurrence_range: THISANDFUTURE`, and single-instance delete.

**What we believed before.** That the split was *service vs. websocket* — the
`calendar.create_event` service taking `dtstart`/`dtend` and the websocket
taking `start`/`end` throughout. That was wrong. It is a **read vs. write**
split on one API, and believing otherwise made `createEvent()` and
`updateEvent()` fail at runtime with no compile-time signal. Both were shipped
broken and nobody noticed, because nothing had ever called them.

**Decision.** App code speaks `start`/`end` exclusively. `toWireEvent()` in
`src/ha/calendar.ts` is the single translation point to `dtstart`/`dtend`, and
the only place those names may appear.

**Also observed, same session.** HA **omits** empty event fields rather than
sending `null`. An all-day event with no description returns exactly
`{start, end, summary, uid, all_day}`. `description`, `location`,
`recurrence_id` and `rrule` are therefore optional in `HaCalendarEvent`, not
nullable — a `!== null` guard wrongly passes on `undefined`.

**Consequence.** This is the concrete payoff of the rule in `CLAUDE.md` that a
typecheck and a build are not evidence. Phase 2 is entirely writes; had this
not been caught here it would have surfaced as "create silently does nothing"
against a touchscreen, with a child watching.

---

## ADR-0025

**The household roster is operator config, served from a directory the build never touches. It is not in this repo.**

Status: **Superseded by [ADR-0026]** · 2026-09-03 · refines [ADR-0021] · user decision

> Superseded the same day. The conclusion — a household's members are their
> config and do not belong in this repo — was right and survives. The mechanism
> was wrong: it still meant editing a JSON file on the server to add a child,
> which is not something the people using a kitchen calendar will ever do. See
> [ADR-0026]. Retained for the reasoning about build artifacts, which is why
> the roster is not stored beside the bundle in either design.

This project is meant to be forked and pointed at someone else's Home
Assistant. That makes a specific household's members **their** configuration,
not our source code. Commit 98c2abe got this wrong: it put five real names and
their calendar entities into the repository, so every fork would have shipped
with another family's roster.

**Decision.** The roster is read from

```
config/www/hacalendar-config/people.json   ->  /local/hacalendar-config/people.json
```

and `public/people.json` is git-ignored, existing only as a convenience for
`vite dev`. `public/people.example.json` is committed and generic.

**Why a sibling directory rather than beside the bundle.** The build emits into
`config/www/hacalendar/` with Vite's `emptyOutDir`, which deletes that folder's
contents on every build. A roster kept there would be destroyed by the next
deploy — silently, and only noticed when the wall calendar lost everyone's
colors. A sibling directory is outside the build's blast radius, survives
upgrades, and is already covered by `.gitignore`'s `dev/config/*` rule.

**Consequences.**

- A fresh clone renders the shared calendar only, and says so: the grid shows
  a one-line hint naming the file to create. An unconfigured install explains
  itself rather than looking broken.
- Changing the roster no longer needs a rebuild or a commit — edit the file and
  reload. This also removes the awkwardness noted in Phase 1.5, where a roster
  change was a deploy.
- The `id` permanence rule from [ADR-0021] still holds, and now matters more:
  it is per-household and nobody else's migration problem.
- Still household-specific and worth genericising later: `dev/docker-compose.yml`
  names the Compose project and container `nolanhaus`, and
  `dev/config/configuration.yaml` sets `homeassistant.name`. Harmless to a
  forker — HA's onboarding overrides the name in `.storage` — but they are not
  neutral defaults.

**Evidence.** `emptyOutDir: true` in `vite.config.ts`; `outDir` is
`dev/config/www/hacalendar`. `.gitignore` already excludes `dev/config/*`.

---

## ADR-0026

**A person is a Home Assistant label. Their calendar is the entity wearing it. The roster is managed in the app.**

Status: **Accepted** · 2026-09-03 · supersedes [ADR-0025], changes the storage in [ADR-0021] · user decision

The requirement: *"I would like that to be an option to add a new profile
anytime in the UI, choose their color, and their name."* Plus the standing
constraint that this repo is meant to be forked and run against someone else's
Home Assistant, so a household's members can never be repo content.

Both previous designs failed that. `people.json` in the repo shipped one
family's names to every fork ([ADR-0025] fixed that); `people.json` on the
server still meant SSH-ing in to add a child, which nobody using a kitchen
calendar will do.

**Decision.** The roster lives in HA's own registries:

| Concept | Stored as |
|---|---|
| A person | a label in the **label registry** — `name` + `color` |
| Their identity | `label_id`, derived once from the name |
| Their calendar | the `calendar.*` entity carrying that label |
| Someone who isn't a person | a label with no calendar — ignored |

Adding someone from Settings creates the label, drives the `local_calendar`
config flow to create their calendar, and links the two. Removing someone
detaches and deletes the label; deleting the underlying calendar is opt-in and
separately confirmed, because it destroys real events.

**Evidence** (live round trip, HA 2026.7.2, 2026-09-03):

- A label's `color` accepts an **arbitrary hex string**, not only HA's named
  palette — so per-person colors need no separate store.
- **`label_id` is stable across a rename.** Renaming the label "ZZLink" to
  "ZZLink Renamed" left `label_id` as `zzlink`. This is what makes a label
  usable as [ADR-0021]'s permanent id: it is what chore completions get logged
  against ([ADR-0014]), so renaming a child must not orphan their history.
- Labels attach to `calendar.*` entities via `config/entity_registry/update`,
  and the whole roster reads in one round trip from two registry lists.
- All of it is writable from the browser with the session the app already has.

**Why this over `frontend/set_user_data`**, which also works and was tested:
that store is **per HA user**. A household where one adult has their own HA
login would see two different rosters. Registries are shared.

**Consequences.**

- No roster file, anywhere. Nothing to deploy, nothing to gitignore, and a
  fresh clone works with zero setup — it renders the shared calendar and points
  at Settings.
- People appear in HA's own Settings → Labels, and can be edited there too.
  Accepted: it is HA-native, and a household that never opens HA settings will
  never notice.
- `HaClient` gained `callApi` ([ADR-0005] still holds — UI code depends on the
  seam, not on `hass`). It exists for exactly one thing: config entry flows
  have no websocket equivalent.
- **The one REST call is CORS-sensitive in dev.** Served from HA it is
  same-origin and fine; from `vite dev` the page origin must appear in
  `http.cors_allowed_origins`. `http://127.0.0.1:5173` and
  `http://localhost:5173` are different origins to a browser, and only the
  latter is configured. Symptom is `Failed to fetch` when adding a person.
- A label on two calendars resolves to the first deterministically, rather than
  producing a duplicate person.
- `weekStartsOn` is not in the registries. It is a display preference and stays
  a separate concern.

---

## ADR-0027

**This is a family calendar appliance that runs on Home Assistant, not an HA tablet showing a calendar. The app is the frame; HA is a destination.**

Status: **Accepted** · 2026-09-03 · supersedes [ADR-0020] · user decision

Stated directly by the household: *"I want a family calendar appliance that
happens to run on HA… the calendar is the number 1 app that runs… eventually
I'll have an HA button that takes me to my HA dashboard… but then come back to
the calendar app as that will be the primary thing running."* With a Skylight
Calendar named as the reference for the layout.

This resolves a confusion that had already bitten: HA's `default_config` mounts
eighteen panels, and the household could not tell HA's own `/calendar` from
ours at `/family-calendar`. The answer is not better labelling. It is that this
app owns the whole screen.

**Decision — the shell.**

| Region | Contents |
|---|---|
| Left rail | Calendar (active), Chores, Lists, then Settings pinned to the bottom. A Home Assistant link lands here when there is an HA dashboard worth linking to |
| Header | Household name + live clock, date navigation, view switch |
| Person strip | One chip per person, colored, tapping filters the grid. Calendar only — the chore board has its own column headers |
| Main | The calendar view |
| Corner | Floating **+** to add an event |

The household name comes from HA's own instance name (`get_config` →
`location_name`), so it needs no configuration of ours.

**Decision — the default view is a multi-day time grid**: day columns, an
hour axis, events as blocks positioned and sized by their real times, tinted
with their owner's color. All-day items sit in a band above the grid. The month
grid becomes the *secondary* view, one tap away — it is still what the
dry-erase board was, and still answers "what's happening on the 14th?".

> Amended by [ADR-0028]: this began as a rolling five days from today, copying
> the reference screenshot. It is now a real Sunday-to-Saturday week, so
> "this week" means the same thing to everyone in the house.

**Consequences.**

- `app-shell.ts` owns the roster, the subscriptions, the filters and the edit
  dialog. The views are presentational and take events as a property, so they
  cannot drift apart or double-subscribe. This was a real refactor of
  `month-view.ts`, which previously owned all of it.
- The subscription window now depends on the active view — five days versus six
  weeks — so switching views resubscribes.
- **The hour window always contains the current hour** when today is on screen.
  Without that the now-line disappears every evening after 9pm, which on a wall
  display reads as a frozen screen.
- **The grid auto-scrolls to now on mount.** Opening at 7am while the day
  happens at 5pm makes the default screen useless.
- Tapping an hour slot creates a *timed* event at that hour; tapping a month
  cell still creates an all-day one. Tapping 4pm and getting an all-day event
  would be wrong.
- Chores and Lists appear in the rail but are visibly disabled until Phases 3
  and beyond build them. Showing the intended shape is worth more than hiding
  it, but they must never look tappable-and-broken.
- The kiosk should point at the **standalone** page, which has no HA chrome at
  all. The panel remains for use from inside HA.

**Deliberately not decided here.** Whether to hide HA's own sidebar panels.
That is the operator's instance, not ours to reconfigure, and the standalone
page already sidesteps it.

---

## ADR-0028

**There is no built-in shared calendar. Every calendar comes from the roster, and the week view is a real Sunday-to-Saturday week.**

Status: **Accepted** · 2026-09-04 · amends [ADR-0017] and [ADR-0027] · user decision

Two corrections from seeing it running.

**1. `calendar.family` was hardcoded.** The shell always added a "Family"
target with a fixed entity id, a fixed label and a fixed colour, on top of
whatever the roster said. The household spotted it immediately — *"remove the
family events, it looks like that's hardcoded in"* — and they were right. It
also contradicted [ADR-0026]: a fork should carry no assumption about what a
particular household's entities are called, and `calendar.family` is exactly
such an assumption.

Now every calendar shown comes from the roster. A household that wants a shared
calendar adds one in Settings like any other entry — name it "Family", give it
a colour, adopt the existing `calendar.family` if they have one. The concept
survives; the special case does not.

[ADR-0017] still holds: a person *is* a calendar entity, because the event
schema has nowhere to put "whose is this". What changes is that "the shared
one" is no longer privileged in code.

**Consequence.** With an empty roster there is nowhere to write an event, so
tapping a day or the **+** opens Settings rather than a form that cannot save.

**2. Five rolling days became seven, Sunday to Saturday.** [ADR-0027] chose a
rolling five-day window from the reference screenshot. In use, a wall calendar
should answer "what does *this week* look like" the same way for everyone in
the house, and a window that silently reanchors each day does not. The view is
now `startOfWeek(cursor, weekStartsOn)` plus seven days, paging by whole weeks,
with `weekStartsOn` already on the roster so a Monday-start household gets
Monday–Sunday.

**3. The person strip carries counts**, scoped to whatever is on screen: how
many events that person has in view, how many are already past, and how many
are today. The subscription window *is* the view window, so "total" always
means "in what you are looking at" without any extra fetching. Counts ignore
the filter toggles — hiding someone must not zero their numbers, or the strip
stops explaining why you hid them.

This is the shape the chore progress bars took in Phase 3 — the reference shows
`2/2` per person — but they took it on the **chore board's own column headers**,
not here. The strip briefly rendered on the board too and produced two rows of
the same names, one above the other; it is calendar-only now, and carries just
a "2 chores" badge for what somebody owes today.

---

## ADR-0029

**Todo items are addressed by `uid`, never by name. Duplicate names are allowed.**

Status: **Accepted** · 2026-09-04 · corrects [ADR-0019] and gotcha 7

**Evidence** — live probe against HA 2026.7.2, 2026-09-04, on a throwaway
`local_todo` list:

- `todo/item/list` returns `{summary, uid, status, due}` per item. Items **have
  uids**.
- `todo.update_item` and `todo.remove_item` both accept that uid in the `item:`
  field. With two items named "Dishes", completing one **by uid** left the other
  at `needs_action`.
- Calling `update_item` with the **name** while a duplicate existed was accepted
  with no error and **changed nothing**. Silent, not loud.
- `local_todo` is created through the same scriptable config flow as
  `local_calendar` ([ADR-0026]), so per-kid lists need no clicking either.
- `todo/item/subscribe` exists and pushes the full list on every change, exactly
  like `calendar/event/subscribe`.
- `todo.remove_completed_items` really does take no filter — it swept every
  completed item across the list. [ADR-0022] stands.

**What this overturns.** [ADR-0019] and gotcha 7 both rested on "items are
addressed by name, so two same-named items are unaddressable", and concluded
that refusing duplicates was *data integrity, not polish*. That premise is
false. The conclusion therefore does not follow.

**Decision.**

- Address every todo item by `uid`. A name must never be passed to
  `update_item` or `remove_item`; that is the actual failure mode, and it fails
  silently.
- **Do not block duplicate names.** A child adding "Dishes" when "Dishes"
  already exists is not corrupting anything. The UI may point out the existing
  one — two identical rows are confusing to read — but it must not refuse a
  legitimate add on integrity grounds that do not exist.
- `todo.remove_item` gives us single-item removal, so nothing is forced to wait
  for the nightly sweep to tidy one row.

**Why this matters beyond tidiness.** The old rule would have had Phase 3 build
a refusal dialog for a problem that does not exist, in an app whose users are
children. That is a worse product *and* more code, justified by a constraint
nobody had tested.

---

## ADR-0030

**A person's chore schedule is a second calendar, told apart by a shared label — not by its entity id.**

Status: **Accepted** · 2026-09-04 · implements [ADR-0012] under [ADR-0026]

[ADR-0012] settled that a repeating chore lives on `calendar.chores_<kid>` and
materializes onto `todo.chores_<kid>`, because HA's event schema has nowhere to
record who a chore belongs to. That is still right. What it could not
anticipate is [ADR-0026]: the roster stopped being a file and became HA's label
registry, and a person became "the label wearing a calendar".

Which breaks the naming scheme. Once a person owns **two** calendars, both
wearing their label, something has to say which is which — and it cannot be the
entity id. Ids are renameable from HA's own settings, and a household that
renames `calendar.emma_chores` would silently turn their daughter's chore
schedule into her personal calendar, moving every appointment she has.

**Decision.** The schedule calendar wears a **second, shared label — "Chore
schedule"**. A person's own calendar is the one *without* it. The label is:

- created on demand, the first time anybody in the house schedules a repeat, so
  a household of one-off chores never sees it;
- matched by **name**, never by `label_id` — HA generates the id, and a
  household that already had a label of that name pushes ours to
  `chore_schedule_2`;
- itself excluded from the roster, or it would arrive as a sixth family member
  wearing five calendars.

The nightly automation resolves the same label the same way
(`label_id('Chore schedule')`), then pairs each schedule calendar with its
owner's chore list through the *other* label on it. So the household detail
lives entirely in HA's registries, and the automation file names nobody
([ADR-0028]).

**Consequences.**

- Three entities per person once they use repeats, two before. That is one more
  than [ADR-0012] predicted, and it buys rename-safety.
- The schedule calendar is deliberately **not** rendered in the week or month
  grid. A chore rule is not an appointment, and "Feed the dog" drawn seven
  times would bury the day it is on. The chore board shows the rules instead,
  one row per rule rather than per instance.
- Deleting a person detaches or deletes all three.
- A rule deleted with no `recurrence_id` removes the whole series, which is what
  "stop it repeating" means. Items already materialized stay put — cancelling a
  rule is not a claim that today's chore was done.

**Evidence** — live against HA 2026.7.2, 2026-09-04. Five schedule calendars
provisioned through the config-flow REST API and labelled; `fetchRoster` kept
every person's own calendar and picked up the schedule one separately, in both
registry orders. Deleting one person's schedule calendar and then scheduling a
repeat from the chore board recreated it, labelled it, and left her own
calendar alone. `label_entities('Chore schedule')` returned exactly the five,
and pairing through the second label produced the five chore lists.

---

[ADR-0001]: #adr-0001
[ADR-0002]: #adr-0002
[ADR-0003]: #adr-0003
[ADR-0005]: #adr-0005
[ADR-0006]: #adr-0006
[ADR-0007]: #adr-0007
[ADR-0008]: #adr-0008
[ADR-0009]: #adr-0009
[ADR-0010]: #adr-0010
[ADR-0011]: #adr-0011
[ADR-0012]: #adr-0012
[ADR-0013]: #adr-0013
[ADR-0014]: #adr-0014
[ADR-0017]: #adr-0017
[ADR-0018]: #adr-0018
[ADR-0021]: #adr-0021
[ADR-0023]: #adr-0023
[ADR-0024]: #adr-0024
[ADR-0025]: #adr-0025
[ADR-0026]: #adr-0026
[ADR-0027]: #adr-0027
[ADR-0028]: #adr-0028
[ADR-0029]: #adr-0029
[ADR-0030]: #adr-0030
[Phase 1]: PLAN.md#phase-1--live-month-view--current
[Phase 4]: PLAN.md#phase-4--recurring-chores
