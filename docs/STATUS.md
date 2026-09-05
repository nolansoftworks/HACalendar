# Status

**Last updated:** 2026-09-05
**Current phase:** Phase 7 — Lists (`docs/PLAN.md`) — **built and driven end to
end against live HA**, including the browser. Phase 5's backups are done and
its kiosk half is waiting on hardware. **Phase 6 is deferred by the
household**, not pending ([ADR-0031]).
**Blocked on:** people, a restart, and hardware nobody has bought yet. Phase 2
needs a non-technical adult on the touchscreen; Phase 3 needs a child actually
using the chore board; Phases 4 and 5 both need the server to pull and restart
before their automations load; Phase 5's kiosk half needs a Raspberry Pi and a
Fire tablet that do not exist yet. Nothing is blocked on a protocol question.

**Next to build: Phase 8 — Meals.** Requested by the household on 2026-09-05:
meals against the days of the week in five slots (breakfast, lunch, afternoon
snack, dinner, bedtime snack). Not designed. It owes an ADR before any code —
see the note in `PLAN.md` about [ADR-0032] and stray `todo` entities.

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
destination works, check-off is one tap and records the completion in the
logbook, chores can be deleted, and overdue ones say how late they are in
words. What is left is a child using it.

**Phase 4 is built and driven, and needs one deploy to be real.** Repeating
chores are authored in the add-a-chore dialog ("Does it happen again?"), stored
as `RRULE` events on a per-person chore schedule calendar ([ADR-0030]), listed
as one row per rule under *Happens again* on the board, and cancelled with two
taps. The nightly materializer lives in
`dev/config/automations/chores-nightly.yaml`; every action in it has been run
against the live instance and behaves, including the 00:05 sweep, dedupe and
rollover.

**It is not running yet.** HA loads automations only via `configuration.yaml`,
and the server's checkout predates the `!include_dir_merge_list` line. On the
server:

```bash
git pull
npm install && npm run build
docker compose -f dev/docker-compose.yml restart   # configuration.yaml changed
```

Then confirm an `automation.*` entity named *Chores — sweep and materialize*
exists in Developer Tools → States. **If it doesn't, nothing will say so** —
see the gotcha below.

**Phase 5's backups are done and land in the same deploy.** `/config` is tarred
nightly at 03:30 by a script running inside the HA container — no host cron, so
it behaves the same on any server OS — into `dev/backups/` beside
`docker-compose.yml`, newest 14 kept. That directory is the household's only
copy of every calendar, every chore list and the roster itself. It survives a
bad config or a mistaken delete; it does **not** survive the disk dying. The
household intends a NAS eventually, which is one line in `docker-compose.yml`.

After the restart, check the backup end to end — Developer Tools → Actions,
YAML mode:

```yaml
action: shell_command.backup_config
response_variable: result
```

`result.returncode` should be `0` and `result.stdout` should name the archive
it wrote.

**Phase 5's kiosk half is not started, on purpose.** There is no Raspberry Pi
and no Fire OS tablet in the house yet (confirmed 2026-09-04). Kiosk autostart
and screen-blanking config written against a guessed OS image would look
finished and boot into nothing, so none of it exists.

**Lists is built and driven end to end.** All three rail destinations are now
live. A list is any `todo` entity that is nobody's chore list ([ADR-0032]), so
HA's own `todo.shopping_list` appears with nothing configured — confirmed on a
fresh instance, where it showed up on the board without this app creating
anything. Adding is an inline row that keeps focus rather than a dialog
([ADR-0033]), items hold the order they were typed in, ticking sinks a row,
*Clear ticked* and *Delete list* both take two taps, and a list can be made and
destroyed from the board itself. It needs the same deploy everything else does:
`git pull && npm install && npm run build` on the server.

