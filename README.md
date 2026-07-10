# HACalendar

A family calendar and chore board for Home Assistant. Built to replace the
dry-erase calendar on the kitchen wall.

> **Working on this?** Start with [`CLAUDE.md`](CLAUDE.md), then
> [`docs/STATUS.md`](docs/STATUS.md) for where things stand,
> [`docs/PLAN.md`](docs/PLAN.md) for what's next, and
> [`docs/DECISIONS.md`](docs/DECISIONS.md) for why it's built this way.
> Several decisions contradict Home Assistant's own docs — the ADRs cite
> sources. Read them before "fixing" anything.

## Why it's shaped this way

**One bundle, two mount points.**

1. **HA panel** (`panel_custom`) — full-viewport custom element inside the HA
   frontend. This is what the wall-mounted touchscreen uses.
2. **Standalone page** (`/local/hacalendar/index.html`) — the same UI, loaded
   directly, without booting HA's frontend at all.

The second one exists because HA's frontend uses a *sliding* browser support
window (`last 7 years`, `not dead` in its `.browserslistrc`). Old tablets get
evicted from that window over time — HA 2024.5 broke Chrome 71, 2026.04 broke
old iOS. A family calendar can't be one HA upgrade away from bricking. The
standalone page loads only our bundle, so **we** own the compatibility floor.

Both mount points depend on `HaClient` (`src/ha/client.ts`) and nothing else.
Two thin adapters satisfy it. Keep app logic out of `panel.ts` and
`standalone.ts` — anything there has to be written twice.

## Compatibility floor: Chromium 87

Fire OS 7 ships Amazon's Chromium WebView, as low as **87** on un-updated
7.3.x devices. `vite.config.ts` sets `build.target: "chrome87"`.

**esbuild transpiles syntax, not built-ins.** These pass the build and throw on
the tablet:

| Don't use | Needs |
|---|---|
| `Array.prototype.at()` | Chrome 92 |
| `Object.hasOwn()` | Chrome 93 |
| `structuredClone()` | Chrome 98 |
| `:has()`, container queries | Chrome 105 |
| CSS nesting | Chrome 112 |
| `:is()`, `:where()` | Chrome 88 |

Chrome DevTools device emulation uses **your desktop's engine** and will not
catch these. Test on real hardware.

## Backend support is not uniform

Calendar CRUD is **websocket-only** — `calendar/event/update` and
`/delete` have no service equivalent, so no YAML automation can edit or delete
an event. Only this app can.

| Backend | Read | Create | Update | Delete |
|---|:--:|:--:|:--:|:--:|
| `local_calendar` | ✅ | ✅ | ✅ | ✅ |
| Google Calendar | ✅ | ✅ | ❌ | ❌ |
| CalDAV / iCloud | ✅ | ✅ | ❌ | ❌ |

This is why `local_calendar` is the source of truth. Pointing the app at Google
or CalDAV makes edit and delete fail at runtime, with no compile-time signal.

**Keep events RFC 5545-clean** — stable UIDs, standard fields, nothing custom
stuffed into `description`. `local_calendar` persists a real `.ics`, and iCloud
speaks CalDAV, so a future `vdirsyncer` sync is cheap *if* we don't corrupt the
data model now.

Also note: the websocket event payload uses `start`/`end`, while the
`calendar.create_event` **service** uses `dtstart`/`dtend`. Same fields,
different names. We speak websocket everywhere.

## Getting started

```bash
npm install
npm run ha:up          # dev HA at http://localhost:8123
```

Then, once:

1. Open http://localhost:8123, create the owner account.
2. **Settings → Devices & Services → Add Integration → "Local Calendar"**,
   name it `Family`. (It's config-flow only; it can't be set up from YAML.)
   This creates `calendar.family`.
3. Add a couple of events so the grid has something to show.

Now build the bundle into HA's `www/`:

```bash
npm run watch          # rebuilds into dev/config/www/hacalendar/
```

Restart HA once so it picks up `panel_custom`, then:

- **Panel:** http://localhost:8123/family-calendar
- **Standalone:** http://localhost:8123/local/hacalendar/index.html

### Fast iteration

`npm run watch` + browser refresh matches production exactly, but is slow. For
HMR against the real HA:

```bash
npm run dev            # http://localhost:5173
```

Open `http://localhost:5173/?ha=http://localhost:8123&token=<TOKEN>` once. Get
a token from HA under **profile → Security → Long-lived access tokens**. It's
persisted to `localStorage` afterward.

> **Auth tradeoff:** the standalone page stores a long-lived token in
> `localStorage`. That's full HA API access sitting on a kid's tablet. Fine on
> a trusted LAN; **never expose this page to the internet** without real auth
> in front of it.

## Roadmap

- [x] Month view, live off `calendar/event/subscribe`
- [ ] Event create / edit / delete (touch-first dialogs)
- [ ] Per-kid chores via `local_todo`
- [ ] Recurring chores — `todo` has **no** recurrence support. Model them as
      recurring calendar events (`RRULE`) and materialize today's instances
      into each kid's todo list with a nightly automation.
- [ ] iCloud sync via `vdirsyncer` against the `local_calendar` `.ics`

## Production topology

HA OS on the Pi, headless (keeps Supervisor, add-ons, backups). A **second**
device drives the touchscreen in Chromium kiosk mode, pointed at the panel URL.

HA OS only outputs a boot console on HDMI — it has no desktop and cannot render
a dashboard on an attached monitor. A Pi running HA OS with a touchscreen shows
you a login prompt, forever. Hence two devices.
