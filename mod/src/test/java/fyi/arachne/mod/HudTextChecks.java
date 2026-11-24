package fyi.arachne.mod;

import static fyi.arachne.mod.Check.eq;
import static fyi.arachne.mod.Check.yes;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.sync.SyncClient;
import fyi.arachne.mod.ui.Format;
import fyi.arachne.mod.ui.HudText;

public final class HudTextChecks {
    public static void main(String[] args) {
        eq("2.39M", Format.coins(2_391_000), "millions");
        eq("135.5k", Format.coins(135_500), "thousands");
        eq("9,999", Format.coins(9_999), "small");
        eq("-17.9k", Format.coins(-17_900), "negative");
        eq("1h 02m", Format.duration(3_725_000), "hours");
        eq("4m 05s", Format.duration(245_000), "minutes");

        String window =
                "{\"kills\":12,\"fights\":13,\"crystals\":4,\"callings\":0,\"lootValue\":0,\"coins\":0,\"costs\":0,"
                        + "\"profit\":1500000,\"uptimeMs\":3600000,\"wallUptimeMs\":1800000,"
                        + "\"profitPerClientHour\":1500000,\"profitPerWallHour\":3000000}";
        String windows = "{\"today\":" + window + ",\"week\":" + window + ",\"all\":" + window + "}";
        JsonObject totals = JsonParser.parseString("{\"group\":" + windows + ",\"user\":" + windows + ",\"account\":" + windows + "}").getAsJsonObject();
        long now = 1_800_000_000_000L;
        var status = new SyncClient.Status(SyncClient.State.OK, 3, now - 12_000, 0, "", totals, 2);
        var lines = HudText.build(new Settings(), status, true, now - 4_500, now);
        var text = lines.stream().map(HudText.Line::text).toList();
        eq("Profit 1.50M", text.get(1), "profit line");
        yes(text.contains("3.00M per wall-clock hour"), "wall-clock rate shown for groups");
        yes(text.contains("12 kills, 1h 00m uptime"), "kills and uptime");
        yes(text.contains("2 accounts online"), "online count");
        yes(text.contains("Boss up 4.5s"), "fight timer");
        eq("Synced 12s ago, 3 queued", text.get(text.size() - 1), "sync line");

        var offline = new SyncClient.Status(SyncClient.State.OFFLINE, 40, 0, now + 60_000, "", null, 0);
        var off = HudText.build(new Settings(), offline, false, 0, now);
        eq(2, off.size(), "no totals yet: title and sync line only");
        eq("Offline, 40 queued, retry in 1m 00s", off.get(1).text(), "offline line");
        // Styles and today's rank.
        JsonObject withRank = totals.deepCopy();
        withRank.add("rank", JsonParser.parseString("{\"rank\":2,\"of\":5}"));
        var ranked = new SyncClient.Status(SyncClient.State.OK, 0, now - 1_000, 0, "", withRank, 2);
        var rankText = HudText.build(new Settings(), ranked, true, now - 4_500, now).stream().map(HudText.Line::text).toList();
        yes(rankText.contains("#2 of 5 today"), "rank line");
        Settings minimal = new Settings();
        minimal.hudStyle = Settings.HudStyle.MINIMAL;
        var small = HudText.build(minimal, ranked, true, now - 4_500, now);
        eq(2, small.size(), "minimal: profit and sync only");
        eq("Profit 1.50M", small.get(0).text(), "minimal profit");
        eq(HudText.Tone.GOOD, small.get(1).tone(), "fresh sync is green");
        Settings full = new Settings();
        full.hudStyle = Settings.HudStyle.FULL;
        full.debug = true;
        var big = HudText.build(full, ranked, null, false, 0, now, "in the Sanctuary").stream().map(HudText.Line::text).toList();
        yes(big.contains("0 in, 0 spent, 4 crystals"), "full: money line");
        eq("Tracking: in the Sanctuary", big.get(big.size() - 2), "debug line above sync");
        // Scavenger coins, Soul String and Spider Essence under profit; group tag in the title.
        yes(text.contains("Scavenger 0 coins"), "scavenger line");
        JsonObject withFocus = totals.deepCopy();
        String f = "{\"soulString\":34,\"essence\":1210}";
        String fw = "{\"today\":" + f + ",\"week\":" + f + ",\"all\":" + f + "}";
        withFocus.add("focus", JsonParser.parseString("{\"group\":" + fw + ",\"user\":" + fw + ",\"account\":" + fw + "}"));
        withFocus.addProperty("groupTag", "WEB");
        var focused = new SyncClient.Status(SyncClient.State.OK, 0, now - 1_000, 0, "", withFocus, 2);
        var focusText = HudText.build(new Settings(), focused, false, 0, now).stream().map(HudText.Line::text).toList();
        eq("Arachne.fyi  [WEB], today", focusText.get(0), "group tag in title");
        yes(focusText.contains("34 Soul String, 1,210 Spider Essence"), "focus line");
        eq("Arachne.fyi  my group, today", text.get(0), "no tag: my group");
        Check.done("HudTextChecks");
    }
}
