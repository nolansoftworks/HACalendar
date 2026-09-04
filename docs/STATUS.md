# Status

**Last updated:** 2026-09-03
**Current phase:** Phase 2 — Event CRUD (`docs/PLAN.md`) — code complete
**Blocked on:** a person. Phase 2's exit criterion is a non-technical adult
using the touchscreen unaided, and the keyboard-occlusion check needs the real
tablet. Neither can be closed from a script.

Keep this file honest. The single most useful thing it does is separate what
has been **observed** from what has only been **built**. A passing typecheck is
not evidence that a feature works.

---

## Next action

Phases 1 and 1.5 are closed and verified against the live instance, and the
roster is populated. **Phase 2 — event CRUD — is next**, and its write path is
already proven at the protocol level (create, update, `THISANDFUTURE`, and
single-instance delete all round-trip), so it is a UI problem rather than a
protocol one. Note [ADR-0024]: writes take `dtstart`/`dtend`, and
`toWireEvent()` is the only place that may say so.

**Deploying to the server.** HA serves the bundle from the **server's**
checkout of this repo, not from any developer machine. `public/people.json` is
copied into `www/` by the build and `emptyOutDir` wipes hand edits there, so a
roster change means a deploy. After pulling, on the server:

```bash
npm install
npm run build
```

`panel_custom` is read only at HA startup, so a `docker compose restart` is
needed only if `configuration.yaml` changed. HA caches `/local/` hard — hard-
refresh, or bump `module_url` to `panel.js?v=N`, or you will conclude the build
is broken when it isn't.

Then Phase 2 (event CRUD) can start. Its write path is already proven at the
API level — create, update, `THISANDFUTURE`, and single-instance delete all
round-trip — so Phase 2 is a UI problem, not a protocol one.

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
| **Create from the UI writes to the picked person's calendar** | tapped Sep 20, picked a person, typed a name — landed on that person's calendar, chip in their color |
| **Inclusive end date converts to HA's exclusive one** | UI end 22nd stored as `end: 2026-09-23` |
| **Edit and delete from the UI** | rename persisted; delete needed a second tap and only then removed it |
| **Recurring scope works both ways** | "only this one" renamed 1 of 4 instances; `THISANDFUTURE` changed 3 and preserved the earlier exception |
| **Optimistic rollback on rejection** | deleted an event behind the UI's back, then saved: grid restored, error shown, nothing written |
| **Write errors are translated for the household** | "That event isn't there any more…" shown; raw HA text logged to console |
| **Subscription pushes on every change** | create produced two pushes, delete one — so no resubscribe after writes |

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
| `people.json` schema | [ADR-0021]. `id` is stable and logbook-facing; display name is not. |
| Sweep cadence | [ADR-0022]. 00:05, before materialization. Not cosmetic — `remove_completed_items` takes no filter. |
| Week start | Sunday. Lives in `people.json` as `weekStartsOn: 0`, not a constant. |

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