**Cloud sync is deferred, not pending.** Asked on 2026-09-04, the household
said it is all local events for now and cloud comes later ([ADR-0031]). Phase 6
was investigated far enough to find that [ADR-0010]'s stated approach would
lose data, and then deliberately not built.

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
| **The rail navigates** | Chores switches section; Lists did too once it was built (2026-09-05) |
| **Check-off writes through with attribution** | picked a sibling; chore completed on its owner's list and the logbook recorded `paxtyn — completed Take out trash` |
| **Overdue is legible without colour** | "3 days late" in words, red edge, sorted to the top of the column |
| **Check-off is one tap** | ticking completes immediately with no dialog; the logbook still records it |
| **Deleting a chore needs two taps** | first tap shows "Delete?", nothing removed; second removed exactly that item by uid |
| **The strip is gone from the chore board entirely** | it used to render `static` there, duplicating the column headers as a second row of the same five names; now the board shows each person exactly once and starts 88px higher. The strip still filters and counts on the calendar |
| **The calendar strip shows chores due today** | "2 chores" on the people who owe some, counting due-today plus overdue |
| **A person can wear two calendars without confusing the roster** | five schedule calendars provisioned and labelled; every person kept their own calendar, and `fetchRoster` picked the schedule one separately — in both registry orders |
| **The schedule label is machinery, not a sixth person** | `Chore schedule` wears five calendars and is excluded from the roster |
| **The automation derives the whole household from labels** | `label_id('Chore schedule')` → five calendars → paired to five chore lists through the owner label; the YAML names nobody |
| **Today's rule materializes, once, due today** | ran the shipped YAML's `actions:` over `execute_script`; a weekly rule on one list and a daily rule on another both landed |
| **Tomorrow's rule does not materialize today** | a rule for the next weekday produced nothing |
| **Running the materializer twice adds nothing** | second run left both lists identical |
| **Rollover keeps one row and never bumps the due date** | an item missed for a week stayed single, still due 7 days ago, with its rule scheduled again today ([ADR-0013]) |
| **The 00:05 sweep clears yesterday's completed items** | a completed item was gone after the run; incomplete ones untouched ([ADR-0022]) |
| **Repeats are authored from the app** | picked "Every Friday" in the add-a-chore dialog; the RRULE landed on `calendar.grayson_chores` and the rule rendered under *Happens again* |
| **A rule starting today does not wait for midnight** | the item appeared on the list immediately, due today, and the next automation run added no duplicate |
| **Cancelling a rule takes two taps and stops the series** | first tap said "Stop it?" and removed nothing; second removed the whole series, and a later run materialized nothing |
| **Cancelling a rule leaves the item already earned** | today's materialized chore survived the cancel |
| **A schedule calendar is created on demand** | deleted one person's, then scheduled a repeat from her column: it was recreated, labelled, and her own calendar untouched |
| **Chore rules stay out of the calendar grid** | the week view subscribes only to people's own calendars; no rule ever rendered as an appointment |
| **HA silently ignores automations written over the config API** | `POST /api/config/automation/config/<id>` returned `{"result":"ok"}`, `automation.reload` returned 200, and **zero** automation entities existed — `configuration.yaml` had no include |
| **The backup captures what actually matters** | ran `dev/backup-config.sh` under busybox `sh` (the HA image is Alpine, so the strict case) against a tree holding an `.ics`, a chore list and a label registry: all three archived |
| **...and skips what it should** | recorder DB, `-wal`/`-shm`, `www/hacalendar`, `deps`, `tts` and logs were absent from the extracted archive |
| **The archive restores byte-identical** | extracted the newest and md5'd every file against the original — four of four matched |
| **Retention keeps the newest N** | five runs at `BACKUP_KEEP=3` left exactly the three newest, pruning as it went |
| **An empty `/config` fails loudly and leaves nothing behind** | 92-byte archive discarded, exit 1 — and four consecutive failures cost **zero** good backups, which is the whole point of discarding it |
| **A missing `/backup` mount fails rather than writing into the container** | exit 1 with a message naming `docker-compose.yml` |
| **`local_calendar` never notices its `.ics` changing** | appended a `VEVENT` to the file of a live calendar in a throwaway HA; the subscription still reported only HA's own events |
| **...and HA's next write destroys the external one, silently** | one `calendar/event/create` later, the appended event was gone from disk. No error, no log line. This is [ADR-0010]'s whole plan failing |
| **Reloading the config entry picks the file up** | `POST /api/config/config_entries/entry/<id>/reload` — all three events visible afterwards |
| **UIDs survive a round trip through the file** | both HA's own uids and an externally-authored `UID:from-iphone-0001` came back intact after the reload — [ADR-0009] paying off, as [ADR-0016] predicted it would be the only thing Phase 6 needed |
| *(every Lists row below was driven on 2026-09-05 against a **throwaway local** HA — the household's `192.168.1.197` server was offline that day. Same image and `configuration.yaml`, empty state, timezone forced to `America/Chicago`. **Doing it that way was a mistake**: the server is a different PC and nothing runs Docker on a dev box (see `CLAUDE.md`). The rows are real observations of the shipped bundle, but they are not observations of the household's instance — re-confirm the board there after the next pull)* | — |
| **A list HA made itself appears with nothing configured** | onboarded a *fresh* HA, created one person, and `todo.shopping_list` — which this app never touched — was on the Lists board. [ADR-0032]'s subtractive rule, checked the only way that proves it |
| **A person's chore list is never on the Lists board** | `todo.alex_chores` excluded while `todo.shopping` was included, same registry, same call |
| **`todo` items keep insertion order, so the sort is honest** | Milk, Eggs, Bread came back in that order from live HA; ticking Eggs did not reorder the others ([ADR-0033]) |
| **The Lists rail item is live** | `aria-disabled="false"`, no "not built yet" title, and tapping it renders the board — all three destinations now work |
| **Adding is inline and keeps focus** | typed `Milk` with real key events, pressed Enter: the row appeared, the box emptied, and `activeElement` was still the box. No dialog opened |
| **One tap ticks a row, and it sinks** | tapping *Eggs* completed it and moved it below Milk and Bread; the header changed to "2 left" |
| **Clear ticked asks, then sweeps only the ticked** | first tap said "Remove 1 ticked thing?"; second left `Milk, Bread` |
| **A list can be made and destroyed from the board** | typed "Packing" into the new-list box → a Packing column appeared; two taps on its × removed it from the board and from HA |
| **The chore board and calendar are unharmed by the new section** | after using Lists, Calendar restored the week grid, person strip and **+**; Chores showed one column per person with no strip and no **+** |

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
- **The nightly automation has never fired on its own trigger.** Its actions
  have all been driven by hand against the live instance, but the server's
  `configuration.yaml` does not yet include `automations/`, so nothing has run
  at 00:05 and no chore has ever appeared overnight unasked. This is a deploy,
  not a question — see *Next action*.
