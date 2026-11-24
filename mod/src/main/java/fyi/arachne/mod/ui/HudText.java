package fyi.arachne.mod.ui;

import com.google.gson.JsonObject;

import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.sync.SyncClient;
import fyi.arachne.mod.tracking.LocalLedger;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * What the HUD says, as plain lines. Kept apart from the drawing code so it can be checked
 * without the game, and so a rendering change only touches {@link Hud}.
 */
public final class HudText {
    public enum Tone {
        TITLE,
        GOLD,
        NORMAL,
        MUTED,
        WARN,
        GOOD
    }

    public record Line(String text, Tone tone) {}

    public static List<Line> build(Settings settings, SyncClient.Status status, boolean fighting, long fightStartedAt, long now) {
        return build(settings, status, null, fighting, fightStartedAt, now);
    }

    /**
     * {@code local} is used when the mod is not paired: the numbers then come from this PC
     * only, and the HUD says so instead of asking the player to pair.
     */
    public static List<Line> build(
            Settings settings, SyncClient.Status status, LocalLedger local, boolean fighting, long fightStartedAt, long now) {
        return build(settings, status, local, fighting, fightStartedAt, now, null);
    }

    /** {@code debug}: where tracking thinks you are, shown when /arachne debug is on. */
    public static List<Line> build(
            Settings settings, SyncClient.Status status, LocalLedger local, boolean fighting, long fightStartedAt, long now, String debug) {
        List<Line> lines = buildMain(settings, status, local, fighting, fightStartedAt, now);
        if (settings.debug && debug != null) lines.add(lines.size() - 1, new Line("Tracking: " + debug, Tone.MUTED));
        return lines;
    }

    private static List<Line> buildMain(
            Settings settings, SyncClient.Status status, LocalLedger local, boolean fighting, long fightStartedAt, long now) {
        List<Line> lines = new ArrayList<>();
        boolean minimal = settings.hudStyle == Settings.HudStyle.MINIMAL;
        boolean full = settings.hudStyle == Settings.HudStyle.FULL;
        if (status.state() == SyncClient.State.NOT_PAIRED && local != null) {
            if (!minimal) lines.add(new Line("Arachne.fyi  " + windowLabel(settings), Tone.TITLE));
            LocalLedger.Totals t =
                    switch (settings.window) {
                        case TODAY -> local.today(now);
                        case WEEK -> local.week(now);
                        case ALL -> local.all();
                    };
            lines.add(new Line("Profit " + Format.coins(t.profit()), t.profit() < 0 ? Tone.WARN : Tone.GOLD));
            if (!minimal) {
                lines.add(scavengerLine(t.coins));
                lines.add(focusLine(t.drops.getOrDefault("SOUL_STRING", 0L), t.drops.getOrDefault("ESSENCE_SPIDER", 0L)));
                lines.add(new Line(plural(t.kills, "kill") + ", " + plural(t.crystals, "crystal"), Tone.NORMAL));
            }
            if (full) lines.add(new Line(Format.coins(t.lootValue + t.coins) + " in, " + Format.coins(t.costs) + " spent", Tone.MUTED));
            if (fighting && !minimal) lines.add(fightLine(fightStartedAt, now));
            lines.add(new Line("On this PC only", Tone.MUTED));
            return lines;
        }
        if (!minimal) lines.add(new Line("Arachne.fyi  " + scopeLabel(settings, groupTag(status.totals())) + ", " + windowLabel(settings), Tone.TITLE));

        JsonObject totals = pick(status.totals(), settings);
        if (totals != null && minimal) {
            double profit = totals.get("profit").getAsDouble();
            lines.add(new Line("Profit " + Format.coins(profit), profit < 0 ? Tone.WARN : Tone.GOLD));
        } else if (totals != null) {
            double profit = totals.get("profit").getAsDouble();
            long uptime = totals.get("uptimeMs").getAsLong();
            lines.add(new Line("Profit " + Format.coins(profit), profit < 0 ? Tone.WARN : Tone.GOLD));
            // The three things the farm is about, right under profit.
            lines.add(scavengerLine(totals.get("coins").getAsDouble()));
            JsonObject focus = pickFocus(status.totals(), settings);
            if (focus != null) lines.add(focusLine(focus.get("soulString").getAsLong(), focus.get("essence").getAsLong()));
            if (uptime > 0) {
                lines.add(new Line(Format.coins(totals.get("profitPerClientHour").getAsDouble()) + " per client-hour", Tone.NORMAL));
                if (settings.scope != Settings.Scope.ACCOUNT && totals.get("wallUptimeMs").getAsLong() > 0) {
                    lines.add(new Line(Format.coins(totals.get("profitPerWallHour").getAsDouble()) + " per wall-clock hour", Tone.NORMAL));
                }
            }
            lines.add(
                    new Line(
                            Format.count(totals.get("kills").getAsLong()) + " kills, " + Format.duration(uptime) + " uptime",
                            Tone.NORMAL));
            if (full) {
                lines.add(
                        new Line(
                                Format.coins(totals.get("lootValue").getAsDouble() + totals.get("coins").getAsDouble())
                                        + " in, "
                                        + Format.coins(totals.get("costs").getAsDouble())
                                        + " spent, "
                                        + plural(totals.get("crystals").getAsLong(), "crystal"),
                                Tone.MUTED));
            }
            JsonObject rank = status.totals() != null && status.totals().has("rank") ? status.totals().getAsJsonObject("rank") : null;
            if (rank != null && rank.get("of").getAsInt() > 1 && settings.window == Settings.Window.TODAY) {
                lines.add(new Line("#" + rank.get("rank").getAsInt() + " of " + rank.get("of").getAsInt() + " today", Tone.NORMAL));
            }
            if (settings.scope == Settings.Scope.GROUP && status.online() > 0) {
                lines.add(new Line(status.online() + (status.online() == 1 ? " account" : " accounts") + " online", Tone.MUTED));
            }
        }
        if (fighting && !minimal) lines.add(fightLine(fightStartedAt, now));
        lines.add(syncLine(status, now));
        return lines;
    }

