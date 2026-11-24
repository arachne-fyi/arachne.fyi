package fyi.arachne.mod;

import static fyi.arachne.mod.Check.eq;
import static fyi.arachne.mod.Check.yes;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.sync.SyncClient;
import fyi.arachne.mod.tracking.LocalLedger;
import fyi.arachne.mod.ui.HudText;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/** The totals kept on this PC for people who are not paired with a server. */
public final class LocalChecks {
    private static JsonObject ev(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("arachne-local");
        Path file = dir.resolve("local.json");
        Map<String, Double> prices = Map.of("ARACHNE_CRYSTAL", 100_000.0, "SOUL_STRING", 20_000.0);
        LocalLedger ledger = new LocalLedger(file, item -> prices.getOrDefault(item, 0.0));

        long day = 86_400_000L;
        long t = 20_000 * day + 3_600_000; // 01:00 UTC on some day
        ledger.record(ev("{\"kind\":\"PLACE\",\"ts\":" + t + ",\"item\":\"ARACHNE_CRYSTAL\",\"count\":1}"));
        ledger.record(ev("{\"kind\":\"DEATH\",\"ts\":" + (t + 30_000) + ",\"fight\":\"f1\"}"));
        ledger.record(ev("{\"kind\":\"DAMAGE\",\"ts\":" + (t + 30_400) + ",\"fight\":\"f1\",\"damage\":250000}"));
        ledger.record(ev("{\"kind\":\"LOOT\",\"ts\":" + (t + 31_000) + ",\"item\":\"SOUL_STRING\",\"count\":6,\"source\":\"armor_stand\"}"));
        ledger.record(ev("{\"kind\":\"COINS\",\"ts\":" + (t + 31_000) + ",\"amount\":1500,\"source\":\"scavenger\"}"));
        // Not enough damage: a fight, not a kill.
        ledger.record(ev("{\"kind\":\"DEATH\",\"ts\":" + (t + 90_000) + ",\"fight\":\"f2\"}"));
        ledger.record(ev("{\"kind\":\"DAMAGE\",\"ts\":" + (t + 90_400) + ",\"fight\":\"f2\",\"damage\":9999}"));
        // Yesterday counts for the week and all time, not today.
        ledger.record(ev("{\"kind\":\"LOOT\",\"ts\":" + (t - day) + ",\"item\":\"SOUL_STRING\",\"count\":1,\"source\":\"pickup\"}"));

        long now = t + 100_000;
        var today = ledger.today(now);
        eq(1L, today.kills, "one kill today");
        eq(2L, today.fights, "two fights today");
        eq(1L, today.crystals, "one crystal");
        eq(120_000.0 + 1_500 - 100_000, today.profit(), "profit = loot + coins - crystal");
        eq(6L, today.drops.get("SOUL_STRING"), "drop count");
        eq(140_000.0 + 1_500 - 100_000, ledger.week(now).profit(), "week includes yesterday");
        eq(ledger.week(now).profit(), ledger.all().profit(), "all time matches here");

        // Saved and loaded back.
        LocalLedger again = new LocalLedger(file, item -> 0.0);
        eq(1L, again.today(now).kills, "kills survive a restart");
        eq(7L, again.all().drops.get("SOUL_STRING"), "drops survive a restart");

        // HUD when not paired: local numbers and no "pair" nagging.
        var status = new SyncClient.Status(SyncClient.State.NOT_PAIRED, 0, 0, 0, "", null, 0);
        var lines = HudText.build(new Settings(), status, again, false, 0, now).stream().map(HudText.Line::text).toList();
        eq("Profit 21.5k", lines.get(1), "local profit line");
        eq("Scavenger 1,500 coins", lines.get(2), "local scavenger line");
        eq("6 Soul String, 0 Spider Essence", lines.get(3), "local focus line (today only)");
        eq("1 kill, 1 crystal", lines.get(4), "local kills line");
        eq("On this PC only", lines.get(lines.size() - 1), "says it is local");
        yes(lines.stream().noneMatch(l -> l.contains("pair")), "no pairing prompt");

        // Newest build for this Minecraft version, from the download page's list.
        var versions = JsonParser.parseString(
                        "{\"versions\":[{\"minecraft\":\"26.3\",\"builds\":[{\"mod\":\"3.0.0\"}]},{\"minecraft\":\"26.2\",\"builds\":[{\"mod\":\"2.1.0\"},{\"mod\":\"2.0.0\"}]}]}")
                .getAsJsonObject();
        eq("2.1.0", fyi.arachne.mod.sync.WebCallsAccess.newestFor(versions, "26.2"), "update check picks this version's newest");
        eq(null, fyi.arachne.mod.sync.WebCallsAccess.newestFor(versions, "26.1"), "no builds for other versions");
        yes(fyi.arachne.mod.sync.WebCalls.looksLikeCode("ab3k9z"), "codes are case-insensitive");
        yes(!fyi.arachne.mod.sync.WebCalls.looksLikeCode("al_abcdefghijklmnopqrstuvwxyz"), "tokens are not codes");

        again.reset();
        eq(0L, again.all().kills, "reset clears");
        Check.done("LocalChecks");
    }
}