- **No repeating chore has survived a real week.** Everything observed happened
  inside one afternoon, with the calendar's own rules and a hand-run
  materializer. "Every Tuesday" arriving on a Tuesday nobody arranged is still
  a prediction.
- **The backup has never run through Home Assistant.** The script itself is
  well tested — under busybox, including a restore — but `shell_command`
  finding it, and the 03:30 trigger firing, both need the deploy. Until then no
  archive has ever been written by anything but a test container.
- **No backup has ever been restored into a real HA.** The archive round-trips
  by checksum, which is not the same as HA starting cleanly from it. Worth
  doing once, deliberately, before anyone needs it.
- **Nothing has survived a reboot.** `restart: unless-stopped` is set in
  `docker-compose.yml` and has never been tested by actually restarting the
  laptop.

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

**An automation written over the config API loads only if
`configuration.yaml` says so.** `POST /api/config/automation/config/<id>`
returns `{"result":"ok"}` and writes the file whether or not anything reads it,
and `automation.reload` then succeeds against nothing. The only symptom is that
no `automation.*` entity ever appears. This app ships its automation as a file
under `dev/config/automations/` with an `!include_dir_merge_list` in
`configuration.yaml` precisely so there is something to check.

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

`docs/DECISIONS.md` holds 33 ADRs. **[ADR-0006] is superseded by [ADR-0023]**
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
- **[ADR-0016]** — was an unanswered question that was *supposed* to stay
  unanswered until Phase 6. It was asked at Phase 6 entry and answered
  ([ADR-0031]); the answer is recorded intent, not a tested design.
- **[ADR-0031]** — "just point vdirsyncer at the `.ics`" is what [ADR-0010]
  says and it silently loses data. Also: cloud sync is deferred *by the
  household*, so Phase 6 sitting unticked is not a to-do.
- **[ADR-0017]** — "the user asked for one shared calendar" is true of the
  *view*, not the storage. Collapsing to one entity looks like simplification
  and destroys filtering, coloring, and Phase 6 sync.
- **[ADR-0022]** — sweeping completed items at any hour other than 00:05 erases
  checkmarks children earned that day.
- **[ADR-0030]** — a person owning two calendars looks like an accident to
  tidy up. Collapsing them puts chore rules on the kitchen wall grid; telling
  them apart by entity id instead of by label breaks the first time somebody
  renames one in HA's settings.

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
[ADR-0026]: DECISIONS.md#adr-0026
[ADR-0029]: DECISIONS.md#adr-0029
[ADR-0030]: DECISIONS.md#adr-0030
[ADR-0010]: DECISIONS.md#adr-0010
[ADR-0031]: DECISIONS.md#adr-0031
[ADR-0032]: DECISIONS.md#adr-0032
[ADR-0033]: DECISIONS.md#adr-0033
