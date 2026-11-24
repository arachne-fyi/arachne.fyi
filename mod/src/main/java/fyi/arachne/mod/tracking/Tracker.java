package fyi.arachne.mod.tracking;

import com.google.gson.JsonObject;

import fyi.arachne.mod.skyblock.Catalog;
import fyi.arachne.mod.skyblock.LootLabels;
import fyi.arachne.mod.skyblock.Messages;
import fyi.arachne.mod.skyblock.PetDrops;
import fyi.arachne.mod.skyblock.PurseCoins;

import java.util.List;
import java.util.UUID;

/**
 * Turns what the client sees (chat lines, reward holograms, item pickups, the sidebar purse)
 * into raw events. Ported from v1.5.0's {@code Tracker} and {@code FightLifecycle}, minus
 * everything the server now does: no prices, no kill counting, no uptime clock, no journal.
 *
 * <p>Rules kept from v1.5.0:
 *
 * <ul>
 *   <li>A fight starts on the boss's spawn line, or is "recovered" from other boss dialogue when
 *       the spawn line was missed (then its SPAWN is unconfirmed).
 *   <li>"ARACHNE DOWN!" ends it; the "Your Damage" line must follow within 5 seconds.
 *   <li>Reward holograms are read for 45 seconds after a death; pickups for 5 minutes.
 *   <li>A hologram and the pickup of the same item are one reward, not two.
 *   <li>Only this player's own placements are reported as costs. Anyone's completed ritual
 *       still tells us the tier (Crystal or Calling) of the boss that follows.
 * </ul>
 *
 * <p>Not thread-safe: call everything from the client thread. {@code now} is always passed in,
 * which is what makes this class testable without the game.
 */
public final class Tracker {
    static final long DAMAGE_WINDOW_MILLIS = 5_000;
    static final long PICKUP_WINDOW_MILLIS = 300_000;
    static final long REWARD_WINDOW_MILLIS = 45_000;
    static final long SUMMONING_MILLIS = 60_000;
    static final long SUMMON_TIER_WINDOW_MILLIS = 75_000;
    static final long DUPLICATE_RELAY_MILLIS = 2_000;
    static final long SCAVENGER_AFTER_DEATH_MILLIS = 10_000;
    static final long PURSE_MENU_COOLDOWN_MILLIS = 2_000;

    /** Receives every event this tracker produces, in order. */
    public interface Sink {
        void emit(JsonObject event);
    }

    private static final class Fight {
        final String id;
        final Event.Tier tier;
        boolean confirmed;
        long spawnedAt;

        Fight(String id, Event.Tier tier) {
            this.id = id;
            this.tier = tier;
        }
    }

    private final Sink sink;
    private final TrackingArea area = new TrackingArea();
    private final LootDeduplicator loot = new LootDeduplicator();
    private final PurseCoins purse = new PurseCoins();

    private boolean inArea;
    private Fight activeFight;
    private String rewardFight;
    private long rewardDeathAt;
    private String awaitingDamageFight;
    private long awaitingDamageSince;
    private long lastDeathAt;
    private Event.Tier pendingTier = Event.Tier.UNKNOWN;
    private long pendingTierAt;
    private long summoningUntil;
    private long pickupWindowUntil;
    private long rewardWindowUntil;
    private String lastSummonIdentity = "";
    private long lastSummonAt;
    private String lastPlacementIdentity = "";
    private long lastPlacementAt;
    private boolean menuOpen;
    private long purseCooldownUntil;

    public Tracker(Sink sink) {
        this.sink = sink;
    }

    // ---- what the HUD may ask -------------------------------------------------------------

    public boolean inArea() {
        return inArea;
    }

    public boolean skyBlock() {
        return area.skyBlock();
    }

    public boolean fighting() {
        return activeFight != null;
    }

    /** When the current boss spawned, or 0 if unknown or no boss is up. */
    public long fightStartedAt() {
        return activeFight == null ? 0 : activeFight.spawnedAt;
    }

    public String areaReason(long now) {
        return area.reason(now, false);
    }

    // ---- location ---------------------------------------------------------------------------

    public void updateLocation(
            boolean hypixel,
            boolean skyBlock,
            boolean sanctuary,
            String location,
            String reason,
            long now) {
        area.update(hypixel, skyBlock, sanctuary, location, reason);
        refreshArea(now);
    }

    /** Call every tick. Handles leaving the area and expiring the damage window. */
    public void tick(long now) {
        refreshArea(now);
        if (awaitingDamageFight != null && now - awaitingDamageSince > DAMAGE_WINDOW_MILLIS) {
            // The server marks this fight as "no damage line"; nothing to send.
            awaitingDamageFight = null;
        }
    }

    private void refreshArea(long now) {
        boolean inside = area.active(now, false);
        if (inArea && !inside) {
            interruptFight(now, Event.Interrupt.LEFT_AREA);
            clearFightContext();
        }
        inArea = inside;
    }

