# Status

**Last updated:** 2026-07-09
**Current phase:** Phase 1 — Live month view (`docs/PLAN.md`)
**Blocked on:** a human onboarding the dev HA instance (see *Next action*)

Keep this file honest. The single most useful thing it does is separate what
has been **observed** from what has only been **built**. A passing typecheck is
not evidence that a feature works.

---

## Next action

Nobody has ever pointed this code at a running Home Assistant. That is the next
thing that should happen, and it needs a human because `local_calendar` is
config-flow only.

**Follow [`docs/DEV-SETUP.md`](DEV-SETUP.md).** It has the full runbook, the
event shapes to seed, and the troubleshooting table.

The step that actually matters: seed **all-day events on the 1st and the last
day of a month**. A timed event proves almost nothing. Those two are what catch
the UTC-midnight parsing bug, which in Central time renders an all-day event on
the wrong day — and, on the 1st, in the wrong *month*.

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

---

## Built but NOT verified ⚠️

**Everything below compiles and has never been executed against a live HA.**
Treat each as a hypothesis.

- **The websocket message shapes in `src/ha/calendar.ts`** were transcribed from
  HA's Python source, not confirmed by a round trip. Field names, required vs
  optional, and the subscribe payload shape are all unconfirmed at runtime.
- **`parseHaDate()`** — the all-day / UTC-midnight fix. Logic is right in
  principle; never tested against a real all-day event.
- **`eventsOnDay()` exclusive-end handling** — never tested against real data.
- **The `#subscriptionToken` guard** in `month-view.ts` — written to prevent an
  out-of-order subscribe from winning during fast month navigation. Never
  exercised.
- **`clientFromHass()` WeakMap caching** — meant to stop HA's per-state-change
  `hass` replacement from tearing down subscriptions. Never observed working.
- **`panel_custom` registration** — the `name:` in `configuration.yaml` must
  match the tag in `src/panel.ts` (`hacalendar-panel`). Never loaded by HA.
- **The standalone token flow** — the setup form and `createLongLivedTokenAuth`
  path have never authenticated against anything.
- **Nothing has ever run on a Fire OS 7 tablet.** [ADR-0003] is reasoned from
  reported WebView versions, not measured.

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
