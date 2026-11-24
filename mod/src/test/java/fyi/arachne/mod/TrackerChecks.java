package fyi.arachne.mod;

import static fyi.arachne.mod.Check.eq;
import static fyi.arachne.mod.Check.yes;

import com.google.gson.JsonObject;

import fyi.arachne.mod.tracking.Event;
import fyi.arachne.mod.tracking.Tracker;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Feeds the tracker the chat lines and observations of real fights and checks the events. */
public final class TrackerChecks {
    static final String ME = "Ollie";
    static final long T = 1_800_000_000_000L;

    static List<JsonObject> out = new ArrayList<>();

    static Tracker sanctuary() {
        out = new ArrayList<>();
        Tracker t = new Tracker(out::add);
        t.updateLocation(true, true, true, "Arachne's Sanctuary", "", T);
        return t;
    }

    static List<String> kinds() {
        return out.stream().map(e -> e.get("kind").getAsString()).toList();
    }

    static JsonObject last(String kind) {
        for (int i = out.size() - 1; i >= 0; i--) if (out.get(i).get("kind").getAsString().equals(kind)) return out.get(i);
        throw new AssertionError("no " + kind + " event in " + kinds());
    }

    public static void main(String[] args) {
        fullCrystalFight();
        otherPlayersRitualSetsTierButCostsNothing();
        relayedDeathIsIgnored();
        missedSpawnIsRecovered();
        leavingTheAreaInterrupts();
        newRitualClosesAStuckFight();
        damageAfterFiveSecondsIsDropped();
        scavengerCoins();
        nothingOutsideTheSanctuary();
        Check.done("TrackerChecks");
    }

    static void fullCrystalFight() {
        Tracker t = sanctuary();
        t.message("§b[MVP+] Ollie§f placed an Arachne Crystal! Something is awakening!", ME, T);
        t.message("§c[BOSS] Arachne§f: A befitting welcome!", ME, T + 20_000);
        yes(t.fighting(), "fighting after spawn");
        t.message("ARACHNE DOWN!", ME, T + 32_000);
        t.message("   Your Damage: 312,550 (Position #1)", ME, T + 32_400);
        UUID stand = UUID.randomUUID();
        t.observeStand(stand, "§9Soul String §8x2", T + 33_000);
        t.observeStand(stand, "§9Soul String §8x2", T + 33_050); // same hologram, rescanned
        t.pickup("SOUL_STRING", 2, T + 35_000); // picking it up is the same reward
        t.pickup("ENCHANTED_STRING", 6, T + 35_100); // no hologram for this one: counts
        t.message("§6Tarantula Pet", ME, T + 36_000); // not a claim line: ignored

        eq(List.of("PLACE", "SPAWN", "DEATH", "DAMAGE", "LOOT", "LOOT"), kinds(), "event order");
        JsonObject spawn = last("SPAWN");
        eq("CRYSTAL", spawn.get("tier").getAsString(), "tier from own ritual");
        eq(true, spawn.get("confirmed").getAsBoolean(), "confirmed spawn");
        String fight = spawn.get("fight").getAsString();
        eq(fight, last("DEATH").get("fight").getAsString(), "death joins the fight");
        eq(312_550L, last("DAMAGE").get("damage").getAsLong(), "damage parsed");
        eq(2L, out.get(4).get("count").getAsLong(), "hologram count");
        eq("armor_stand", out.get(4).get("source").getAsString(), "hologram source");
        eq(fight, out.get(5).get("fight").getAsString(), "pickup joins the dead fight");
        eq("ARACHNE_CRYSTAL", out.get(0).get("item").getAsString(), "own placement is a cost");
        yes(out.get(0).get("id").getAsString().length() >= 8, "events carry ids");
    }

    static void otherPlayersRitualSetsTierButCostsNothing() {
        Tracker t = sanctuary();
        t.message("[VIP] Someone placed an Arachne's Calling! (1/4)", ME, T);
        t.message("Someone placed an Arachne's Calling! Something is awakening! (4/4)", ME, T + 5_000);
        t.message("[BOSS] Arachne: Ahhhh...A Calling...", ME, T + 25_000);
        eq(List.of("SPAWN"), kinds(), "no PLACE for another player's fragments");
        eq("CALLING", last("SPAWN").get("tier").getAsString(), "tier from their ritual");
    }