    private static Line fightLine(long fightStartedAt, long now) {
        return new Line(
                fightStartedAt > 0 ? String.format(Locale.ROOT, "Boss up %.1fs", (now - fightStartedAt) / 1000.0) : "Boss up",
                Tone.NORMAL);
    }

    static Line syncLine(SyncClient.Status status, long now) {
        String queued = status.queued() > 0 ? ", " + status.queued() + " queued" : "";
        return switch (status.state()) {
            case NOT_PAIRED -> new Line("Not paired: run /arachne pair", Tone.WARN);
            case PAUSED -> new Line("Paused" + queued, Tone.WARN);
            case BAD_TOKEN -> new Line("Token refused: pair again", Tone.WARN);
            case OFFLINE ->
                    new Line(
                            "Offline" + queued + ", retry in " + Format.duration(Math.max(0, status.retryAt() - now)),
                            Tone.WARN);
            case OK ->
                    status.lastSuccessAt() == 0
                            ? new Line("Connecting" + queued, Tone.MUTED)
                            : new Line(
                                    "Synced " + Format.ago(now - status.lastSuccessAt()) + queued,
                                    // Green while syncs are fresh, grey once it has gone quiet.
                                    now - status.lastSuccessAt() < 120_000 ? Tone.GOOD : Tone.MUTED);
        };
    }

    static Line scavengerLine(double coins) {
        return new Line("Scavenger " + Format.coins(coins) + " coins", Tone.GOLD);
    }

    static Line focusLine(long soulString, long essence) {
        return new Line(Format.count(soulString) + " Soul String, " + Format.count(essence) + " Spider Essence", Tone.NORMAL);
    }

    /** Soul String and Spider Essence counts for the chosen scope and window, or null from an older server. */
    private static JsonObject pickFocus(JsonObject totals, Settings settings) {
        if (totals == null || !totals.has("focus") || !totals.get("focus").isJsonObject()) return null;
        JsonObject windows = totals.getAsJsonObject("focus").getAsJsonObject(scopeKey(settings));
        return windows == null ? null : windows.getAsJsonObject(settings.window.name().toLowerCase(Locale.ROOT));
    }

    private static String groupTag(JsonObject totals) {
        if (totals == null || !totals.has("groupTag") || !totals.get("groupTag").isJsonPrimitive()) return null;
        return totals.get("groupTag").getAsString();
    }

    private static String scopeKey(Settings settings) {
        return switch (settings.scope) {
            case GROUP -> "group";
            case USER -> "user";
            case ACCOUNT -> "account";
        };
    }

    private static JsonObject pick(JsonObject totals, Settings settings) {
        if (totals == null) return null;
        String scope =
                switch (settings.scope) {
                    case GROUP -> "group";
                    case USER -> "user";
                    case ACCOUNT -> "account";
                };
        JsonObject windows = totals.getAsJsonObject(scope);
        return windows == null ? null : windows.getAsJsonObject(settings.window.name().toLowerCase(Locale.ROOT));
    }

    private static String plural(long n, String word) {
        return Format.count(n) + " " + word + (n == 1 ? "" : "s");
    }

    static String scopeLabel(Settings s) {
        return scopeLabel(s, null);
    }

    /** {@code tag}: the group's tag from the server, shown as [TAG] when known. */
    static String scopeLabel(Settings s, String tag) {
        return switch (s.scope) {
            case GROUP -> tag == null || tag.isBlank() ? "my group" : "[" + tag + "]";
            case USER -> "my accounts";
            case ACCOUNT -> "this account";
        };
    }

    static String windowLabel(Settings s) {
        return switch (s.window) {
            case TODAY -> "today";
            case WEEK -> "7 days";
            case ALL -> "all time";
        };
    }

    private HudText() {}
}