    /**
     * A world change, disconnect or account switch. Ends any fight in progress and forgets
     * everything tied to the old world (hologram identities, purse baseline, location).
     */
    public void resetContext(long now, Event.Interrupt reason) {
        interruptFight(now, reason);
        clearFightContext();
        loot.reset();
        area.reset();
        inArea = false;
        lastSummonIdentity = "";
        lastPlacementIdentity = "";
    }

    private void interruptFight(long now, Event.Interrupt reason) {
        if (activeFight != null) {
            sink.emit(Event.interrupt(now, activeFight.id, reason));
            activeFight = null;
        }
    }

    private void clearFightContext() {
        activeFight = null;
        rewardFight = null;
        rewardDeathAt = 0;
        awaitingDamageFight = null;
        awaitingDamageSince = 0;
        lastDeathAt = 0;
        pendingTier = Event.Tier.UNKNOWN;
        pendingTierAt = 0;
        summoningUntil = 0;
        pickupWindowUntil = 0;
        rewardWindowUntil = 0;
        purse.reset();
        loot.beginRewardWindow();
    }

    // ---- chat --------------------------------------------------------------------------------

    /**
     * One server chat line. {@code formatted} keeps legacy colour codes (see LootLabels);
     * {@code player} is this client's own name, used to tell its placements from others'.
     */
    public void message(String formatted, String player, long now) {
        String message = Messages.clean(formatted);
        if (area.skyBlock() && Messages.isArachneCue(message)) {
            // Boss dialogue is evidence of being at Arachne even when the sidebar is unclear.
            area.observeArachne(now);
            refreshArea(now);
        }
        if (!inArea) return;

        observeSummon(message, now);
        Messages.Event event = Messages.parse(message, player);
        switch (event) {
            case SPAWN, ACTIVITY -> observeBoss(event == Messages.Event.SPAWN, now);
            case DOWN -> observeDeath(now);
            case CRYSTAL, CALLING -> observeOwnPlacement(event, message, now);
            default -> {}
        }
        observeDamage(message, now);
        observePetClaim(formatted, now);
    }

    /** A completed ritual (anyone's) means a boss is about to spawn. */
    private void observeSummon(String message, long now) {
        Messages.Summon summon = Messages.summon(message);
        if (summon == null) return;
        String identity = Messages.placementIdentity(message);
        if (identity.equals(lastSummonIdentity) && now - lastSummonAt < DUPLICATE_RELAY_MILLIS) {
            return;
        }
        if (activeFight != null) {
            // The same line can be relayed just after the spawn; that is not a new ritual.
            if (activeFight.spawnedAt > 0 && now - activeFight.spawnedAt < DUPLICATE_RELAY_MILLIS) {
                return;
            }
            // A fresh ritual while a fight is "open" means its death line was missed.
            interruptFight(now, Event.Interrupt.NEW_RITUAL);
            rewardWindowUntil = 0;
        }
        lastSummonIdentity = identity;
        lastSummonAt = now;
        pendingTier = summon == Messages.Summon.CRYSTAL ? Event.Tier.CRYSTAL : Event.Tier.CALLING;
        pendingTierAt = now;
        summoningUntil = now + SUMMONING_MILLIS;
        pickupWindowUntil = now + PICKUP_WINDOW_MILLIS;
    }

    private void observeBoss(boolean confirmedSpawn, long now) {
        // Generic dialogue may only start a fight when nothing contradicts it: right after a
        // death, it needs a fresh summon first, so old lines cannot restart the last fight.
        if (activeFight == null && (confirmedSpawn || lastDeathAt == 0 || now < summoningUntil)) {
            activeFight = beginFight(now);
            activeFight.confirmed = confirmedSpawn;
            activeFight.spawnedAt = now;
            summoningUntil = 0;
            sink.emit(Event.spawn(now, activeFight.id, activeFight.tier, confirmedSpawn));
        } else if (activeFight != null && confirmedSpawn && !activeFight.confirmed) {
            // A Crystal ritual can produce dialogue before the welcome line. Upgrade the
            // recovered fight rather than starting a second one.
            activeFight.confirmed = true;
            activeFight.spawnedAt = now;
            sink.emit(Event.spawn(now, activeFight.id, activeFight.tier, true));
        }
        if (activeFight != null) pickupWindowUntil = now + PICKUP_WINDOW_MILLIS;
    }

    private Fight beginFight(long now) {
        boolean recentRitual =
                pendingTierAt > 0 && now >= pendingTierAt && now - pendingTierAt <= SUMMON_TIER_WINDOW_MILLIS;
        Fight fight = new Fight(Event.newFightId(), recentRitual ? pendingTier : Event.Tier.UNKNOWN);
        pendingTier = Event.Tier.UNKNOWN;
        pendingTierAt = 0;
        return fight;
    }