    static void relayedDeathIsIgnored() {
        Tracker t = sanctuary();
        t.message("[BOSS] Arachne: A befitting welcome!", ME, T);
        t.message("ARACHNE DOWN!", ME, T + 10_000);
        t.message("ARACHNE DOWN!", ME, T + 10_500);
        eq(List.of("SPAWN", "DEATH"), kinds(), "second death line dropped");
    }

    static void missedSpawnIsRecovered() {
        Tracker t = sanctuary();
        t.message("[BOSS] Arachne: You dare to fight me?", ME, T);
        eq(false, last("SPAWN").get("confirmed").getAsBoolean(), "recovered spawn is unconfirmed");
        t.message("[BOSS] Arachne: A befitting welcome!", ME, T + 1_000);
        eq(List.of("SPAWN", "SPAWN"), kinds(), "late welcome line upgrades the same fight");
        eq(out.get(0).get("fight").getAsString(), out.get(1).get("fight").getAsString(), "same fight id");
        eq(true, out.get(1).get("confirmed").getAsBoolean(), "now confirmed");
        // After the death, stray dialogue must not start another fight without a ritual.
        t.message("ARACHNE DOWN!", ME, T + 9_000);
        t.message("[BOSS] Arachne: You dare to fight me?", ME, T + 12_000);
        eq(3, out.size(), "no new fight from old dialogue");
    }

    static void leavingTheAreaInterrupts() {
        Tracker t = sanctuary();
        t.message("[BOSS] Arachne: A befitting welcome!", ME, T);
        t.updateLocation(true, true, false, "Hub", "", T + 4_000);
        eq("LEFT_AREA", last("INTERRUPT").get("reason").getAsString(), "leaving ends the fight");
        yes(!t.fighting(), "not fighting after leaving");
        t.resetContext(T + 5_000, Event.Interrupt.DISCONNECT);
        eq(2, out.size(), "nothing to interrupt twice");
    }

    static void newRitualClosesAStuckFight() {
        Tracker t = sanctuary();
        t.message("[BOSS] Arachne: A befitting welcome!", ME, T);
        // Death line missed. A minute later, a new crystal:
        t.message("Ollie placed an Arachne Crystal! Something is awakening!", ME, T + 60_000);
        eq(List.of("SPAWN", "INTERRUPT", "PLACE"), kinds(), "stuck fight interrupted, new cost recorded");
        eq("NEW_RITUAL", last("INTERRUPT").get("reason").getAsString(), "reason");
    }

    static void damageAfterFiveSecondsIsDropped() {
        Tracker t = sanctuary();
        t.message("[BOSS] Arachne: A befitting welcome!", ME, T);
        t.message("ARACHNE DOWN!", ME, T + 10_000);
        t.tick(T + 16_000);
        t.message("Your Damage: 50,000", ME, T + 16_000);
        eq(List.of("SPAWN", "DEATH"), kinds(), "late damage line not reported");
    }

    static void scavengerCoins() {
        Tracker t = sanctuary();
        t.message("[BOSS] Arachne: A befitting welcome!", ME, T);
        t.observePurse(List.of("Purse: 1,000,000"), false, T + 1_000);
        t.observePurse(List.of("Purse: 1,000,000"), false, T + 2_000);
        t.observePurse(List.of("Purse: 1,001,500 (+1,500)"), false, T + 3_000);
        t.observePurse(List.of("Purse: 1,001,500 (+1,500)"), false, T + 3_500); // same display again
        eq(List.of("SPAWN", "COINS"), kinds(), "one coin event");
        eq(1_500.0, last("COINS").get("amount").getAsDouble(), "amount");
    }

    static void nothingOutsideTheSanctuary() {
        out = new ArrayList<>();
        Tracker t = new Tracker(out::add);
        t.updateLocation(true, true, false, "Hub", "", T);
        t.message("Ollie placed an Arachne Crystal! Something is awakening!", ME, T);
        t.message("ARACHNE DOWN!", ME, T + 1_000);
        eq(0, out.size(), "no events away from Arachne");
    }
}
