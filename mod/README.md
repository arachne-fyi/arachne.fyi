# Arachne.fyi mod (v2)

Fabric client mod for Minecraft 26.2. It watches Arachne fights and sends what it sees to
an Arachne.fyi server, which prices everything and counts kills.

Not paired (no dashboard invite)? It still works: it keeps its own totals on your PC
(`local.json`), valued at Bazaar prices fetched from Hypixel's public API every 10 minutes
(NPC prices if that fails), and shows them on the HUD. Nothing is queued or sent until
you pair.

## Build

Needs JDK 25.

```bash
./gradlew build                 # build/libs/arachne-fyi-<version>+26.2.jar
./gradlew check                 # run the check suites (no game needed)
./gradlew publishToServer       # build and copy the jar to ../data/downloads for the dashboard
```

The first build downloads Gradle 9.6.0, Loom and Minecraft. The Minecraft-facing code is
checked against the 26.2 jar's API (screen and HUD state live on `Minecraft.gui`).

To check against a running server:

```bash
ARACHNE_TEST_ENDPOINT=http://localhost:8787 ARACHNE_TEST_TOKEN=al_... ./gradlew verifySync
```

## Commands

```
/arachne                              status: server, sync, queue, where tracking thinks you are
/arachne pair <code>                  connect with a six-letter code from the dashboard
/arachne pair <address> <token>       connect with a full token (the old way)
/arachne unpair
/arachne local reset                  clear the totals kept on this PC
/arachne hud minimal | normal | full  how much the HUD shows
/arachne debug on | off               HUD line saying where tracking thinks you are
/arachne updates on | off             check arachne.fyi for a newer build once per game start
/arachne report                       write report.txt for troubleshooting (no token in it)
/arachne pause | resume
/arachne hud on | off
/arachne hud move <x> <y>
/arachne scope everyone | me | account
/arachne window today | week | all
```

Files, in `.minecraft/config/arachnefyi/`:

- `settings.json`: server address, token, HUD choices
- `queue.ndjson`: events not yet sent (normally empty or a few lines; only used when paired)
- `local.json`: this PC's own totals (today, the last 8 days, all time)

## Code map

```
fyi/arachne/mod/
  client/     Minecraft-facing: entry point, commands, sidebar reading, item ids
    ArachneFyi   wires game events → Tracker → SyncClient
  tracking/   no Minecraft imports; tested by TrackerChecks
    Tracker         chat lines, holograms, pickups, purse → events
    Event           builds the JSON for each event kind (matches shared/src/events.ts)
  sync/       no Minecraft imports; tested by QueueChecks, SyncChecks
    EventQueue      on-disk queue
    SyncClient      background sender with backoff; keeps the latest totals
  skyblock/   message and hologram parsing, ported from v1.5.0
  ui/         HudText (what to show, tested) and Hud (drawing, the version-sensitive part)
  mixin/      PickupMixin: the item pickup packet
```

Ported from v1.5.0 with little or no change: `Messages`, `LootLabels`, `PetDrops`,
`LocationDetection`, `PurseCoins`, `LootDeduplicator`, `TrackingArea`, `GameContext`,
`ItemIds`, `PickupMixin`.
