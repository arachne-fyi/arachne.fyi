# Arachne.fyi v2

A Fabric mod for Hypixel SkyBlock that records Arachne fights on every Minecraft account you
run, a server that adds all of it up, and a live dashboard for you and a few friends.

```
 Minecraft (mod)                    server                          browser
 ┌─────────────────┐  POST batch   ┌──────────────────────────┐ SSE ┌───────────┐
 │ chat, holograms,│ ────────────► │ validate → NDJSON → SQLite│ ──► │ dashboard │
 │ pickups, purse  │ ◄──────────── │ prices, kills, uptime     │     └───────────┘
 │ → raw events    │  totals reply └──────────────────────────┘
 └─────────────────┘   (HUD)              ▲ Bazaar every 5 min
```

| Folder    | What it is                                                     | Language            |
| --------- | -------------------------------------------------------------- | ------------------- |
| `shared/` | The event format and the game rules (kills, uptime). One copy. | TypeScript + zod    |
| `server/` | API, storage, pricing, stats, Discord login, live updates      | TypeScript, Fastify |
| `web/`    | Dashboard and the arachne.fyi landing page                     | React, Vite         |
| `mod/`    | Fabric client mod for Minecraft 26.2                           | Java 25             |
| `docs/`   | Decisions, architecture, hosting                               | Markdown            |

## Run it locally (no Minecraft needed)

Needs Node 22.13 or newer.

```bash
npm install
cp .env.example .env          # DEV_AUTH=1 is already on, so no Discord setup yet
npm run dev                   # server on :8787, dashboard on http://localhost:5173
```

Open http://localhost:5173 and log in with any name (the first one becomes admin). Then, in
another terminal, pretend to be three Minecraft clients:

```bash
npm run simulate -- --dev     # 6 hours of backfill, then a live boss every ~35s
```

Other commands:

```bash
npm test                      # shared rule tests + server API tests
npm run typecheck
npm run build                 # production build of web + server
npm start                     # serve the built dashboard and API on :8787
npm run rebuild-index         # rebuild data/index.db from the NDJSON files (server stopped)
```

## The mod

See [`mod/README.md`](mod/README.md). Short version: `cd mod && ./gradlew build`, put the jar in
`mods/`, make a token on the dashboard's **Pair the mod** page, then in game:

```
/arachne pair https://app.arachne.fyi al_xxxxxxxx
```

## Hosting

[`docs/hosting.md`](docs/hosting.md): Docker, Cloudflare Tunnel, Discord login, backups.

## Where to start reading

1. [`docs/decisions.md`](docs/decisions.md): every choice made for v2 and why.
2. [`shared/src/events.ts`](shared/src/events.ts): the contract. Everything else follows from it.
3. [`server/src/ingest.ts`](server/src/ingest.ts): what happens to a batch.
4. [`mod/src/main/java/fyi/arachne/mod/tracking/Tracker.java`](mod/src/main/java/fyi/arachne/mod/tracking/Tracker.java):
   how chat lines become events.
