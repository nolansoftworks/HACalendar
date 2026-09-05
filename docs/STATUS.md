# Status

**Last updated:** 2026-09-04
**Current phase:** Phase 3 — Chores (`docs/PLAN.md`) — mechanics complete
**Blocked on:** people, not protocols. Phase 2 needs a non-technical adult on
the touchscreen; Phase 3 needs a child actually using the chore board. Neither
can be closed from a script, and everything either one depends on is verified.

Keep this file honest. The single most useful thing it does is separate what
has been **observed** from what has only been **built**. A passing typecheck is
not evidence that a feature works.

---

## Next action

Phases 1 and 1.5 are closed. **Phase 2 is code complete** and every path is
verified under automation, but its exit criterion is about a person — a
non-technical adult adding, editing and deleting an event on the touchscreen
unaided — so it stays open until someone actually tries. The keyboard-occlusion
item needs the real tablet for the same reason.

People are now added and edited in the app ([ADR-0026]); there is no roster
file to deploy or maintain.

**Deploying to the server.** HA serves the bundle from the **server's**
checkout of this repo, not from any developer machine. The roster is *not*
deployed — it lives in HA ([ADR-0026]) and is edited in the app. After pulling,
on the server:

```bash
npm install
npm run build
```

`panel_custom` is read only at HA startup, so a `docker compose restart` is
needed only if `configuration.yaml` changed. HA caches `/local/` hard — hard-
refresh, or bump `module_url` to `panel.js?v=N`, or you will conclude the build
is broken when it isn't.

**Phase 3's mechanics are done.** Everyone has a chore list, the Chores rail
destination works, check-off asks who did it and records that in the logbook,
and overdue chores say how late they are in words. What is left is a child
using it — plus Phase 4's nightly materializer for recurring chores.

**Lists** is the one rail item still disabled. It has no phase of its own yet;
the obvious shape is "every `todo.*` entity that isn't somebody's chore list",
which would make the shopping list HA already ships appear for free.

---

## Verified ✅

Things actually observed, with the check that produced them.

