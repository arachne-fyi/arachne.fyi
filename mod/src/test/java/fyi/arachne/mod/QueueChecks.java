package fyi.arachne.mod;

import static fyi.arachne.mod.Check.eq;

import fyi.arachne.mod.sync.EventQueue;
import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.tracking.Event;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;

public final class QueueChecks {
    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("arachne-queue");
        Path file = dir.resolve("queue.ndjson");
        EventQueue q = new EventQueue(file);
        q.add(new EventQueue.Entry("a1", "One", Event.death(1, "f1")));
        q.add(new EventQueue.Entry("a2", "Two", Event.death(2, "f2")));
        q.add(new EventQueue.Entry("a1", "One", Event.death(3, "f3")));
        Files.writeString(file, Files.readString(file) + "{\"a\":\"a1\",\"n\":", java.nio.file.StandardOpenOption.TRUNCATE_EXISTING);

        EventQueue reloaded = new EventQueue(file);
        eq(3, reloaded.size(), "survives a restart and a torn last line");
        var batch = reloaded.nextBatch(10, Set.of());
        eq(2, batch.size(), "a batch holds one account");
        eq("a1", batch.get(0).account(), "oldest account first");
        eq(1, reloaded.nextBatch(10, Set.of("a1")).size(), "refused accounts are skipped");
        reloaded.remove(batch);
        eq(1, new EventQueue(file).size(), "removal is persisted");

        eq("https://app.arachne.fyi", Settings.normalizeEndpoint("app.arachne.fyi/"), "bare host gets https");
        eq("http://localhost:8787", Settings.normalizeEndpoint("http://localhost:8787"), "localhost may be http");
        boolean refused = false;
        try {
            Settings.normalizeEndpoint("http://example.com");
        } catch (IllegalArgumentException e) {
            refused = true;
        }
        eq(true, refused, "plain http to the internet is refused");
        eq(true, Settings.validToken("al_" + "A".repeat(43)), "token shape");
        eq(false, Settings.validToken("hello"), "junk token");
        Check.done("QueueChecks");
    }
}
