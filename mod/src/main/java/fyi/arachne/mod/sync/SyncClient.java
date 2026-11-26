package fyi.arachne.mod.sync;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import fyi.arachne.mod.skyblock.Lobby;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.LongSupplier;

/**
 * Sends queued events to the server and keeps the latest totals for the HUD.
 *
 * <p>Everything here runs on one background thread ("arachne-sync"), so the game thread never
 * waits on the disk or the network. The game thread only calls {@link #record}, {@link
 * #setAccount} and reads {@link #status()}.
 *
 * <p>Sending rules:
 *
 * <ul>
 *   <li>A batch goes out every 30 seconds (the server can change that in its reply), or
 *       sooner once 200 events are waiting.
 *   <li>While the player is in SkyBlock an empty batch still goes out, so the HUD's totals
 *       and the dashboard's "online" stay current.
 *   <li>On a network error or a 5xx the queue is kept and retried after 15s, 30s, 1m ... up
 *       to 5 minutes.
 *   <li>A boss spawn or death also goes out at once as its own small packet ({@link #live}),
 *       so the website's fight timer starts and stops on time. Every account in the fight
 *       sends one; the server agrees on the time from all of them. After a death the next
 *       batch goes out within a few seconds, so loot and damage follow quickly.
 *   <li>A rejected token stops sending until the player pairs again. An account the server
 *       says belongs to someone else is skipped; its events stay queued.
 * </ul>
 */
public final class SyncClient {
    public enum State {
        NOT_PAIRED,
        OK,
        OFFLINE,
        BAD_TOKEN,
        PAUSED
    }

    /** What the HUD and /arachne status show. Replaced as a whole, so reads need no lock. */
    public record Status(
            State state,
            int queued,
            long lastSuccessAt,
            long retryAt,
            String message,
            JsonObject totals,
            int online) {}

    private static final int MAX_BATCH = 500;
    private static final int SEND_EARLY_AT = 200;
    private static final long DEFAULT_POLL_MS = 30_000;
    private static final long MIN_BACKOFF_MS = 15_000;
    private static final long MAX_BACKOFF_MS = 5 * 60_000;
    /** After a death, flush the batch this soon so loot and damage reach the website quickly. */
    private static final long AFTER_DEATH_MS = 6_000;

    private final EventQueue queue;
    private final String modVersion;
    private final String minecraftVersion;
    private final LongSupplier clock;
    private final HttpClient http;
    private final ScheduledExecutorService thread;

    // Written by the game thread, read by the sync thread.
    private volatile Settings settings;
    private volatile String accountUuid;
    private volatile String accountName;
    private volatile JsonObject clientState;

    // Sync-thread state.
    private final Set<String> refusedAccounts = ConcurrentHashMap.newKeySet();
    /** Tier of each recent fight, so a death packet carries the same boss key as its spawn. */
    private final Map<String, String> fightTiers = new ConcurrentHashMap<>();
    private long nextSendAt;
    private long backoffMs;
    private volatile boolean tokenRejected;
    private volatile Status status;

    public SyncClient(Settings settings, EventQueue queue, String modVersion, String minecraftVersion, LongSupplier clock) {
        this.settings = settings;
        this.queue = queue;
        this.modVersion = modVersion;
        this.minecraftVersion = minecraftVersion;
        this.clock = clock;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        this.thread =
                Executors.newSingleThreadScheduledExecutor(
                        r -> {
                            Thread t = new Thread(r, "arachne-sync");
                            t.setDaemon(true);
                            return t;
                        });
        this.status = new Status(settings.paired() ? State.OK : State.NOT_PAIRED, queue.size(), 0, 0, "", null, 0);
    }

    public void start() {
        thread.scheduleWithFixedDelay(this::tick, 1, 1, TimeUnit.SECONDS);
    }

