# Dev environment setup

Gets Home Assistant running in Docker with `calendar.family` seeded, and the
calendar bundle served from it. Build and HA live on the **same machine**, so
`vite build` writes directly into HA's `config/www/` — there is no deploy step.

The HA instance is **Nolanhaus** — the household's smart home. This calendar is
its first tenant, not its purpose; cameras and automation move in later.
Compose project: `nolanhaus`. Container: `nolanhaus-ha-dev`.

This same Docker setup is **both dev and production** — the always-on laptop is
the real server ([ADR-0023]). It's **HA Container**, so there's **no Supervisor
and no add-on store** ([ADR-0011]); that's not a dev quirk, it's permanent. Two
consequences worth remembering as the house grows: add-on-style software
(Frigate for cameras) runs as its own container beside HA, and there are no
one-click backups — schedule a backup of the `config/` volume, since
`local_calendar` and every chore live there.

---

## Prerequisites

- **Docker.** Docker Desktop on Windows/macOS (launch it, wait for the whale
  icon to settle), or `curl -fsSL https://get.docker.com | sh` on Linux.
- **Node 20+.**

Verify Docker is actually alive before going further. If this errors, nothing
below will work:

```bash
docker info
```

---

## 0. One-time: fix the Node shim (this machine only)

`node@21.2.0` is installed as a **global npm package**. Its shim shadows the
real Node whenever npm shells out, so `npm run build` dies with
`'"node"' is not recognized`.

```bash
npm rm -g node
```

Until you do, substitute `node node_modules/vite/bin/vite.js build` for
`npm run build`, and `node node_modules/typescript/bin/tsc --noEmit` for
`npm run typecheck`.

---

## 1. Install dependencies and build

Build **before** first starting HA. `configuration.yaml` declares a
`panel_custom` pointing at `/local/hacalendar/panel.js`; if that file doesn't
exist yet you get a dead sidebar item and a confusing 404.

```bash
npm install
npm run build          # writes dev/config/www/hacalendar/
```

`dev/config/www/` is gitignored, so a fresh clone always needs this step.

---

## 2. Start Home Assistant

```bash
npm run ha:up          # docker compose -f dev/docker-compose.yml up -d
npm run ha:logs        # Ctrl-C once you see "Home Assistant initialized"
```

First run pulls ~1.5 GB. Give it a few minutes.

### What the compose file says

`dev/docker-compose.yml`:

```yaml
name: nolanhaus

services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    container_name: nolanhaus-ha-dev
    volumes:
      - ./config:/config
    ports:
      - "8123:8123"
    restart: unless-stopped
    environment:
      - TZ=America/Chicago
```

`TZ` is load-bearing, not cosmetic. All-day events are date-only strings, and
`new Date("2026-07-09")` parses as **UTC midnight** — which in Central is
July 8th. Get this wrong and every date assertion you make is worthless.

### What the config says

`dev/config/configuration.yaml`:

```yaml
homeassistant:
  name: Nolanhaus

default_config:

http:
  cors_allowed_origins:
    - http://localhost:5173      # lets `npm run dev` reach this instance

panel_custom:
  - name: hacalendar-panel       # MUST equal the tag in src/panel.ts
    sidebar_title: Family Calendar
    sidebar_icon: mdi:calendar-heart
    url_path: family-calendar
    module_url: /local/hacalendar/panel.js
    require_admin: false
    config:
      entity_id: calendar.family
```

HA reads `panel_custom` **only at startup**. Edit this file, and you must
`docker compose -f dev/docker-compose.yml restart`.

---

## 3. Onboard

Open http://localhost:8123

1. Create the owner account. Anything; it's disposable.
2. **Set the timezone to US/Central.**

HA asks for the timezone separately during onboarding and does **not** reliably
inherit the container's `TZ`. If the two disagree, date bugs later will be
untraceable. Check both.

---

## 4. Create the calendar

**Settings → Devices & Services → Add Integration → "Local Calendar"** → name it
`Family`. That yields `calendar.family`.

This must be done through the UI. `local_calendar` is **config-flow only** and
cannot be created from YAML. There is no scripted path.

