package fyi.arachne.mod.tracking;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.ToDoubleFunction;

/**
 * Totals kept on this PC, for people who use the mod without a dashboard invite (or before
 * pairing). Fed the same events the server would get; values drops with whatever prices
 * {@code price} knows (Bazaar if it could be fetched, else NPC). Stored in {@code local.json}.
 *
 * <p>Rules match the server's where they can: a kill is a damage line of 10,000 or more.
 * Uptime is not worked out here; the server's uptime rules need the whole fight history.
 *
 * <p>No Minecraft imports, so it is checked without the game ({@code LocalChecks}).
 */
public final class LocalLedger {
    public static final long KILL_DAMAGE = 10_000;
    private static final long DAY = 86_400_000L;
    private static final int KEEP_DAYS = 8;
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    /** One window's numbers. Public fields so Gson can save them as they are. */
    public static final class Totals {
        public long kills;
        public long fights;
        public long crystals;
        public long callings;
        public double lootValue;
        public double coins;
        public double costs;
        public Map<String, Long> drops = new TreeMap<>();

        public double profit() {
            return lootValue + coins - costs;
        }

        void add(Totals o) {
            kills += o.kills;
            fights += o.fights;
            crystals += o.crystals;
            callings += o.callings;
            lootValue += o.lootValue;
            coins += o.coins;
            costs += o.costs;
            o.drops.forEach((k, v) -> drops.merge(k, v, Long::sum));
        }
    }

    private static final class Saved {
        Totals all = new Totals();
        /** UTC day number → totals for that day. */
        Map<Long, Totals> days = new TreeMap<>();
    }

    private final Path file;
    private final ToDoubleFunction<String> price;
    private Saved saved;

    /** {@code price}: coins one of this item (or summon item) is worth right now. */
    public LocalLedger(Path file, ToDoubleFunction<String> price) {
        this.file = file;
        this.price = price;
        this.saved = load(file);
    }

    private static Saved load(Path file) {
        if (file == null) return new Saved();
        try {
            if (Files.exists(file)) {
                Saved s = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Saved.class);
                if (s != null && s.all != null && s.days != null) return s;
            }
        } catch (IOException | RuntimeException e) {
            // A broken file starts fresh rather than stopping the game.
        }
        return new Saved();
    }

    /** Count one event, as produced by {@link Tracker}. */
    public synchronized void record(JsonObject event) {
        long ts = event.has("ts") ? event.get("ts").getAsLong() : System.currentTimeMillis();
        Totals day = saved.days.computeIfAbsent(Math.floorDiv(ts, DAY), d -> new Totals());
        Totals one = new Totals();
        switch (event.get("kind").getAsString()) {
            case "DEATH" -> one.fights = 1;
            case "DAMAGE" -> {
                if (event.get("damage").getAsLong() >= KILL_DAMAGE) one.kills = 1;
            }
            case "PLACE" -> {
                String item = event.get("item").getAsString();
                long n = event.get("count").getAsLong();
                if (item.equals("ARACHNE_CRYSTAL")) one.crystals = n;
                else one.callings = n;
                one.costs = n * price.applyAsDouble(item);
            }
            case "LOOT" -> {
                String item = event.get("item").getAsString();
                long n = event.get("count").getAsLong();
                one.lootValue = n * price.applyAsDouble(item);
                one.drops.put(item, n);
            }
            case "COINS" -> one.coins = event.get("amount").getAsDouble();
            default -> {
                return;
            }
        }
        day.add(one);
        saved.all.add(one);
        long oldest = Math.floorDiv(ts, DAY) - KEEP_DAYS;
        saved.days.keySet().removeIf(d -> d < oldest);
        save();
    }

    public synchronized Totals today(long now) {
        Totals t = saved.days.get(Math.floorDiv(now, DAY));
        return t == null ? new Totals() : copy(t);
    }

    /** The last 7 UTC days including today, like the server's "7 days". */
    public synchronized Totals week(long now) {
        Totals sum = new Totals();
        long today = Math.floorDiv(now, DAY);
        saved.days.forEach((d, t) -> {
            if (d > today - 7) sum.add(t);
        });
        return sum;
    }

    public synchronized Totals all() {
        return copy(saved.all);
    }

    /** Forget everything (/arachne local reset). */
    public synchronized void reset() {
        saved = new Saved();
        save();
    }

    private static Totals copy(Totals t) {
        Totals c = new Totals();
        c.add(t);
        return c;
    }

    private void save() {
        if (file == null) return;
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, GSON.toJson(saved), StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            // Not saved this time; the next event tries again.
        }
    }

    /** Used by the checks: the per-day map, newest last. */
    synchronized Map<Long, Totals> days() {
        return new LinkedHashMap<>(saved.days);
    }
}
