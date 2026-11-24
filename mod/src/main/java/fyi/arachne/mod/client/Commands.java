package fyi.arachne.mod.client;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommands.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommands.literal;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;

import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.sync.SyncClient;
import fyi.arachne.mod.sync.WebCalls;
import fyi.arachne.mod.ui.Format;

import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

/**
 * {@code /arachne}. Every setting is a command, so v2 needs no settings screen (and no text
 * fields to maintain).
 *
 * <pre>
 * /arachne                         status
 * /arachne local reset             clear the totals kept on this PC
 * /arachne pair <code>              pair with a six-letter code from the dashboard
 * /arachne hud minimal|normal|full  how much the HUD shows
 * /arachne debug on|off             show where tracking thinks you are
 * /arachne updates on|off           check for new versions
 * /arachne report                   write report.txt for troubleshooting
 * /arachne pair &lt;address&gt; &lt;token&gt;  connect to a server
 * /arachne unpair
 * /arachne pause | resume          stop or restart recording
 * /arachne hud on | off
 * /arachne hud move &lt;x&gt; &lt;y&gt;
 * /arachne scope group | me | account
 * /arachne window today | week | all
 * </pre>
 */
final class Commands {
    static void register() {
        ClientCommandRegistrationCallback.EVENT.register(
                (dispatcher, access) -> {
                        var root =
                        dispatcher.register(
                                literal("arachne")
                                        .executes(Commands::status)
                                        .then(literal("status").executes(Commands::status))
                                        .then(
                                                literal("pair")
                                                        // greedyString: an address contains ':' and '/', which a plain
                                                        // word argument would refuse.
                                                        .then(argument("address and token", StringArgumentType.greedyString()).executes(Commands::pair)))
                                        .then(literal("unpair").executes(Commands::unpair))
                                        .then(literal("local").then(literal("reset").executes(Commands::resetLocal)))
                                        .then(literal("report").executes(Commands::report))
                                        .then(literal("debug").then(literal("on").executes(c -> debug(c, true))).then(literal("off").executes(c -> debug(c, false))))
                                        .then(literal("updates").then(literal("on").executes(c -> updates(c, true))).then(literal("off").executes(c -> updates(c, false))))
                                        .then(
                                                literal("hud")
                                                        .then(literal("minimal").executes(c -> style(c, Settings.HudStyle.MINIMAL)))
                                                        .then(literal("normal").executes(c -> style(c, Settings.HudStyle.NORMAL)))
                                                        .then(literal("full").executes(c -> style(c, Settings.HudStyle.FULL))))
                                        .then(literal("pause").executes(c -> pause(c, true)))
                                        .then(literal("resume").executes(c -> pause(c, false)))
                                        .then(
                                                literal("hud")
                                                        .then(literal("on").executes(c -> hud(c, true)))
                                                        .then(literal("off").executes(c -> hud(c, false)))
                                                        .then(
                                                                literal("move")
                                                                        .then(
                                                                                argument("x", IntegerArgumentType.integer(0, 4000))
                                                                                        .then(argument("y", IntegerArgumentType.integer(0, 4000)).executes(Commands::move)))))
                                        .then(
                                                literal("scope")
                                                        .then(literal("group").executes(c -> scope(c, Settings.Scope.GROUP)))
                                                        // Old name, kept so muscle memory still works.
                                                        .then(literal("everyone").executes(c -> scope(c, Settings.Scope.GROUP)))
                                                        .then(literal("me").executes(c -> scope(c, Settings.Scope.USER)))
                                                        .then(literal("account").executes(c -> scope(c, Settings.Scope.ACCOUNT))))
                                        .then(
                                                literal("window")
                                                        .then(literal("today").executes(c -> window(c, Settings.Window.TODAY)))
                                                        .then(literal("week").executes(c -> window(c, Settings.Window.WEEK)))
                                                        .then(literal("all").executes(c -> window(c, Settings.Window.ALL)))));
                        // The old name keeps working so existing habits and notes don't break.
                        dispatcher.register(literal("ledger").redirect(root));
                });
    }

    private static void reply(CommandContext<FabricClientCommandSource> c, String text) {
        c.getSource().sendFeedback(Component.literal("[Arachne.fyi] " + text));
    }

