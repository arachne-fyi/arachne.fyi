package fyi.arachne.mod.client;

import com.google.gson.JsonObject;

import fyi.arachne.mod.skyblock.Lobby;
import fyi.arachne.mod.sync.EventQueue;
import fyi.arachne.mod.sync.LocalPrices;
import fyi.arachne.mod.sync.Settings;
import fyi.arachne.mod.sync.SyncClient;
import fyi.arachne.mod.sync.WebCalls;
import fyi.arachne.mod.tracking.Event;
import fyi.arachne.mod.tracking.LocalLedger;
import fyi.arachne.mod.tracking.Tracker;
import fyi.arachne.mod.ui.Hud;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.item.ItemStack;

import java.nio.file.Path;

/**
 * Fabric entry point: wires game events to the {@link Tracker} and the tracker's events to the
 * {@link SyncClient}. All decisions live in those two; this class only translates.
 *
 * <pre>
 *  chat, holograms, pickups, sidebar ──► Tracker ──► events ──► SyncClient ──► server
 *                                                                   │
 *                                     HUD ◄── totals from reply ◄───┘
 * </pre>
 */
public final class ArachneFyi implements ClientModInitializer {
    public static final String MOD_ID = "arachnefyi";
    private static final int SIDEBAR_EVERY_TICKS = 10;
    private static final int HOLOGRAM_RADIUS = 48;

    private static Path dir;
    private static Settings settings;
    private static Tracker tracker;
    private static SyncClient sync;
    private static LocalLedger local;

    /** The Minecraft account in use. Events are tagged with it when recorded. */
    private static String account;
    private static String accountName;
    /** Hypixel server id from the sidebar, for matching a boss across accounts. Null if unknown. */
    private static String lobby;
    private static Object lastLevel;
    private static boolean updateChecked;
    private static int ticks;

    public static Settings settings() {
        return settings;
    }

    public static Tracker tracker() {
        return tracker;
    }

    public static SyncClient sync() {
        return sync;
    }

    /** Totals kept on this PC; what the HUD shows when the mod is not paired. */
    public static LocalLedger local() {
        return local;
    }

    @Override
    public void onInitializeClient() {
        dir = FabricLoader.getInstance().getConfigDir().resolve(MOD_ID);
        migrateOldConfig(FabricLoader.getInstance().getConfigDir().resolve("arachneledger"), dir);
        settings = Settings.load(dir.resolve("settings.json"));
        sync =
                new SyncClient(
                        settings,
                        new EventQueue(dir.resolve("queue.ndjson")),
                        version(MOD_ID),
                        version("minecraft"),
                        System::currentTimeMillis);
        sync.start();
        LocalPrices prices = new LocalPrices();
        local = new LocalLedger(dir.resolve("local.json"), prices::price);
        tracker = new Tracker(ArachneFyi::emit);

        ClientTickEvents.END_CLIENT_TICK.register(ArachneFyi::tick);
        ClientReceiveMessageEvents.GAME.register(ArachneFyi::receive);
        // Other mods may hide a line; it still happened.
        ClientReceiveMessageEvents.GAME_CANCELED.register(ArachneFyi::receive);
        ClientPlayConnectionEvents.DISCONNECT.register(
                (handler, client) -> {
                    tracker.resetContext(System.currentTimeMillis(), Event.Interrupt.DISCONNECT);
                    account = null;
                    sync.setAccount(null, null, false, false);
                });
        ClientLifecycleEvents.CLIENT_STOPPING.register(
                client -> {
                    tracker.resetContext(System.currentTimeMillis(), Event.Interrupt.DISCONNECT);
                    sync.shutdown();
                });
        HudElementRegistry.attachElementBefore(
                VanillaHudElements.CHAT,
                Identifier.fromNamespaceAndPath(MOD_ID, "hud"),
                (graphics, delta) -> Hud.draw(graphics));
        Commands.register();
    }

