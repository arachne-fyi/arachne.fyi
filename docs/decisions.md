# Decisions

What was decided for v2, and why. Change anything here freely; most choices are isolated to
one file.

## The open questions from the handover

**Local history or server-only?** The server is the only source of truth. The mod keeps an
offline queue on disk (`config/arachnefyi/queue.ndjson`) and nothing else. If the server
is down for a week, everything waits in the queue and is sent when it comes back. No local
lifetime history, so there is never a second set of numbers to disagree with the dashboard.

**Which in-game UI?** A HUD and `/arachne` commands. No screens. The dashboard is where the
in-depth view lives. It also keeps the mod free of text fields, which are fiddly to maintain
across Minecraft updates.

**Ironman pricing?** A per-account setting on the dashboard (an Ironman profile belongs to an
account, not a person). Next to it, each account picks Bazaar instant sell, Bazaar sell offer
or NPC. Every event stores all three unit prices at its timestamp, so switching re-values the
whole history instantly without touching events.

**Whose crystal placements count?** Only your own are costs and count for leaderboards.
Anyone's completed ritual still tells the mod the boss tier (Crystal or Calling), as in
v1.5.0.

**Leaderboards?** Profit, kills, crystals placed, calling pieces placed, rare drops (Tarantula
pets and Arachne's Fang), uptime and profit per client-hour, per person, for today / 7 days /
all time. Click a column to rank by it. Adding one is a column in `web/src/pages/Leaderboard.tsx`
plus, if it needs new data, a field in `server/src/stats.ts`.

## Rules (in `shared/src/rules.ts` and `shared/src/uptime.ts`)

- **Kill:** "Your Damage" of at least 10,000 within 5 seconds of "ARACHNE DOWN!". Same as v1.5.0.
- **Uptime:** a boss you damaged (any damage above 0) starts uptime at its spawn. A boss you
  did not damage stops it at that boss's spawn. No new boss within 30 s of the last death
  stops it at death + 30 s. Leaving mid-fight stops it at that moment.
  - "Damaged" means damage > 0, not the kill threshold, so a low-damage fight still counts
    as taking part.
  - A boss with no damage line at all counts as not damaged.
- **Combined uptime** is the sum across accounts (3 clients for 1 h = 3 h). Wall-clock uptime
  (time when at least one account was up) is shown next to it.
- **Two hourly rates**, always labelled: per client-hour (profit ÷ summed uptime, what one
  account averages) and per wall-clock hour (profit ÷ wall-clock uptime, what the group makes
  per real hour).
- **Crystal cost:** the value of Shaggy's recipe (2 Arachne Fragments, 16 Enchanted Spider
  Eyes, 16 Enchanted String) at the time it was placed. Calling fragments use their Bazaar
  price if listed, otherwise 0 for now.
- **"Today"** is the UTC day, matching the day files.

Because the server derives all of this from raw events, changing a rule and running
`npm run rebuild-index` applies it to all history.

## Architecture choices

- **Raw events only from the mod.** No prices, no kill flags, no uptime. Smaller trust
  surface, and rules can change without a new jar.
- **Client-generated UUID per event, deduped by the server.** Retries are free: the mod can
  resend anything it is unsure about.
- **NDJSON day files are the truth, SQLite is an index.** Files are named by the day they were
  received, so they are strictly append-only and old ones can be gzipped (after 2 days).
  `index.db` can be deleted and rebuilt; `state.db` (users, tokens, account settings) cannot,
  so back that one up.
- **Clock skew is corrected per batch** using the batch's `sentAt` (only when off by more than
  5 s). A PC with a wrong clock still lands events at the right time.
- **`node:sqlite`, not better-sqlite3.** Built into Node 22, so nothing native to compile on
  Windows or a Raspberry Pi. It still prints an "experimental" warning, which the start
  scripts silence.
- **Stats are computed on read**, with a 5-second cache. For a handful of friends this is
  milliseconds; it means no aggregate tables to keep in sync.
- **SSE, not WebSockets.** The dashboard only needs "something changed"; it then refetches.
  Works through Cloudflare Tunnel with a 20 s keep-alive comment.
- **Tokens and sessions are stored as SHA-256 hashes.** A full token is shown exactly once.
- **One token per person, any number of accounts.** The first batch from a Minecraft account
  claims it for the token's owner; another person's token is then refused for that account.
- **Open sign-up later:** the allowlist is one check in `Auth.login`. Making it open means
  creating a `user` row there instead of refusing.

## Things not verified (check before relying on them)

- **Target is Minecraft 26.2** (Fabric API `0.161.0+26.2`). The Minecraft-facing calls were
  checked against the real 26.2 jar (`gui.screen()`, `gui.hud.isHidden()`,
  `gui.hud.getTabList()`, `TeamColor.displaySlot()`, `TextColor.fromLegacyFormat`), and the
  mod builds, but it has not been run in game yet. `ui/Hud.java` is the only class that draws.
- **Hypixel's rules** on mods sending data to an external server.
- **Calling fragment price:** whether `ARACHNE_KEEPER_FRAGMENT` is a Bazaar product.

## The mod works without an invite (17 Nov 2026)

The server is still the only source of truth for shared numbers, but the mod now also keeps
its own totals on the PC (`local.json`) and shows them on the HUD when it is not paired.
Reason: the mod is public and the dashboard is invite only; people without an invite should
still get a working drop tracker. Unpaired, nothing is queued or sent, so `queue.ndjson`
cannot grow forever and "nothing leaves your PC" is true. Local values use Hypixel's public
Bazaar endpoint (instant sell) with NPC prices as the fallback; uptime is not computed
locally because the uptime rules need the whole fight history.

## People who are not invited (17 Nov 2026)

A Discord login from someone not on the allowlist is stored as an access request (Discord
has confirmed who they are), shown on the Admin page with Let in / Ignore. No public form,
so nobody can submit someone else's Discord ID.
