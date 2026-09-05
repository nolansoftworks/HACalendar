# HACalendar — agent brief

Read this first. Then `docs/STATUS.md` for where things stand, `docs/PLAN.md`
for what's next, and `docs/DECISIONS.md` for why the architecture is shaped the
way it is.

**Do not re-derive the decisions in `docs/DECISIONS.md`.** Each one was forced
by a verified fact about Home Assistant, and several of them contradict what
the HA documentation says. If you think a decision is wrong, check the
"Evidence" line on it before acting — the sources are cited.

## What this is

A family calendar and chore board replacing the dry-erase calendar on the
kitchen wall. Wall-mounted touchscreen is the primary surface; old tablets
around the house are secondary read/check-off surfaces. Users are a
non-technical adult and children. **UI friendliness is a hard requirement, not
a nice-to-have.**

## Hard constraints

| Constraint | Source |
|---|---|
| Compatibility floor is **Chromium 87** | Fire OS 7 WebView, [ADR-0003](docs/DECISIONS.md#adr-0003) |
| `local_calendar` is the only writable backend | [ADR-0001](docs/DECISIONS.md#adr-0001) |
| Calendar edit/delete are **websocket-only** | no service equivalent exists |
| Events stay RFC 5545-clean | [ADR-0009](docs/DECISIONS.md#adr-0009) |
| UI code depends on `HaClient`, never on `hass` | [ADR-0005](docs/DECISIONS.md#adr-0005) |
| A person **is** a calendar entity | no `ATTENDEE` field, [ADR-0017](docs/DECISIONS.md#adr-0017) |
| A repeating chore is a **calendar rule**, not a todo | `todo` has no recurrence, [ADR-0008](docs/DECISIONS.md#adr-0008) |
| A person's two calendars are told apart by **label** | ids are renameable, [ADR-0030] |
| The roster is HA labels, never a file in this repo | forkable by anyone, [ADR-0026](docs/DECISIONS.md#adr-0026) |
| The "who?" picker is intent, never auth | [ADR-0018](docs/DECISIONS.md#adr-0018) |
| The app owns the screen; HA is a destination | appliance, not a dashboard, [ADR-0027](docs/DECISIONS.md#adr-0027) |
| No calendar is hardcoded — the roster is the only source | [ADR-0028](docs/DECISIONS.md#adr-0028) |

## Gotchas that have already bitten us

1. **`start`/`end` vs `dtstart`/`dtend` — asymmetric.** Verified by live
   round-trip against HA 2026.7.2 on 2026-09-03. On the *same* websocket API,
   reads and writes disagree: `calendar/event/subscribe` **returns**
   `start`/`end`, while `calendar/event/create` and `/update` **require**
   `dtstart`/`dtend` and reject `start`/`end` outright:

   ```
   invalid_format: extra keys not allowed @ data['event']['start']
                   required key not provided @ data['event']['dtstart']
   ```

   This file previously claimed the split was service-vs-websocket. That was
   wrong, and it made `createEvent()`/`updateEvent()` fail at runtime with no
   compile-time signal. `toWireEvent()` in `src/ha/calendar.ts` is now the only
   place `dtstart` may appear.

2. **esbuild's `target` transpiles syntax, not built-ins.** `.at()`,
   `Object.hasOwn()`, `structuredClone()`, `.replaceAll()` all compile fine and
   then throw on the tablet. There is no compile-time signal. After any
   dependency change, re-run the bundle scan (see below).

3. **Chrome DevTools device emulation uses your desktop's engine.** It will not
   catch a Chrome 87 violation. Only real hardware will.

4. **HA caches `/local/` hard.** After rebuilding `panel.js`, bump
   `module_url` to `panel.js?v=N` or hard-refresh, or you will conclude the
   build is broken when it isn't.

5. **`local_calendar` is config-flow only — but the flow is scriptable.** It
   still cannot be created from YAML. It *can* be driven over the REST API
   without anyone touching the UI (verified 2026-09-03):

   ```bash
   # returns {"flow_id": ...}
   curl -X POST "$HA/api/config/config_entries/flow" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"handler":"local_calendar"}'
   curl -X POST "$HA/api/config/config_entries/flow/$FLOW_ID" -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"calendar_name":"Emma","import":"create_empty"}'
   ```

   `DELETE /api/config/config_entries/entry/$ENTRY_ID` removes one. Both take
   effect immediately — the response says `require_restart: false`. So
   per-person calendars ([ADR-0017]) can be provisioned from a script; the
   "someone has to click through the UI once" claim was never tested.

6. **Backend write support is not uniform and fails at runtime, silently.**
   Point this app at Google or CalDAV and edit/delete throw. No type error, no
   warning. Only `local_calendar` implements all three.

7. **Todo items DO have uids — always address them that way.** Verified against
   HA 2026.7.2 on 2026-09-04. `todo/item/list` returns a `uid` per item, and
   both `todo.update_item` and `todo.remove_item` accept that uid in the `item:`
   field. Completing one of two identically-named items by uid changed exactly
   that one and left its twin alone.

   What is still true: `todo.add_item` cannot *set* a uid, and HA happily
   accepts duplicate names. And addressing **by name** when a duplicate exists
   is the trap — HA accepted the call, returned no error, and **silently did
   nothing**. Never pass a name to `update_item` or `remove_item`.

   This file previously said same-named items were "unaddressable" and that
   unique names were "an API constraint, not a style choice". Both were wrong;
   see [ADR-0029].

8. **Never bump an overdue chore's due date.** The growing overdue-ness *is* the
   record that it was missed ([ADR-0013]). "Refreshing" it destroys that.

9. **`todo.remove_completed_items` takes no filter.** It removes *every*
   completed item. Only call it at 00:05, before materialization ([ADR-0022]).
   At any other hour you erase checkmarks kids earned today.

10. **"One shared calendar" means one *view*, not one entity.** A person is
    expressed by calendar membership because the API has nowhere else to put it
    ([ADR-0017]). Collapsing to a single entity looks like a simplification and
    silently destroys filtering, coloring, and Phase 6 sync.

11. **Duplicate task names are a clarity problem, not a corruption one**
    ([ADR-0019], corrected by [ADR-0029]). Addressing by uid makes them
    perfectly safe. Two identical rows are still confusing for a child staring
    at a chore list, so the UI may still warn — but as a kindness, not as data
    integrity, and it must never block a legitimate add.

12. **HA omits empty event fields; it does not send `null`.** Verified against
    2026.7.2. An all-day event with no description arrives as exactly
    `{start, end, summary, uid, all_day}` — `description`, `location`,
    `recurrence_id` and `rrule` are simply **absent**. They are therefore
    optional in `HaCalendarEvent`, not nullable, so a guard like
    `if (e.recurrence_id !== null)` wrongly passes on `undefined`.

13. **A person is an HA label, not a file.** The roster is the label registry
    plus the entity registry ([ADR-0026]); a label attached to a `calendar.*`
    entity *is* a person, and a label without one is ignored. `label_id`
    survives renames, which is what makes it usable as the permanent id the
    logbook needs. There is no `people.json` — two earlier designs had one and
    both were wrong, for different reasons.

14. **Creating a calendar is the only REST call in the app.** Config entry
    flows have no websocket equivalent, which is the sole reason
    `HaClient.callApi` exists. Under `vite dev` the page origin must appear in
    `cors_allowed_origins`, and `127.0.0.1:5173` is **not** the same origin as
    `localhost:5173`. Symptom: `Failed to fetch` when adding a person. Served
    from HA it is same-origin and cannot happen.

15. **A person can own two calendars, and only a label tells them apart.**
    Their own calendar carries their label; their *chore schedule* calendar
    carries their label **and** the shared `Chore schedule` one ([ADR-0030]).
    The schedule calendar holds `RRULE` chore rules, is never drawn in the week
    or month grid, and is created on demand. Two mistakes to avoid: deciding
    which is which by entity id (renameable, and getting it backwards moves
    every appointment somebody has), and letting the `Chore schedule` label
    itself into the roster as a person.

16. **An automation written over the config API is accepted and then
    ignored.** `POST /api/config/automation/config/<id>` returns
    `{"result":"ok"}` and writes `automations.yaml` whether or not
    `configuration.yaml` includes it; `automation.reload` then returns 200
    having loaded nothing, and no `automation.*` entity appears. Verified
    2026-09-04. The nightly materializer therefore ships as a **file** —
    `dev/config/automations/chores-nightly.yaml`, pulled in by
    `!include_dir_merge_list automations/` — so a missing include is visible in
    the diff rather than silent at runtime. Changing it needs a
    `docker compose restart` (or Reload Automations), not just a rebuild.

17. **The materializer is the one place a chore is matched by name.**
    `todo.add_item` cannot set a uid ([ADR-0029]), so a scheduled rule and the
    item it produced can only be paired by summary. That is *matching*, and it
    is fine. It is still never allowed to pass a name to `update_item` or
    `remove_item`.

18. **Never write `local_calendar`'s `.ics` yourself. HA will eat it.**
    `local_calendar` reads `.storage/local_calendar.<key>.ics` **once**, at
    setup, and every write serializes its whole in-memory calendar back over
    the file. So an external write is invisible to HA, and HA's next write
    **deletes it silently** — no error, no log line. Verified against real HA,
    2026-09-04 ([ADR-0031]). This is exactly what [ADR-0010] proposes doing
    with `vdirsyncer`, which is why that plan now carries a mandatory
    "reload the config entry afterwards" step
    (`POST /api/config/config_entries/entry/<id>/reload`). Reading the file is
    fine — that is all the backup does.

19. **Cloud sync is deferred by the household, not waiting to be picked up.**
    Phase 6 sits unticked on purpose ([ADR-0031], 2026-09-04): it is all local
    events until they ask. Do not start it because it looks like the next
    phase.

20. **Every `todo` entity is one of exactly two things, and nothing marks the
    second.** A `todo` entity labelled with a person is their chore list
    ([ADR-0026]); *anything else* in the domain is a household list and shows
    up on the Lists board ([ADR-0032]). There is no marker label for lists and
    there must not be one — that is what makes HA's own `todo.shopping_list`
    appear for free. The trap is that **anything else that creates a `todo`
    entity lands on the Lists board too**, so a future surface (meals, say)
    that wants one needs its own claim, decided before it is built.

21. **`fetchLists` needs a loaded roster or it will show five chore lists.**
    The definition is subtractive, so running it against an empty roster
    subtracts nothing. `app-shell` gates the subscription on `_rosterLoaded`
    and re-runs it whenever the roster changes; keep that gate.

22. **Lists do not sort. Chores do.** `chore-list.ts` orders by urgency
    ([ADR-0013]); `list-order.ts` preserves insertion order and only sinks
    ticked rows ([ADR-0033]). They are separate modules on purpose — do not
    "unify" them, and do not add an alphabetical sort to a shopping list.

[ADR-0008]: docs/DECISIONS.md#adr-0008
[ADR-0010]: docs/DECISIONS.md#adr-0010
[ADR-0031]: docs/DECISIONS.md#adr-0031
[ADR-0013]: docs/DECISIONS.md#adr-0013
[ADR-0017]: docs/DECISIONS.md#adr-0017
[ADR-0019]: docs/DECISIONS.md#adr-0019
[ADR-0022]: docs/DECISIONS.md#adr-0022
[ADR-0026]: docs/DECISIONS.md#adr-0026
[ADR-0027]: docs/DECISIONS.md#adr-0027
[ADR-0028]: docs/DECISIONS.md#adr-0028
[ADR-0029]: docs/DECISIONS.md#adr-0029
[ADR-0030]: docs/DECISIONS.md#adr-0030
[ADR-0032]: docs/DECISIONS.md#adr-0032
[ADR-0033]: docs/DECISIONS.md#adr-0033

## The server is a different PC. Never run Docker on the dev box.

Home Assistant runs on the **always-on laptop at `192.168.1.197:8123`**, not on
whatever machine this checkout is sitting on. `npm run ha:up` / `ha:down` /
`ha:logs` and every `docker compose -f dev/docker-compose.yml …` line in these
docs are **server-side** commands. Standing instruction from the household,
2026-09-05: *"the server is on another pc so we will never run docker from this
pc."*

So `dev/config/` on a dev box holds source only — `configuration.yaml`,
`automations/`, and the build output under `www/`. If it ever grows a
`.storage/` or a `home-assistant_v2.db`, somebody booted HA locally by mistake;
delete them.

**Deploying is a push.** Commit to `main` here; the server pulls:

```bash
git pull && npm install && npm run build
docker compose -f dev/docker-compose.yml restart   # only if configuration.yaml changed
```

**Verifying is a network call.** Drive the live instance over its websocket and
REST API, and the real UI over CDP against `http://192.168.1.197:8123/local/
hacalendar/index.html?ha=…&token=…`. If that host is unreachable, live
verification is **blocked** — say so. Standing up a local container to stand in
for it is not an acceptable substitute and is not allowed here.

## Environment bug on this machine

`node@21.2.0` is installed as a **global npm package**. Its shim at
`%APPDATA%\npm\node.cmd` shadows the real Node whenever npm shells out, so
`npm run build` / `npm run typecheck` fail with
`'"node"' is not recognized`.

Fix once: `npm rm -g node`

Until then, bypass with `node node_modules/vite/bin/vite.js build` and
`node node_modules/typescript/bin/tsc --noEmit`.

## Verifying a change

```bash
node node_modules/typescript/bin/tsc --noEmit     # or: npm run typecheck
npm test                                          # node:test, no deps
node node_modules/vite/bin/vite.js build          # or: npm run build

# Chrome 87 floor — must print nothing:
cd dev/config/www/hacalendar && \
  grep -oE '\.at\(|Object\.hasOwn|structuredClone|\.replaceAll\(|\.findLast\(|\.toSorted\(|:has\(|:is\(|:where\(|@container' *.js chunks/*.js
```

A typecheck and a build are **not** sufficient evidence that a change works.

The websocket schemas in `src/ha/calendar.ts` *have* now been confirmed by live
round-trip (2026-09-03) — and doing so found that two of them were wrong, after
they had passed typecheck and build for two phases. That is the argument for
this rule, not an argument that it is now unnecessary. Drive the real UI before
claiming a feature works.

The UI can be driven without a person: headless Chrome over CDP against the
live instance, with `Emulation.setTimezoneOverride` set to `America/Chicago` so
the date handling is exercised the way the wall Pi will see it. Desktop
emulation still cannot test the Chrome 87 floor or the on-screen keyboard
(gotcha 3).

## Repo layout

```
index.html              standalone shell (mount point 2)
src/panel.ts            custom element for panel_custom (mount point 1)
src/standalone.ts       own websocket connection + token setup form
src/ha/client.ts        HaClient — the seam both mount points share
src/ha/calendar.ts      typed CRUD over calendar/event/*
src/people.ts           roster vocabulary: Person, Roster, palette
src/ha/roster.ts        roster read/write via HA's label registry (ADR-0026)
src/ha/chores.ts        todo lists — ALWAYS address items by uid (ADR-0029)
src/ha/lists.ts         household lists = todo entities nobody's chores (ADR-0032)
src/ui/app-shell.ts     the appliance shell: rail, header, views (ADR-0027)
src/ui/week-view.ts     rolling day-column time grid — the default view
src/ui/week-layout.ts   time-grid geometry — no lit, unit-tested
src/ui/month-view.ts    the month grid — secondary view, presentational
src/ui/chores-view.ts   the chore board, one column per person
src/ui/chore-list.ts    chore ordering + overdue — no lit, unit-tested
src/ui/lists-view.ts    the lists board, inline add row (ADR-0033)
src/ui/list-order.ts    list ordering — insertion order kept, no lit, tested
src/ui/repeat-rule.ts   RRULE <-> English, one row per rule — no lit, tested
src/ui/chore-dialog.ts  add-a-chore, including "does it happen again?"
src/ui/event-dialog.ts  touch-first create/edit/delete sheet
src/ui/person-picker.ts the "who?" picker (ADR-0018) -- reused in Phase 3
src/ui/people-settings.ts add/edit/remove people, in-app (ADR-0026)
src/ui/event-form.ts    form <-> HA event conversion, unit-tested
src/ui/grid.ts          pure grid/date maths — no lit, unit-tested
src/**/*.test.ts        node:test suites, run by `npm test`
scripts/                test-only module resolver (.js specifier -> .ts)
dev/                    HA Container config (see ADR-0023: also production)
dev/config/automations/ nightly chore materializer + backup — versioned, not UI-made
dev/backup-config.sh    tars /config from inside the container (busybox sh)
docs/                   DECISIONS, PLAN, STATUS
```

Keep pure logic in `src/ui/grid.ts` and `src/ui/week-layout.ts`, never in a
view. Anything that imports `lit` or calls `customElements.define` cannot be
unit-tested in Node without a DOM, which is how the date maths went unverified
for two phases.

**The views are presentational.** `app-shell.ts` owns the roster,
subscriptions, filters and the edit dialog; `week-view.ts` and `month-view.ts`
take events as a property and report taps. Do not give a view its own
subscription — that is how two views start double-subscribing and drift.

Keep application logic out of `panel.ts` and `standalone.ts`. Anything that
lands in those files has to be written twice.