    private static String version(String modId) {
        return FabricLoader.getInstance()
                .getModContainer(modId)
                .map(c -> c.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");
    }

    /**
     * Every event is counted on this PC. It is only queued for the server once the mod is
     * paired: without a dashboard invite nothing leaves the computer, and the queue file
     * does not grow forever.
     */
    private static void emit(JsonObject event) {
        if (account == null || settings.paused) return;
        var origin = GameContext.origin(Minecraft.getInstance());
        // Alpha network: test server, nothing there is real. Not counted here, not queued.
        if (origin != null && origin.alpha()) return;
        if (origin != null) event.add("origin", origin.toJson());
        local.record(event);
        if (settings.paired()) {
            sync.record(account, accountName, event);
            // Spawns and deaths also go out at once, so the website's fight timer is exact.
            sync.live(account, accountName, event, lobby);
        }
    }

    /** For the HUD: true while connected to the Alpha network. */
    public static boolean onAlpha() {
        var origin = GameContext.origin(Minecraft.getInstance());
        return origin != null && origin.alpha();
    }

    private static void tick(Minecraft client) {
        if (client.player == null || client.level == null || settings.paused) return;
        long now = System.currentTimeMillis();

        // Warping between islands changes the level; anything mid-fight is over.
        if (client.level != lastLevel) {
            tracker.resetContext(now, Event.Interrupt.OTHER);
            lastLevel = client.level;
            lobby = null; // new level, maybe a new server: read it again
            ticks = 0;
        }
        String uuid = client.player.getUUID().toString();
        if (!uuid.equals(account)) {
            tracker.resetContext(now, Event.Interrupt.OTHER);
            account = uuid;
            accountName = client.player.getName().getString();
        }

        boolean menu = client.gui.screen() instanceof AbstractContainerScreen<?>;
        if (ticks++ % SIDEBAR_EVERY_TICKS == 0) {
            var snapshot = GameContext.snapshot(client);
            tracker.updateLocation(
                    snapshot.onHypixel(),
                    snapshot.skyBlock(),
                    snapshot.sanctuary(),
                    snapshot.location(),
                    snapshot.detectionReason(),
                    now);
            tracker.observePurse(snapshot.sidebarLines(), menu, now);
            lobby = Lobby.find(snapshot.sidebarLines());
            // Heartbeats only while in SkyBlock, so the dashboard's "online" means something.
            sync.setAccount(tracker.skyBlock() ? account : null, accountName, tracker.inArea(), tracker.fighting());
            // Once per game start, the first time in SkyBlock: is there a newer build?
            if (tracker.skyBlock() && !updateChecked && settings.updateCheck) {
                updateChecked = true;
                WebCalls.checkForUpdate(
                        settings.paired() ? settings.endpoint : WebCalls.PUBLIC_SITE,
                        version(MOD_ID),
                        version("minecraft"),
                        newer -> say("Version " + newer + " is out (you have " + version(MOD_ID) + "). Get it from arachne.fyi/download."));
            }
        } else {
            tracker.observeMenu(menu, now);
        }
        tracker.tick(now);
        scanHolograms(client, now);
    }

    /** Reward holograms appear as named armour stands around the dead boss. */
    private static void scanHolograms(Minecraft client, long now) {
        if (!tracker.acceptsStandLoot(now)) return;
        var stands =
                client.level.getEntitiesOfClass(
                        ArmorStand.class,
                        client.player.getBoundingBox().inflate(HOLOGRAM_RADIUS),
                        stand -> stand.hasCustomName() && !tracker.hasSeenStand(stand.getUUID()));
        for (ArmorStand stand : stands) {
            Component label = stand.getCustomName();
            if (label != null) tracker.observeStand(stand.getUUID(), TextFormat.legacy(label), now);
        }
    }

    private static void receive(Component message, boolean overlay) {
        Minecraft client = Minecraft.getInstance();
        if (overlay || client.player == null || settings.paused || account == null) return;
        tracker.message(TextFormat.legacy(message), client.player.getName().getString(), System.currentTimeMillis());
    }

    /** Called by {@code PickupMixin} on the client thread. */
    public static void onPickup(ItemStack stack, int count) {
        if (settings.paused || account == null) return;
        tracker.pickup(ItemIds.of(stack), count, System.currentTimeMillis());
    }

    // ---- settings changes from /arachne --------------------------------------------------

    static void saveSettings() {
        settings.save(dir.resolve("settings.json"));
        sync.updateSettings(settings);
    }

    static void setPaused(boolean paused) {
        if (paused && !settings.paused) {
            tracker.resetContext(System.currentTimeMillis(), Event.Interrupt.OTHER);
        }
        settings.paused = paused;
        saveSettings();
    }

    /** Show a line in chat. Safe to call from any thread. */
    public static void say(String text) {
        Minecraft mc = Minecraft.getInstance();
        mc.execute(() -> {
            if (mc.player != null) mc.player.sendSystemMessage(Component.literal("[Arachne.fyi] " + text));
        });
    }

    /** The mod used to be called Arachne Ledger; carry its settings, queue and local totals over once. */
    private static void migrateOldConfig(Path old, Path now) {
        try {
            if (!java.nio.file.Files.isDirectory(old) || java.nio.file.Files.exists(now)) return;
            java.nio.file.Files.createDirectories(now);
            try (var files = java.nio.file.Files.list(old)) {
                for (Path f : (Iterable<Path>) files::iterator) {
                    if (java.nio.file.Files.isRegularFile(f)) {
                        java.nio.file.Files.copy(f, now.resolve(f.getFileName()));
                    }
                }
            }
        } catch (java.io.IOException ignored) {
            // Starting fresh is fine; the old folder is left alone either way.
        }
    }
}