    private void observeDeath(long now) {
        // A relayed copy of the last death must not become another one, unless a real new
        // ritual happened in between (then its spawn line was simply missed).
        boolean freshRitual =
                pendingTierAt > lastDeathAt
                        && now - pendingTierAt >= DUPLICATE_RELAY_MILLIS
                        && now - pendingTierAt <= SUMMON_TIER_WINDOW_MILLIS
                        && now - lastDeathAt >= DUPLICATE_RELAY_MILLIS;
        if (lastDeathAt != 0 && activeFight == null && !freshRitual) return;

        Fight fight = activeFight != null ? activeFight : beginFight(now);
        activeFight = null;
        lastDeathAt = now;
        summoningUntil = 0;
        sink.emit(Event.death(now, fight.id));

        rewardFight = fight.id;
        rewardDeathAt = now;
        awaitingDamageFight = fight.id;
        awaitingDamageSince = now;
        pickupWindowUntil = now + REWARD_WINDOW_MILLIS;
        rewardWindowUntil = now + REWARD_WINDOW_MILLIS;
        loot.beginRewardWindow();
    }

    private void observeDamage(String message, long now) {
        var damage = Messages.damage(message);
        if (damage.isEmpty() || awaitingDamageFight == null) return;
        if (now < awaitingDamageSince || now - awaitingDamageSince > DAMAGE_WINDOW_MILLIS) return;
        sink.emit(Event.damage(now, awaitingDamageFight, damage.getAsLong()));
        awaitingDamageFight = null;
    }

    private void observeOwnPlacement(Messages.Event event, String message, long now) {
        String identity = Messages.placementIdentity(message);
        if (identity.equals(lastPlacementIdentity) && now - lastPlacementAt < DUPLICATE_RELAY_MILLIS) {
            return;
        }
        lastPlacementIdentity = identity;
        lastPlacementAt = now;
        String item = event == Messages.Event.CRYSTAL ? "ARACHNE_CRYSTAL" : "ARACHNE_KEEPER_FRAGMENT";
        sink.emit(Event.place(now, item, activeFight == null ? null : activeFight.id));
        pickupWindowUntil = now + PICKUP_WINDOW_MILLIS;
    }

    private void observePetClaim(String formatted, long now) {
        if (!acceptsStandLoot(now)) return;
        LootLabels.Drop drop = PetDrops.claim(formatted);
        if (drop == null || !loot.acceptClaim(drop.item(), drop.count(), now)) return;
        sink.emit(Event.loot(now, drop.item(), drop.count(), "pet_claim", rewardFight));
    }

    // ---- reward holograms and pickups -----------------------------------------------------

    public boolean acceptsLoot(long now) {
        return inArea && pickupWindowUntil > 0 && now <= pickupWindowUntil;
    }

    public boolean acceptsStandLoot(long now) {
        return acceptsLoot(now) && rewardWindowUntil > 0 && now <= rewardWindowUntil;
    }

    /** Lets the entity scan skip holograms it has already read. */
    public boolean hasSeenStand(UUID stand) {
        return loot.hasSeenStand(stand);
    }

    public void observeStand(UUID stand, String formattedLabel, long now) {
        if (!acceptsStandLoot(now) || loot.hasSeenStand(stand)) return;
        LootLabels.Drop drop = LootLabels.parse(formattedLabel);
        if (drop == null) return;
        long unseen = loot.acceptStandCount(stand, drop.item(), drop.count(), now);
        if (unseen > 0) sink.emit(Event.loot(now, drop.item(), unseen, "armor_stand", rewardFight));
    }

    public void pickup(String item, int count, long now) {
        if (!Catalog.ITEMS.containsKey(item) || count <= 0 || !acceptsLoot(now)) return;
        boolean rewardOpen = acceptsStandLoot(now);
        long unseen = loot.acceptPickupCount(item, count, now, rewardOpen);
        if (unseen == 0) return;
        // A new boss can spawn before the last one's drops are picked up. Those still belong
        // to the death; ordinary mid-fight pickups belong to the fight in progress.
        String fight = rewardOpen ? rewardFight : activeFight == null ? null : activeFight.id;
        sink.emit(Event.loot(now, item, unseen, "pickup", fight));
    }

    // ---- Scavenger coins ------------------------------------------------------------------

    /**
     * Call every tick with whether a container menu is open. NPC menus change the purse too,
     * and one can open and close between two sidebar reads, so this cannot wait for those.
     */
    public void observeMenu(boolean menu, long now) {
        if (menu || menuOpen) {
            purseCooldownUntil = now + PURSE_MENU_COOLDOWN_MILLIS;
            purse.reset();
        }
        menuOpen = menu;
    }

    /** Call on every sidebar read, eligible or not, so menus never leak into a fight. */
    public void observePurse(List<String> sidebar, boolean menu, long now) {
        observeMenu(menu, now);
        boolean recentDeath = rewardFight != null && now - rewardDeathAt <= SCAVENGER_AFTER_DEATH_MILLIS;
        boolean eligible = inArea && !menu && now >= purseCooldownUntil && (activeFight != null || recentDeath);
        double coins = purse.observe(sidebar, eligible, now);
        if (coins > 0) {
            String fight = activeFight != null ? activeFight.id : rewardFight;
            sink.emit(Event.coins(now, coins, fight));
        }
    }
}
