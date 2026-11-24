package fyi.arachne.mod.sync;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Events waiting to be sent, kept on disk as {@code config/arachnefyi/queue.ndjson} so a
 * crash, a closed game or a server that is down for a week loses nothing.
 *
 * <p>Each line is {@code {"a": accountUuid, "n": accountName, "e": event}}. New events are
 * appended; once the server has answered for a batch, those lines are dropped by rewriting
 * the file. Because the server dedupes on event id, sending something twice is harmless,
 * so it never matters if the rewrite after a successful send is lost.
 *
 * <p>Owned by the sync thread: not thread-safe.
 */
public final class EventQueue {
    public record Entry(String account, String name, JsonObject event) {
        String id() {
            return event.get("id").getAsString();
        }
    }

    private final Path file;
    private final List<Entry> entries = new ArrayList<>();

    public EventQueue(Path file) {
        this.file = file;
        load();
    }

    private void load() {
        if (!Files.exists(file)) return;
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                if (line.isBlank()) continue;
                try {
                    JsonObject o = JsonParser.parseString(line).getAsJsonObject();
                    entries.add(new Entry(o.get("a").getAsString(), o.get("n").getAsString(), o.getAsJsonObject("e")));
                } catch (RuntimeException ignored) {
                    // A half-written last line after a crash; everything before it is fine.
                }
            }
        } catch (IOException ignored) {
            // Unreadable queue: start empty rather than refusing to track.
        }
    }

    public int size() {
        return entries.size();
    }

    public boolean isEmpty() {
        return entries.isEmpty();
    }

    public void add(Entry entry) throws IOException {
        entries.add(entry);
        Files.createDirectories(file.getParent());
        try (BufferedWriter out =
                Files.newBufferedWriter(
                        file, StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
            out.write(line(entry));
            out.write('\n');
        }
    }

    /**
     * The oldest events that share one account, up to {@code max}. A batch names a single
     * account, so a queue holding several accounts is drained one account at a time,
     * oldest first. Accounts in {@code skip} (refused by the server) are passed over.
     */
    public List<Entry> nextBatch(int max, Set<String> skip) {
        List<Entry> batch = new ArrayList<>();
        String account = null;
        for (Entry e : entries) {
            if (skip.contains(e.account())) continue;
            if (account == null) account = e.account();
            if (e.account().equals(account)) batch.add(e);
            if (batch.size() >= max) break;
        }
        return batch;
    }

    public void remove(Collection<Entry> done) throws IOException {
        if (done.isEmpty()) return;
        Set<String> ids = new HashSet<>();
        for (Entry e : done) ids.add(e.id());
        entries.removeIf(e -> ids.contains(e.id()));
        rewrite();
    }

    private void rewrite() throws IOException {
        Files.createDirectories(file.getParent());
        Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
        try (BufferedWriter out = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            for (Entry e : entries) {
                out.write(line(e));
                out.write('\n');
            }
        }
        Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private static String line(Entry e) {
        JsonObject o = new JsonObject();
        o.addProperty("a", e.account());
        o.addProperty("n", e.name());
        o.add("e", e.event());
        return o.toString();
    }
}