    private static int status(CommandContext<FabricClientCommandSource> c) {
        Settings s = ArachneFyi.settings();
        SyncClient.Status st = ArachneFyi.sync().status();
        long now = System.currentTimeMillis();
        if (!s.paired()) {
            var today = ArachneFyi.local().today(now);
            reply(c, "Tracking on this PC only. Today: " + Format.coins(today.profit()) + " profit, " + Format.count(today.kills) + " kills.");
            reply(c, "Invited to the dashboard? Make a token there, then /arachne pair <address> <token>.");
        } else {
            reply(c, "Server: " + s.endpoint);
        }
        String sync =
                switch (st.state()) {
                    case OK -> st.lastSuccessAt() == 0 ? "connecting" : "last sync " + Format.ago(now - st.lastSuccessAt());
                    case OFFLINE -> "offline, next try in " + Format.duration(Math.max(0, st.retryAt() - now));
                    case BAD_TOKEN -> "token refused";
                    case PAUSED -> "paused";
                    case NOT_PAIRED -> "not paired";
                };
        reply(c, "Sync: " + sync + ", " + st.queued() + " event(s) waiting.");
        if (!st.message().isEmpty()) reply(c, st.message());
        reply(c, "Tracking: " + ArachneFyi.tracker().areaReason(now) + (ArachneFyi.tracker().fighting() ? ", boss up" : ""));
        return 1;
    }

    private static int style(CommandContext<FabricClientCommandSource> c, Settings.HudStyle style) {
        ArachneFyi.settings().hudStyle = style;
        ArachneFyi.saveSettings();
        reply(c, "HUD style: " + style.name().toLowerCase(java.util.Locale.ROOT) + ".");
        return 1;
    }

    private static int debug(CommandContext<FabricClientCommandSource> c, boolean on) {
        ArachneFyi.settings().debug = on;
        ArachneFyi.saveSettings();
        reply(c, on ? "The HUD now says where tracking thinks you are." : "Debug line hidden.");
        return 1;
    }

    private static int updates(CommandContext<FabricClientCommandSource> c, boolean on) {
        ArachneFyi.settings().updateCheck = on;
        ArachneFyi.saveSettings();
        reply(c, on ? "Will check for new versions when you join SkyBlock." : "Will not check for new versions.");
        return 1;
    }

    /**
     * Writes what the mod knows right now to a text file, for sending when something looks
     * wrong. The token is not included.
     */
    private static int report(CommandContext<FabricClientCommandSource> c) {
        long now = System.currentTimeMillis();
        Settings s = ArachneFyi.settings();
        SyncClient.Status st = ArachneFyi.sync().status();
        var today = ArachneFyi.local().today(now);
        String text = String.join(
                "\n",
                "Arachne.fyi report, " + java.time.Instant.ofEpochMilli(now),
                "Mod " + net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer(ArachneFyi.MOD_ID).map(m -> m.getMetadata().getVersion().getFriendlyString()).orElse("?"),
                "Server: " + (s.paired() ? s.endpoint : "not paired") + ", token " + (s.token.isEmpty() ? "none" : s.token.substring(0, Math.min(9, s.token.length())) + "..."),
                "Sync: " + st.state() + ", " + st.queued() + " queued, last ok " + (st.lastSuccessAt() == 0 ? "never" : Format.ago(now - st.lastSuccessAt()) + " ago"),
                "Message: " + st.message(),
                "Tracking: " + ArachneFyi.tracker().areaReason(now) + (ArachneFyi.tracker().fighting() ? ", boss up" : ""),
                "Local today: " + today.kills + " kills, " + today.fights + " fights, " + Format.coins(today.profit()) + " profit",
                "HUD: " + s.hudStyle + ", scope " + s.scope + ", window " + s.window + ", paused " + s.paused);
        try {
            var dir = net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve(ArachneFyi.MOD_ID);
            java.nio.file.Files.createDirectories(dir);
            var file = dir.resolve("report.txt");
            java.nio.file.Files.writeString(file, text + "\n");
            reply(c, "Wrote " + file + ". Send that file to whoever runs your dashboard.");
        } catch (java.io.IOException e) {
            reply(c, "Could not write the report: " + e.getMessage());
        }
        return 1;
    }

    /** Clear the totals kept on this PC. Server data is not touched. */
    private static int resetLocal(CommandContext<FabricClientCommandSource> c) {
        ArachneFyi.local().reset();
        reply(c, "Cleared the totals kept on this PC.");
        return 1;
    }

