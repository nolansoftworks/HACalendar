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

**A family calendar appliance that runs on Home Assistant** ([ADR-0027](docs/DECISIONS.md#adr-0027)).
The app owns the whole screen: a left rail for Calendar / Chores / Lists, a
header with the household name and the time, and a Sunday-to-Saturday time grid
as the default view. Home Assistant is a *destination*, not the frame wrapped
around us — HA's own `/calendar`, `/todo` and the rest of `default_config` are
unrelated to this app.

**Nothing about your household is hardcoded.** There is no built-in "family"
calendar; every calendar shown comes from the people you add in Settings
([ADR-0028](docs/DECISIONS.md#adr-0028)). If you want a shared calendar, add one
called Family alongside everyone else.

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

Also note: the field names are **asymmetric on the websocket itself**, which is
not what this file used to say. Reads (`calendar/event/subscribe`) return
`start`/`end`; writes (`calendar/event/create` and `/update`) require
`dtstart`/`dtend` and reject `start`/`end`. It is a read-vs-write split, not a
service-vs-websocket one — verified by round trip, see
[ADR-0024](docs/DECISIONS.md#adr-0024). `toWireEvent()` in
`src/ha/calendar.ts` is the only place that may say `dtstart`.

## Getting started

```bash
npm install
npm run ha:up          # dev HA at http://localhost:8123
```

Then, once:

1. Open http://localhost:8123, create the owner account.
2. **Settings → Devices & Services → Add Integration → "Local Calendar"**,
   name it `Family`. This creates `calendar.family`.

   It's config-flow only — it can't be set up from YAML — but the flow *is*
   drivable over the REST API, so the per-person calendars can be provisioned
   by script rather than by hand. See gotcha 5 in [`CLAUDE.md`](CLAUDE.md).
3. Add a couple of events so the grid has something to show.

### Setting up your household

**There is nothing to configure and no file to edit.** Open the calendar, tap
**Settings**, and add each person with a name and a color. Adding someone
creates their calendar for you.

Until anyone is added, the grid shows the shared calendar and a one-line hint
pointing at Settings, so a fresh install explains itself rather than looking
broken.

Under the hood a person is a **Home Assistant label**, and their calendar is
the entity carrying that label ([ADR-0026](docs/DECISIONS.md#adr-0026)). That
means the roster is shared across every device and HA user, survives upgrades,
needs nothing in this repo — so a fork never arrives carrying someone else's
family — and can also be edited from HA's own Settings → Labels if you prefer.

Removing a person detaches them and **keeps their calendar** by default.
Deleting the calendar destroys its events, so it is a separate, confirmed
choice.

A person's `id` is their `label_id`, and it survives renames — which matters,
because it is what chore completions get logged against. Rename freely; the
history follows.

> **Adding a person from `npm run dev` needs a matching CORS origin.** Creating
> a calendar is the one REST call in the app, and browsers treat
> `http://127.0.0.1:5173` and `http://localhost:5173` as different origins.
> Only the latter is in `cors_allowed_origins`, so use `localhost` or the
> request fails with `Failed to fetch`. Served from HA it is same-origin and
> this cannot happen.

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
- [x] Multi-calendar overlay — one grid, one color per person, filter toggles
- [x] Event create / edit / delete (touch-first dialogs)
- [x] Appliance shell — left rail, header, Sunday-to-Saturday time grid
- [x] Per-person event counts in the header strip
- [x] A chore board per person via `local_todo` — one-tap check-off, overdue in
      words, two-tap delete
- [x] Recurring chores — `todo` has **no** recurrence support, so a repeat is a
      recurring calendar event (`RRULE`) on the person's chore schedule
      calendar, and a nightly automation materializes today's instances onto
      their list at 00:05. Set it from the add-a-chore dialog; cancel it from
      the board.
- [ ] iCloud sync via `vdirsyncer` against the `local_calendar` `.ics`

## Production topology

HA is client–server. The **server** is an always-on laptop running HA Container
in Docker; every screen is just a browser pointed at it
([ADR-0023](docs/DECISIONS.md#adr-0023)).

| Role | Device |
|---|---|
| Server | always-on laptop, HA Container in Docker |
| Wall touchscreen | Raspberry Pi, normal OS + Chromium kiosk |
| Tablets / phones | browsers |

The laptop is configured never to sleep, which is what makes a laptop viable as
a 24/7 server. Two things to know about running HA Container rather than HA OS:
**no add-on store** (Frigate-style camera software runs as its own container
beside HA), and **no one-click backups** (back up the `config/` volume on a
schedule — `local_calendar` and every chore live there). Migration to HA OS on
dedicated hardware later is a backup-restore, not a rebuild.
