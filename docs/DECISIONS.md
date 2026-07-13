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
| Adding a task | who's adding this? | selects target `todo.chores_<person>` |
| Completing a chore | who did this? | `logbook.log` attribution ([ADR-0014]) |

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

Status: **Accepted** · 2026-07-09 · user decision

Idle state shows today's events alongside each child's chores — the information
a family needs at a glance from across the kitchen.

The month grid remains, one tap away. It is what the dry-erase board was, and
still answers "what's happening on the 14th?"

**Consequences.** Month view is built first ([Phase 1]) because it exercises the
websocket spine hardest. The Today view is the *default*, but not the first
thing built. Do not reorder the phases on the assumption that default == first.

---

## ADR-0021

**The person roster lives in `people.json`, served beside the bundle.**

Status: **Accepted** · 2026-07-09

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
[Phase 1]: PLAN.md#phase-1--live-month-view--current
[Phase 4]: PLAN.md#phase-4--recurring-chores