    private static int pair(CommandContext<FabricClientCommandSource> c) {
        String[] parts = StringArgumentType.getString(c, "address and token").trim().split("\\s+");
        // "/arachne pair ABC123" (or "/arachne pair <address> ABC123"): a short code from the dashboard.
        String code = parts.length == 1 ? parts[0] : parts.length == 2 && WebCalls.looksLikeCode(parts[1]) ? parts[1] : null;
        if (code != null && WebCalls.looksLikeCode(code)) {
            String endpoint;
            try {
                endpoint = parts.length == 2 ? Settings.normalizeEndpoint(parts[0]) : WebCalls.DEFAULT_ENDPOINT;
            } catch (IllegalArgumentException e) {
                reply(c, e.getMessage());
                return 0;
            }
            reply(c, "Checking the code...");
            WebCalls.pairWithCode(
                    endpoint,
                    code,
                    paired -> Minecraft.getInstance().execute(() -> {
                        Settings s = ArachneFyi.settings();
                        s.endpoint = paired.endpoint();
                        s.token = paired.token();
                        ArachneFyi.saveSettings();
                        ArachneFyi.say("Paired" + (paired.user().isEmpty() ? "" : " as " + paired.user()) + ". Your drops now go to the dashboard.");
                    }),
                    ArachneFyi::say);
            return 1;
        }
        if (parts.length != 2) {
            reply(c, "Use: /arachne pair <code> with a code from the dashboard's Pair the mod page.");
            return 0;
        }
        String endpoint;
        try {
            endpoint = Settings.normalizeEndpoint(parts[0]);
        } catch (IllegalArgumentException e) {
            reply(c, e.getMessage());
            return 0;
        }
        if (!Settings.validToken(parts[1])) {
            reply(c, "That is not a token. Tokens start with al_ and are made on the dashboard.");
            return 0;
        }
        Settings s = ArachneFyi.settings();
        s.endpoint = endpoint;
        s.token = parts[1];
        ArachneFyi.saveSettings();
        reply(c, "Checking the token with " + endpoint + "...");
        ArachneFyi.sync().whoami(endpoint, parts[1], ArachneFyi::say);
        return 1;
    }

    private static int unpair(CommandContext<FabricClientCommandSource> c) {
        Settings s = ArachneFyi.settings();
        s.endpoint = "";
        s.token = "";
        ArachneFyi.saveSettings();
        reply(c, "Unpaired. Events are still recorded and wait in the queue until you pair again.");
        return 1;
    }

    private static int pause(CommandContext<FabricClientCommandSource> c, boolean paused) {
        ArachneFyi.setPaused(paused);
        reply(c, paused ? "Paused. Nothing is recorded until /arachne resume." : "Recording again.");
        return 1;
    }

    private static int hud(CommandContext<FabricClientCommandSource> c, boolean on) {
        ArachneFyi.settings().hud = on;
        ArachneFyi.saveSettings();
        reply(c, on ? "HUD shown in SkyBlock." : "HUD hidden.");
        return 1;
    }

    private static int move(CommandContext<FabricClientCommandSource> c) {
        Settings s = ArachneFyi.settings();
        s.hudX = IntegerArgumentType.getInteger(c, "x");
        s.hudY = IntegerArgumentType.getInteger(c, "y");
        ArachneFyi.saveSettings();
        reply(c, "HUD moved to " + s.hudX + ", " + s.hudY + ".");
        return 1;
    }

    private static int scope(CommandContext<FabricClientCommandSource> c, Settings.Scope scope) {
        ArachneFyi.settings().scope = scope;
        ArachneFyi.saveSettings();
        reply(c, "HUD now shows " + switch (scope) {
            case GROUP -> "your group's totals (just you until you join one on the dashboard).";
            case USER -> "all your accounts together.";
            case ACCOUNT -> "only this account.";
        });
        return 1;
    }

    private static int window(CommandContext<FabricClientCommandSource> c, Settings.Window window) {
        ArachneFyi.settings().window = window;
        ArachneFyi.saveSettings();
        reply(c, "HUD window: " + window.name().toLowerCase(java.util.Locale.ROOT) + ".");
        return 1;
    }

    private Commands() {}
}