| Claim | How it was checked |
|---|---|
| Typecheck clean | `tsc --noEmit`, exit 0 |
| Build clean | `vite build`, exit 0 — emits `panel.js`, `index.html`, shared `month-view` chunk |
| Relative paths resolve under `/local/hacalendar/` | inspected emitted `index.html` and `panel.js` import graph |
| Chrome 87 floor holds for current deps | grepped emitted bundle for `.at(`, `Object.hasOwn`, `structuredClone`, `.replaceAll(`, `:has(`, `:is(`, `@container` — zero hits |
| `local_calendar` supports create/update/delete | read `local_calendar/calendar.py` |
| `caldav` supports create only | read `caldav/calendar.py` |
| Google supports create only | HA docs + service list |
| Websocket commands exist: `calendar/event/{create,update,delete,subscribe}` | read `calendar/__init__.py` |
| `todo` has no recurrence | read `todo/__init__.py` — no such feature flag |
| HA OS cannot render a dashboard on HDMI | HA discussion #1668 |
| **Live instance reachable at `192.168.1.197:8123`** | `200` on `/`, `401` on `/api/` |
| **HA timezone really is `America/Chicago`** | `GET /api/config` on the live instance — it did inherit the container `TZ` |
| **`panel_custom` IS registered** | `get_panels` returns `family-calendar` → `hacalendar-panel` → `/local/hacalendar/panel.js` |
| **`calendar/event/subscribe` schema correct** | live subscribe accepted; pushes `{events: [...]}` as `SubscribeMessage` declares |
| **Reads use `start`/`end`** | raw payload from live HA 2026.7.2 |
| **Writes require `dtstart`/`dtend`** | `create`/`update` reject `start`/`end` with `invalid_format`. Was documented backwards; fixed |
| **All-day arrives as bare `YYYY-MM-DD`, `end` exclusive** | one-day all-day event returns `start: 2026-09-03, end: 2026-09-04` |
| **HA omits empty fields rather than sending `null`** | all-day event returned exactly `{start,end,summary,uid,all_day}` |
| **Recurring expands to one entry per instance** | shared `uid`, distinct `recurrence_id` (`20260908T160000`, …) |
| **`recurrence_id` + `recurrence_range: THISANDFUTURE` accepted** | live update against a series |
| **Single-instance delete works** | deleted one `recurrence_id`; 5 instances → 4, gap in the right place |
| **`parseHaDate()` puts all-day events on the right day** | 14 assertions vs real payloads under `TZ=America/Chicago`; naive `new Date()` puts Sep 1 on **Aug 31** |
| **`eventsOnDay()` exclusive-end handling correct** | multi-day Sep 10–13 covers 10/11/12, not 9 or 13 |
| **Real `createEvent`/`updateEvent`/`deleteEvent` round-trip** | driven from source against live HA after the `dtstart` fix |
| **Both mount points render real events** | headless Chrome, timezone pinned to `America/Chicago`; panel reached by seeding `localStorage.hassTokens` |
| **`#subscriptionToken` guard works** | 12 rapid month clicks → 14 subscribes, 13 unsubscribes, exactly 1 left open |
| **`clientFromHass()` survives HA's `hass` churn** | the panel renders and keeps its subscription, which is what the WeakMap cache exists for |
| **HA serves the bundle from `/local/`** | `200` on `panel.js` and `index.html` |
| **`local_calendar` config flow is scriptable** | created and deleted two calendars over the REST API; `require_restart: false` |
| **Multi-calendar overlay, colors, filters** | two throwaway calendars: `rgb(232, 89, 12)` and `rgb(95, 61, 196)` chips on the same day; toggling one hid only its events |
| **`weekStartsOn` drives the grid** | flipping to `1` gave Mon–Sun headings and opened on Aug 31; events stayed on their dates |
| **Grid maths unit-tested** | 18 `node:test` assertions, passing in UTC, Central, Tokyo and London |
| **Six calendars overlay correctly** | `calendar.family` + five per-person calendars, one event each on the same day, every chip its owner's color |
| **Per-person isolation works** | hiding all but one person left exactly that person's event; the shared calendar hides with its own chip |
| **Per-person calendars created without the HA UI** | all five made over the config-flow REST API |
| **A label's colour accepts arbitrary hex** | `#a61e4d` stored and read back, not just HA's named palette |
| **`label_id` survives a rename** | renamed a label; `label_id` unchanged — usable as [ADR-0021]'s permanent id |
| **Roster reads from HA's registries** | label + entity registry in one round trip; a label with no calendar is correctly ignored |
| **People are managed entirely in the app** | added a person from Settings: label created, calendar auto-created, linked, chip appeared without a reload |
| **Adopting an existing calendar works** | attached a new person to an existing `calendar.*` without creating another |
| **Failed add rolls back cleanly** | a CORS-blocked create deleted the label it had already made, leaving no debris |
| **Removal keeps the calendar by default** | person deleted, calendar survived and returned to the adoptable list |
| **Create from the UI writes to the picked person's calendar** | tapped Sep 20, picked a person, typed a name — landed on that person's calendar, chip in their color |
| **Inclusive end date converts to HA's exclusive one** | UI end 22nd stored as `end: 2026-09-23` |
| **Edit and delete from the UI** | rename persisted; delete needed a second tap and only then removed it |
| **Recurring scope works both ways** | "only this one" renamed 1 of 4 instances; `THISANDFUTURE` changed 3 and preserved the earlier exception |
| **Optimistic rollback on rejection** | deleted an event behind the UI's back, then saved: grid restored, error shown, nothing written |
| **Write errors are translated for the household** | "That event isn't there any more…" shown; raw HA text logged to console |
| **Subscription pushes on every change** | create produced two pushes, delete one — so no resubscribe after writes |
| **Appliance shell renders** | rail, household name from HA's instance name, live clock, person strip, view switch, FAB — headless Chrome at 1280×800 |
| **Time grid positions events by real times** | 9am–9:30am block at `top: 14.286%`, a 90-minute block taller than a 60-minute one |
| **Overlapping events split into lanes** | 4–5:30 and 4:30–5 rendered `width: 50%` at `left: 0%` and `50%`; a 5–6 event reused the freed lane |
| **All-day items go to the band, not the grid** | `TEST-Tacos` rendered as a pill above the columns |
| **Tapping an hour slot creates a timed event there** | tapping the 2pm slot prefilled `14:00`–`15:00`, not all-day |
| **Grid auto-scrolls toward now** | `scrollTop: 313` of 913 on mount, rather than opening at 7am |
| **The hour window keeps the current hour visible** | at 21:23 the window stretched to 22:00 and the now-line drew |
| **No calendar is hardcoded** | with `calendar.family` unlabelled it vanishes from the app entirely; only roster entries render |
| **Week view is a real Sunday–Saturday week** | columns `Sun 30 … Sat 5`; Next advanced to `Sun 6 … Sat 12`; Today returned to the current week |
| **Per-person counts in the header** | `1/1` past/total with a filled bar, and a `1 today` badge on the three people with events today |
| **Counts ignore the filter toggles** | hiding a person leaves their numbers intact, so the strip still explains itself |
| **The header names the visible range** | `August 30 – September 5, 2026` in week view, `September 2026` in month |
| **Todo items are addressable by uid** | completing one of two identically-named items changed only that one |
| **Addressing a todo by name silently no-ops** | with a duplicate present, `update_item` by name returned success and changed nothing |
| **`local_todo` config flow is scriptable** | five chore lists provisioned and labelled without touching the HA UI |
| **The rail navigates** | Chores switches section; Lists stays disabled and says so |
| **Check-off writes through with attribution** | picked a sibling; chore completed on its owner's list and the logbook recorded `paxtyn — completed Take out trash` |
| **Overdue is legible without colour** | "3 days late" in words, red edge, sorted to the top of the column |

