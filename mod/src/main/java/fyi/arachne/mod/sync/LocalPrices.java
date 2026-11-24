package fyi.arachne.mod.sync;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Prices for the mod's own totals when it is not paired with a server. Asks Hypixel's public
 * Bazaar endpoint (no API key needed) at most every 10 minutes, on a background thread, and
 * only while something asks for a price. Items not on the Bazaar use their NPC sell price,
 * the same table as the server's {@code NPC_PRICES}.
 *
 * <p>A paired mod never calls this: the server values everything.
 */
public final class LocalPrices {
    private static final String URL = "https://api.hypixel.net/v2/skyblock/bazaar";
    private static final long REFRESH_MS = 10 * 60_000L;

    /** NPC / George values; keep in step with shared/src/catalog.ts. */
    static final Map<String, Double> NPC =
            Map.ofEntries(
                    Map.entry("SOUL_STRING", 5_000.0),
                    Map.entry("ARACHNE_FRAGMENT", 500.0),
                    Map.entry("ENCHANTED_STRING", 576.0),
                    Map.entry("ENCHANTED_SPIDER_EYE", 480.0),
                    Map.entry("STRING", 3.0),
                    Map.entry("SPIDER_EYE", 3.0),
                    Map.entry("DARK_QUEENS_SOUL_DROP", 5_000.0),
                    Map.entry("ARACHNE_HELMET", 2_000.0),
                    Map.entry("ARACHNE_CHESTPLATE", 2_000.0),
                    Map.entry("ARACHNE_LEGGINGS", 2_000.0),
                    Map.entry("ARACHNE_BOOTS", 2_000.0),
                    Map.entry("LUXURIOUS_SPOOL", 1.0),
                    Map.entry("ARACHNE_FANG", 500.0),
                    Map.entry("ARACK", 5_000.0),
                    Map.entry("TARANTULA_EPIC", 2_000.0),
                    Map.entry("TARANTULA_LEGENDARY", 100_000.0));

    /** Shaggy's crystal: 2 Arachne Fragment, 16 Enchanted Spider Eye, 16 Enchanted String. */
    static final Map<String, Integer> CRYSTAL_RECIPE =
            Map.of("ARACHNE_FRAGMENT", 2, "ENCHANTED_SPIDER_EYE", 16, "ENCHANTED_STRING", 16);

    private final Map<String, Double> bazaar = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private volatile long fetchedAt;
    private volatile long triedAt;
    private volatile boolean fetching;

    /** Coins one of {@code item} is worth: Bazaar instant sell, or NPC price. */
    public double price(String item) {
        refreshIfOld();
        if (item.equals("ARACHNE_CRYSTAL")) {
            double total = 0;
            for (var e : CRYSTAL_RECIPE.entrySet()) total += e.getValue() * price(e.getKey());
            return total;
        }
        Double b = bazaar.get(item);
        if (b != null && b > 0) return b;
        return NPC.getOrDefault(item, 0.0);
    }

    public boolean live() {
        return fetchedAt > 0;
    }

    private void refreshIfOld() {
        long now = System.currentTimeMillis();
        if (fetching || now - triedAt < REFRESH_MS) return;
        fetching = true;
        triedAt = now;
        Thread t =
                new Thread(
                        () -> {
                            try {
                                var res =
                                        http.send(
                                                HttpRequest.newBuilder(URI.create(URL)).timeout(Duration.ofSeconds(20)).GET().build(),
                                                HttpResponse.BodyHandlers.ofString());
                                if (res.statusCode() == 200) {
                                    parse(JsonParser.parseString(res.body()).getAsJsonObject(), bazaar);
                                    fetchedAt = System.currentTimeMillis();
                                }
                            } catch (Exception e) {
                                // Offline or Hypixel down: NPC prices until the next try.
                            } finally {
                                // Tried; the next try is 10 minutes after this one either way.
                                fetching = false;
                            }
                        },
                        "arachne-fyi-prices");
        t.setDaemon(true);
        t.start();
    }

    /** Pull quick_status.sellPrice (what instant-selling pays) for the items we care about. */
    static void parse(JsonObject root, Map<String, Double> into) {
        if (!root.has("success") || !root.get("success").getAsBoolean()) return;
        JsonObject products = root.getAsJsonObject("products");
        var ids = new java.util.HashSet<>(NPC.keySet());
        ids.add("ARACHNE_KEEPER_FRAGMENT"); // Arachne's Calling, if the Bazaar lists it
        for (String id : ids) {
            JsonObject p = products.getAsJsonObject(id);
            if (p == null) continue;
            JsonElement sell = p.getAsJsonObject("quick_status").get("sellPrice");
            if (sell != null && sell.getAsDouble() > 0) into.put(id, sell.getAsDouble());
        }
    }
}
