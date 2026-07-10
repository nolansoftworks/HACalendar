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
| The "who?" picker is intent, never auth | [ADR-0018](docs/DECISIONS.md#adr-0018) |

## Gotchas that have already bitten us

1. **`start`/`end` vs `dtstart`/`dtend`.** The websocket event payload uses
   `start`/`end`. The `calendar.create_event` *service* uses `dtstart`/`dtend`
   for the same fields. We speak websocket everywhere. Don't mix them.

2. **esbuild's `target` transpiles syntax, not built-ins.** `.at()`,
   `Object.hasOwn()`, `structuredClone()`, `.replaceAll()` all compile fine and
   then throw on the tablet. There is no compile-time signal. After any
   dependency change, re-run the bundle scan (see below).

3. **Chrome DevTools device emulation uses your desktop's engine.** It will not
   catch a Chrome 87 violation. Only real hardware will.

4. **HA caches `/local/` hard.** After rebuilding `panel.js`, bump
   `module_url` to `panel.js?v=N` or hard-refresh, or you will conclude the
   build is broken when it isn't.

5. **`local_calendar` is config-flow only.** It cannot be created from YAML.
   Someone has to click through the UI once.

6. **Backend write support is not uniform and fails at runtime, silently.**
   Point this app at Google or CalDAV and edit/delete throw. No type error, no
   warning. Only `local_calendar` implements all three.

7. **Todo items are addressed by name.** `todo.update_item` takes `item:` (the
   name); `todo.add_item` cannot set a UID. Two same-named items in one list are
   unaddressable. Chore names must be unique per list — an API constraint, not a
   style choice.

8. **Never bump an overdue chore's due date.** The growing overdue-ness *is* the
   record that it was missed ([ADR-0013]). "Refreshing" it destroys that.

9. **`todo.remove_completed_items` takes no filter.** It removes *every*
   completed item. Only call it at 00:05, before materialization ([ADR-0022]).
   At any other hour you erase checkmarks kids earned today.

10. **"One shared calendar" means one *view*, not one entity.** A person is
    expressed by calendar membership because the API has nowhere else to put it
    ([ADR-0017]). Collapsing to a single entity looks like a simplification and
    silently destroys filtering, coloring, and Phase 6 sync.

11. **Duplicate task names corrupt a list** ([ADR-0019]). Since items are
    addressed by name, adding a duplicate makes *both* unaddressable. Refuse it
    in the UI. This is data integrity, not polish.

[ADR-0013]: docs/DECISIONS.md#adr-0013
[ADR-0017]: docs/DECISIONS.md#adr-0017
[ADR-0019]: docs/DECISIONS.md#adr-0019
[ADR-0022]: docs/DECISIONS.md#adr-0022

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
node node_modules/vite/bin/vite.js build          # or: npm run build

# Chrome 87 floor — must print nothing:
cd dev/config/www/hacalendar && \
  grep -oE '\.at\(|Object\.hasOwn|structuredClone|\.replaceAll\(|\.findLast\(|\.toSorted\(|:has\(|:is\(|:where\(|@container' *.js chunks/*.js
```

A typecheck and a build are **not** sufficient evidence that a change works.
The websocket schemas in `src/ha/calendar.ts` were transcribed from HA's source,
not confirmed against a live round-trip. Drive the real UI before claiming a
feature works.

## Repo layout

```
index.html              standalone shell (mount point 2)
src/panel.ts            custom element for panel_custom (mount point 1)
src/standalone.ts       own websocket connection + token setup form
src/ha/client.ts        HaClient — the seam both mount points share
src/ha/calendar.ts      typed CRUD over calendar/event/*
src/ui/month-view.ts    the month grid
dev/                    disposable HA Container for development
docs/                   DECISIONS, PLAN, STATUS
```

Keep application logic out of `panel.ts` and `standalone.ts`. Anything that
lands in those files has to be written twice.
