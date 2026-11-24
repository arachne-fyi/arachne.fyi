package fyi.arachne.mod;

import static fyi.arachne.mod.Check.eq;
import static fyi.arachne.mod.Check.yes;

import fyi.arachne.mod.sync.EventQueue;
import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.sync.SyncClient;
import fyi.arachne.mod.tracking.Tracker;

import java.nio.file.Files;
import java.util.UUID;

/**
 * Talks to a real server. Skipped unless ARACHNE_TEST_ENDPOINT and ARACHNE_TEST_TOKEN are set:
 *
 * <pre>ARACHNE_TEST_ENDPOINT=http://localhost:8787 ARACHNE_TEST_TOKEN=al_... ./gradlew verifySync</pre>
 */
public final class SyncChecks {
    public static void main(String[] args) throws Exception {
        String endpoint = System.getenv("ARACHNE_TEST_ENDPOINT");
        String token = System.getenv("ARACHNE_TEST_TOKEN");
        if (endpoint == null || token == null) {
            System.out.println("SyncChecks: skipped (set ARACHNE_TEST_ENDPOINT and ARACHNE_TEST_TOKEN)");
            return;
        }
        Settings settings = new Settings();
        settings.endpoint = Settings.normalizeEndpoint(endpoint);
        settings.token = token;
        EventQueue queue = new EventQueue(Files.createTempDirectory("arachne-sync").resolve("queue.ndjson"));
        SyncClient sync = new SyncClient(settings, queue, "checks", "26.2", System::currentTimeMillis);
        String uuid = UUID.randomUUID().toString();
        String name = "JavaCheck";

        long now = System.currentTimeMillis() - 60_000;
        Tracker t = new Tracker(e -> sync.record(uuid, name, e));
        t.updateLocation(true, true, true, "Arachne's Sanctuary", "", now);
        t.message("JavaCheck placed an Arachne Crystal! Something is awakening!", name, now);
        t.message("[BOSS] Arachne: A befitting welcome!", name, now + 20_000);
        t.message("ARACHNE DOWN!", name, now + 30_000);
        t.message("Your Damage: 123,456", name, now + 30_300);
        t.observeStand(UUID.randomUUID(), "§9Soul String §8x3", now + 31_000);

        sync.setAccount(uuid, name, true, false);
        sync.start();
        SyncClient.Status status = sync.status();
        for (int i = 0; i < 40 && status.lastSuccessAt() == 0; i++) {
            Thread.sleep(250);
            status = sync.status();
        }
        sync.shutdown();
        eq(SyncClient.State.OK, status.state(), "sync state (" + status.message() + ")");
        eq(0, status.queued(), "queue drained");
        var account = status.totals().getAsJsonObject("account").getAsJsonObject("all");
        eq(1, account.get("kills").getAsInt(), "server counted the kill");
        eq(1, account.get("crystals").getAsInt(), "server counted the crystal");
        yes(account.get("uptimeMs").getAsLong() > 0, "server derived uptime");
        Check.done("SyncChecks");
    }
}