---

## Built but NOT verified ⚠️

The data layer and the month grid are no longer in this list — both were
verified on 2026-09-03. What remains has still never been executed.

- **The standalone *setup form*** — `renderSetup()` and its `localStorage`
  round-trip. The `createLongLivedTokenAuth` path underneath it is proven (the
  standalone page renders when handed `?token=`), but nobody has typed a URL
  and token into the form and pressed Connect.
- **No non-technical person has used the dialog.** Every CRUD path is driven
  and passing under automation, which proves it *works* and says nothing about
  whether it is *usable*. That is Phase 2's actual exit criterion.
- **The on-screen keyboard has never been seen.** The sheet is top-anchored
  with its own scroll so a shrinking visual viewport shouldn't bury the
  fields — a prediction, not an observation. Desktop Chrome cannot test it.
- **Nothing has ever run on a Fire OS 7 tablet.** [ADR-0003] is reasoned from
  reported WebView versions, not measured. The bundle scan passes, which is
  necessary and not sufficient. `<input type="date">` and `type="time"` are
  used by the dialog; both are old enough for Chrome 87, but their *touch*
  behaviour on Fire OS is unobserved.
- **Nothing has run on the wall Pi**, in kiosk mode or otherwise.
- **The overlay has never run with more than two people**, and never with a
  person who has a `choreList` but no `calendar`. `normalizeRoster()` covers
  that case in tests; the rendering path does not.

### Testability debt — resolved

`eventsOnDay()`, `buildGrid()` and `visibleRange()` used to be module-private
in `month-view.ts`, behind a `lit` import and a `customElements.define()` at
module scope, so verifying them meant copying them into a scratch harness —
which tests a *copy*, not the code. They now live in `src/ui/grid.ts`, which
imports no DOM and registers nothing, and are covered by `npm test`.

**Keep it that way.** Pure logic goes in `grid.ts`; anything importing `lit`
belongs in `month-view.ts`. This is the specific mistake that let the date
maths sit unverified through two phases.

---

## Known issues

**Global `node@21.2.0` npm package** shadows real Node (24) whenever npm shells
out, breaking `npm run build` and `npm run typecheck` with
`'"node"' is not recognized`. Fix: `npm rm -g node`. Workaround: invoke
`node node_modules/vite/bin/vite.js build` directly.

**HA caches `/local/` aggressively.** After a rebuild, bump `module_url` to
`panel.js?v=N` or hard-refresh. Expect to lose ten minutes to this once.