    /** Send what is queued, then stop. Called when the game closes. */
    public void shutdown() {
        thread.execute(() -> {
            if (canSend()) sendOnce(clock.getAsLong());
        });
        thread.shutdown();
        try {
            thread.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public Status status() {
        return status;
    }

    // ---- called from the game thread -------------------------------------------------------

    /** Queue one event for an account. Written to disk on the sync thread. */
    public void record(String account, String name, JsonObject event) {
        thread.execute(() -> {
            try {
                queue.add(new EventQueue.Entry(account, name, event));
            } catch (IOException e) {
                setStatus(status.state(), "Could not write the event queue: " + e.getMessage());
            }
        });
    }

    /**
     * Send a SPAWN or DEATH straight away, apart from the batch. Best effort: it does not wait,
     * is not retried, and the same event still goes out in the next batch, which stays the
     * record. {@code lobby} is the Hypixel server id, or null when unknown; only a hash of it
     * is sent.
     */
    public void live(String account, String name, JsonObject event, String lobby) {
        String kind = event.has("kind") ? event.get("kind").getAsString() : "";
        if (!kind.equals("SPAWN") && !kind.equals("DEATH")) return;
        if (account == null || !canSend() || refusedAccounts.contains(account)) return;
        long now = clock.getAsLong();
        String fight = event.get("fight").getAsString();
        String tier;
        if (kind.equals("SPAWN")) {
            tier = event.has("tier") ? event.get("tier").getAsString() : null;
            if (tier != null) {
                if (fightTiers.size() > 64) fightTiers.clear();
                fightTiers.put(fight, tier);
            }
        } else {
            tier = fightTiers.remove(fight);
            thread.execute(() -> nextSendAt = Math.min(nextSendAt, clock.getAsLong() + AFTER_DEATH_MS));
        }

        JsonObject body = new JsonObject();
        body.addProperty("schema", 1);
        JsonObject who = new JsonObject();
        who.addProperty("uuid", account);
        who.addProperty("name", name);
        body.add("account", who);
        JsonObject mod = new JsonObject();
        mod.addProperty("version", modVersion);
        mod.addProperty("minecraft", minecraftVersion);
        body.add("mod", mod);
        body.addProperty("sentAt", now);
        body.addProperty("kind", kind);
        body.addProperty("ts", event.get("ts").getAsLong()); // epoch ms, UTC
        body.addProperty("fight", fight);
        if (tier != null) body.addProperty("tier", tier);
        String key = Lobby.key(lobby, tier);
        if (key != null) body.addProperty("key", key);

        Settings s = settings;
        try {
            HttpRequest req =
                    HttpRequest.newBuilder(URI.create(s.endpoint + "/api/v1/live"))
                            .timeout(Duration.ofSeconds(5))
                            .header("Authorization", "Bearer " + s.token)
                            .header("Content-Type", "application/json")
                            .header("User-Agent", userAgent())
                            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                            .build();
            // Async: the game thread never waits, and a batch already in flight does not delay it.
            http.sendAsync(req, HttpResponse.BodyHandlers.discarding());
        } catch (RuntimeException e) {
            // A bad endpoint: the batch path reports it.
        }
    }

    /** The account in use right now, or null when not in SkyBlock. Drives heartbeats. */
    public void setAccount(String uuid, String name, boolean inArea, boolean fighting) {
        this.accountUuid = uuid;
        this.accountName = name;
        JsonObject state = new JsonObject();
        state.addProperty("inArea", inArea);
        state.addProperty("fighting", fighting);
        state.addProperty("queued", status.queued());
        this.clientState = state;
    }

    /** New endpoint/token or pause state. Clears a previous bad-token stop. */
    public void updateSettings(Settings next) {
        this.settings = next;
        thread.execute(() -> {
            tokenRejected = false;
            refusedAccounts.clear();
            backoffMs = 0;
            nextSendAt = 0;
            setStatus(next.paired() ? State.OK : State.NOT_PAIRED, "");
        });
    }

    /** Ask the server who a token belongs to, without sending events. */
    public void whoami(String endpoint, String token, Consumer<String> result) {
        thread.execute(() -> {
            try {
                HttpRequest req =
                        HttpRequest.newBuilder(URI.create(endpoint + "/api/v1/whoami"))
                                .timeout(Duration.ofSeconds(15))
                                .header("Authorization", "Bearer " + token)
                                .header("User-Agent", userAgent())
                                .GET()
                                .build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() == 200) {
                    String user = JsonParser.parseString(res.body()).getAsJsonObject().get("user").getAsString();
                    result.accept("Paired. This token belongs to " + user + ".");
                } else if (res.statusCode() == 401) {
                    result.accept("The server does not know that token. Copy it again from the dashboard.");
                } else {
                    result.accept("The server answered " + res.statusCode() + ". Is that the right address?");
                }
            } catch (IOException | RuntimeException e) {
                result.accept("Could not reach " + endpoint + " (" + describe(e) + "). Saved anyway; it will keep trying.");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }

    // ---- sync thread ---------------------------------------------------------------------

    private boolean canSend() {
        Settings s = settings;
        return s.paired() && !s.paused && !tokenRejected;
    }

    private void tick() {
        long now = clock.getAsLong();
        Settings s = settings;
        if (!s.paired()) {
            setStatus(State.NOT_PAIRED, "");
            return;
        }
        if (s.paused) {
            setStatus(State.PAUSED, "");
            return;
        }
        if (tokenRejected) return;
        boolean due = now >= nextSendAt;
        boolean full = queue.nextBatch(SEND_EARLY_AT, refusedAccounts).size() >= SEND_EARLY_AT && backoffMs == 0;
        if (due || full) sendOnce(now);
        else if (status.queued() != queue.size()) setStatus(status.state(), status.message());
    }

    private void sendOnce(long now) {
        List<EventQueue.Entry> batch = queue.nextBatch(MAX_BATCH, refusedAccounts);
        String uuid;
        String name;
        if (!batch.isEmpty()) {
            uuid = batch.get(0).account();
            name = batch.get(0).name();
        } else if (accountUuid != null && !refusedAccounts.contains(accountUuid)) {
            uuid = accountUuid; // heartbeat: nothing queued, but fetch fresh totals
            name = accountName;
        } else {
            nextSendAt = now + DEFAULT_POLL_MS;
            setStatus(State.OK, "");
            return;
        }

        JsonObject body = new JsonObject();
        body.addProperty("schema", 1);
        JsonObject account = new JsonObject();
        account.addProperty("uuid", uuid);
        account.addProperty("name", name);
        body.add("account", account);
        JsonObject mod = new JsonObject();
        mod.addProperty("version", modVersion);
        mod.addProperty("minecraft", minecraftVersion);
        body.add("mod", mod);
        body.addProperty("sentAt", clock.getAsLong());
        if (uuid.equals(accountUuid) && clientState != null) body.add("state", clientState);
        JsonArray events = new JsonArray();
        for (EventQueue.Entry e : batch) events.add(e.event());
        body.add("events", events);

        Settings s = settings;
        try {
            HttpRequest req =
                    HttpRequest.newBuilder(URI.create(s.endpoint + "/api/v1/batch"))
                            .timeout(Duration.ofSeconds(20))
                            .header("Authorization", "Bearer " + s.token)
                            .header("Content-Type", "application/json")
                            .header("User-Agent", userAgent())
                            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                            .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            handle(res.statusCode(), res.body(), batch, uuid, now);
        } catch (IOException | RuntimeException e) {
            retryLater(now, "Server unreachable (" + describe(e) + ")");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void handle(int code, String body, List<EventQueue.Entry> batch, String uuid, long now) throws IOException {
        if (code == 200) {
            JsonObject reply = JsonParser.parseString(body).getAsJsonObject();
            // Accepted, duplicate and rejected events are all settled: none should be resent.
            queue.remove(batch);
            backoffMs = 0;
            long poll = reply.has("nextPollMs") ? reply.get("nextPollMs").getAsLong() : DEFAULT_POLL_MS;
            nextSendAt = now + Math.max(5_000, poll);
            String message = "";
            JsonArray rejected = reply.getAsJsonArray("rejected");
            if (rejected != null && !rejected.isEmpty()) {
                JsonElement first = rejected.get(0).getAsJsonObject().get("reason");
                message = rejected.size() + " event(s) refused by the server: " + (first == null ? "?" : first.getAsString());
            }
            // Only keep totals for the account currently being played, so the HUD never shows
            // another account's numbers after a queue drain.
            JsonObject totals = reply.getAsJsonObject("totals");
            // Today's place on the leaderboard rides along with the totals, for the HUD.
            if (totals != null && reply.has("rank") && reply.get("rank").isJsonObject()) totals.add("rank", reply.get("rank"));
            // Soul String / Spider Essence counts and the group tag ride along the same way.
            if (totals != null && reply.has("focus") && reply.get("focus").isJsonObject()) totals.add("focus", reply.get("focus"));
            if (totals != null && reply.has("groupTag") && reply.get("groupTag").isJsonPrimitive()) totals.add("groupTag", reply.get("groupTag"));
            boolean current = uuid.equals(accountUuid) || status.totals() == null;
            status =
                    new Status(
                            State.OK,
                            queue.size(),
                            now,
                            0,
                            message,
                            current ? totals : status.totals(),
                            reply.has("online") ? reply.get("online").getAsInt() : status.online());
            return;
        }
        String error = errorCode(body);
        if (code == 401) {
            tokenRejected = true;
            setStatus(State.BAD_TOKEN, "The server refused the token. Pair again with a new one from the dashboard.");
        } else if (code == 403 && "account_owned_by_other_user".equals(error)) {
            refusedAccounts.add(uuid);
            setStatus(State.OK, "This Minecraft account is paired to someone else on the server; its events stay queued.");
        } else if (code == 403 && "read_only".equals(error)) {
            // Offline dev mode (start-offline.bat) saves nothing. Keep the queue and wait long.
            backoffMs = MAX_BACKOFF_MS;
            nextSendAt = now + backoffMs;
            setStatus(State.OFFLINE, "That server is read only (offline dev mode). Pair with one started by start.bat.");
        } else if (code == 400) {
            // The whole batch was malformed. Retrying unchanged would fail forever, so wait long.
            backoffMs = MAX_BACKOFF_MS;
            nextSendAt = now + backoffMs;
            setStatus(State.OFFLINE, "The server refused the batch (" + error + "). Is the mod out of date?");
        } else {
            retryLater(now, "Server answered " + code);
        }
    }

    private void retryLater(long now, String why) {
        backoffMs = backoffMs == 0 ? MIN_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, backoffMs * 2);
        nextSendAt = now + backoffMs;
        status = new Status(State.OFFLINE, queue.size(), status.lastSuccessAt(), nextSendAt, why, status.totals(), status.online());
    }

    private void setStatus(State state, String message) {
        Status s = status;
        status = new Status(state, queue.size(), s.lastSuccessAt(), s.retryAt(), message, s.totals(), s.online());
    }

    private String userAgent() {
        return "ArachneFyi/" + modVersion + " (Minecraft " + minecraftVersion + ")";
    }

    private static String errorCode(String body) {
        try {
            return JsonParser.parseString(body).getAsJsonObject().get("error").getAsString();
        } catch (RuntimeException e) {
            return "unknown";
        }
    }

    private static String describe(Exception e) {
        String m = e.getMessage();
        return e.getClass().getSimpleName() + (m == null || m.isBlank() ? "" : ": " + m);
    }
}