For Phase 1 you need only `Family`. At Phase 1.5 (multi-calendar overlay,
[ADR-0017]) add one per person: `Mom` → `calendar.mom`, and so on.

---

## 5. Seed events that actually exercise the bugs

In HA's built-in **Calendar** panel, add to `calendar.family`:

| Event | What it catches |
|---|---|
| A timed event today, 3:00–4:00pm | baseline; catches nothing |
| **All-day, on the 1st of a month** | UTC-midnight parsing — would render in the *previous month* |
| **All-day, on the last day of a month** | same bug, other edge |
| Multi-day event spanning 3 days | exclusive-end handling |
| Weekly recurring event | `rrule` expansion in the subscribe payload |

The two all-day boundary events are the entire point. A timed event proves
almost nothing.

---

## 6. Verify both mount points

```bash
docker compose -f dev/docker-compose.yml restart   # picks up panel_custom
```

- **Panel:** http://localhost:8123/family-calendar
- **Standalone:** http://localhost:8123/local/hacalendar/index.html

> **HA caches `/local/` hard.** When `panel.js` changes and the browser ignores
> it, that's the cache, not your build. Hard-refresh, or bump `module_url` to
> `panel.js?v=2`. You will lose ten minutes to this at least once.

---

## 7. Iterating

`npm run watch` rebuilds into HA's `www/` on every change. Refresh to see it.
This matches production exactly.

For HMR instead:

```bash
npm run dev            # http://localhost:5173
```

Get a token: **HA → profile → Security → Long-lived access tokens → Create**.
Then open once:

```
http://localhost:5173/?ha=http://localhost:8123&token=<TOKEN>
```

It persists to `localStorage`. `cors_allowed_origins` already permits `:5173`.

> **Auth tradeoff** ([ADR-0007]): the standalone page keeps a long-lived token
> in `localStorage` — full HA API access. Fine on a trusted LAN, never on the
> open internet.

---

## Verifying a change

```bash
npm run typecheck
npm run build

# Chrome 87 floor -- must print nothing
cd dev/config/www/hacalendar && \
  grep -oE '\.at\(|Object\.hasOwn|structuredClone|\.replaceAll\(|\.findLast\(|\.toSorted\(|:has\(|:is\(|:where\(|@container' *.js chunks/*.js
```

A green typecheck and a clean build are **not** evidence a feature works. The
websocket schemas in `src/ha/calendar.ts` were transcribed from HA's Python
source, never confirmed against a live round trip. Drive the real UI.

---

## Common commands

```bash
npm run ha:up          # start
npm run ha:down        # stop
npm run ha:logs        # follow logs
docker compose -f dev/docker-compose.yml restart    # after editing configuration.yaml
docker logs -f nolanhaus-ha-dev                     # logs by container name
```

Start over completely: `npm run ha:down`, then delete everything in
`dev/config/` except `configuration.yaml`. (`.gitignore` is already set up that
way, so `git clean -xdf dev/config` does it.)

---

## Troubleshooting

**`'"node"' is not recognized`** — step 0.

**`docker client must be run with elevated privileges`** — Docker Desktop isn't
running. Start it and wait for the daemon. On Windows, a healthy Docker Desktop
using the WSL2 backend registers a `docker-desktop` distro; check with
`wsl --list --verbose`. If it's missing, the install never provisioned.

**Sidebar item missing** — `name:` in `configuration.yaml` must equal the tag in
`src/panel.ts` (`hacalendar-panel`). HA reads `panel_custom` only at startup;
restart the container.

**Sidebar item present, panel blank** — `panel.js` 404s. Did you run
`npm run build`? `dev/config/www/` is gitignored.

**Panel loads, no events** — check the entity id in **Developer Tools → States**.
The panel defaults to `calendar.family`.

**Events land a day early** — the UTC-midnight bug in `parseHaDate()`. This is
what Phase 1 exists to catch. Check that HA's onboarding timezone and the
container's `TZ` agree.

[ADR-0006]: DECISIONS.md#adr-0006
[ADR-0007]: DECISIONS.md#adr-0007
[ADR-0011]: DECISIONS.md#adr-0011
[ADR-0017]: DECISIONS.md#adr-0017