---

## Open questions

**None blocking.** Everything raised through 2026-07-09 is closed.

| Was | Now |
|---|---|
| Chore → todo mapping | [ADR-0012]. Forced by the API — no `CATEGORIES`/`ATTENDEE` exists. |
| Chore completion history | [ADR-0014]. `logbook.log` at check-off; recorder persists it. |
| Uncompleted chores at midnight | [ADR-0013]. Roll over until done; never bump the due date. |
| Sync conflict policy | **Deliberately deferred**: [ADR-0016]. Not an oversight. |
| Unknown Android tablet | [ADR-0015]. Policy, not device list. |
| Per-event ownership | [ADR-0017]. Person *is* a calendar entity; the unified calendar is a view. |
| Kids adding tasks | [ADR-0019]. Recovered from the original brief; needs duplicate-name refusal. |
| Default kiosk view | [ADR-0020]. Today + chore rails; month one tap away. |
| Roster schema and storage | [ADR-0021] for the shape, [ADR-0026] for where it lives. `id` is the `label_id`: stable and logbook-facing; the display name is not. |
| Sweep cadence | [ADR-0022]. 00:05, before materialization. Not cosmetic — `remove_completed_items` takes no filter. |
| Week start | Sunday. Carried on the roster as `weekStartsOn: 0`, not a constant. |

**Still unknown, non-blocking:**

- **The Android tablet's model.** Resolved as policy by [ADR-0015], so it no
  longer blocks anything.

**Timezone: `America/Chicago` (US Central).** Set in `dev/docker-compose.yml`.
This is load-bearing, not cosmetic — `new Date("2026-07-09")` parses as UTC
midnight, which in Central lands on **July 8th**. An all-day event on the 1st
would render in the previous month. `parseHaDate()` exists to prevent this and
has never been tested. HA's onboarding also asks for a timezone separately and
does not always inherit the container's `TZ`; they must agree.

---

## Decision log health

`docs/DECISIONS.md` holds 23 ADRs. **[ADR-0006] is superseded by [ADR-0023]**
(server moved from a headless Pi to the always-on laptop; the Pi is now a kiosk
client). The ones most likely to be wrongly "corrected" by a future agent,
because they contradict HA's own documentation or look like over-engineering:

- **[ADR-0001]** — the docs do not tell you that Google and CalDAV are
  create-only. You must read the source.
- **[ADR-0002]** — looks like over-engineering until you know HA's browserslist
  slides and evicts devices annually.
- **[ADR-0003]** — `build.target` looks sufficient. It is not; it does not
  polyfill built-ins.
- **[ADR-0013]** — "just bump the due date so it looks fresh" destroys the only
  record that a chore was missed.
- **[ADR-0016]** — an unanswered question that is *supposed* to stay unanswered
  until Phase 6. Do not helpfully resolve it.
- **[ADR-0017]** — "the user asked for one shared calendar" is true of the
  *view*, not the storage. Collapsing to one entity looks like simplification
  and destroys filtering, coloring, and Phase 6 sync.
- **[ADR-0022]** — sweeping completed items at any hour other than 00:05 erases
  checkmarks children earned that day.

[ADR-0001]: DECISIONS.md#adr-0001
[ADR-0002]: DECISIONS.md#adr-0002
[ADR-0003]: DECISIONS.md#adr-0003
[ADR-0012]: DECISIONS.md#adr-0012
[ADR-0013]: DECISIONS.md#adr-0013
[ADR-0014]: DECISIONS.md#adr-0014
[ADR-0015]: DECISIONS.md#adr-0015
[ADR-0016]: DECISIONS.md#adr-0016
[ADR-0017]: DECISIONS.md#adr-0017
[ADR-0019]: DECISIONS.md#adr-0019
[ADR-0020]: DECISIONS.md#adr-0020
[ADR-0006]: DECISIONS.md#adr-0006
[ADR-0021]: DECISIONS.md#adr-0021
[ADR-0022]: DECISIONS.md#adr-0022
[ADR-0023]: DECISIONS.md#adr-0023
[Phase 1]: PLAN.md#phase-1--live-month-view--current
