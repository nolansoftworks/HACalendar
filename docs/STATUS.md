# Status

**Last updated:** 2026-09-03
**Current phase:** Phase 1 — Live month view (`docs/PLAN.md`)
**Blocked on:** browser-side verification only (see *Next action*)

Keep this file honest. The single most useful thing it does is separate what
has been **observed** from what has only been **built**. A passing typecheck is
not evidence that a feature works.

---

## Next action

The websocket half of Phase 1 is done — schemas, CRUD and date handling were
all confirmed against live HA 2026.7.2 on 2026-09-03 (see *Verified* below).
`calendar.family` is seeded with the five shapes and they are still there.

What remains is the half that needs eyes on a browser:

1. Rebuild the bundle on the server and restart HA
   (`panel_custom` is read only at startup):
   ```bash
   node node_modules/vite/bin/vite.js build
   docker compose -f dev/docker-compose.yml restart
   ```
2. Open `http://<server>:8123/family-calendar` and confirm the September grid
   shows `TEST-allday-first` on the **1st** (not Aug 31) and `TEST-allday-last`
   on the **30th** (not Oct 1).
3. Confirm `TEST-multiday` spans Sep 10–12 and stops — it must not touch the 13th.
4. Open `/local/hacalendar/index.html` and confirm the same, with a token.
5. Flip months fast and confirm exactly one live subscription survives
   (the `#subscriptionToken` guard in `month-view.ts`).

Steps 2 and 3 are already proven correct at the data layer against real
payloads; what is unproven is that the *rendering* agrees. If the grid
disagrees with the assertions, the bug is in `month-view.ts`, not in
`parseHaDate()`.

Remember to hard-refresh or bump `module_url` — HA caches `/local/` hard.

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

---

## Built but NOT verified ⚠️

The data layer is no longer in this list — it was verified on 2026-09-03. What
remains has still never been executed. Treat each as a hypothesis.

- **Nothing in `src/ui/month-view.ts` has ever rendered.** The date *logic* is
  proven against real payloads, but that was checked by lifting `eventsOnDay()`
  into a harness, because it is not exported and the module calls
  `customElements.define` at import time. The grid itself is unobserved.
- **The `#subscriptionToken` guard** in `month-view.ts` — written to prevent an
  out-of-order subscribe from winning during fast month navigation. Never
  exercised.
- **`clientFromHass()` WeakMap caching** — meant to stop HA's per-state-change
  `hass` replacement from tearing down subscriptions. Never observed working.
- **The standalone token flow** — the setup form and `createLongLivedTokenAuth`
  path have never authenticated against anything. (A long-lived token *does*
  work against this instance; the app's own auth path is what's untested.)
- **`panel.js` served from `/local/`** — the panel is registered and HA points
  at the URL, but nobody has confirmed HA actually serves and executes the
  bundle.
- **Nothing has ever run on a Fire OS 7 tablet.** [ADR-0003] is reasoned from
  reported WebView versions, not measured.

### Testability debt found while verifying

`eventsOnDay()`, `buildGrid()` and `visibleRange()` are module-private in
`month-view.ts`, and that file imports `lit` and registers a custom element on
import — so none of them can be unit-tested in Node without a DOM. Verifying
them meant copying `eventsOnDay()` verbatim into a scratch harness, which tests
a *copy*, not the code. Moving that pure date logic into its own module (no
`lit` import) would make it directly testable and is cheap to do before Phase 2
builds on it.

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
