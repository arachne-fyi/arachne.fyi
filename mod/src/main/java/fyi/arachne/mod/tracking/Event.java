package fyi.arachne.mod.tracking;

import com.google.gson.JsonObject;

import java.util.UUID;

/**
 * One raw observation, in the wire format of {@code shared/src/events.ts}. The mod never
 * prices anything or decides what counts as a kill; it only reports what it saw.
 *
 * <p>Events are plain JSON objects so the queue can write them to disk and the sender can put
 * them in a batch without a second representation. The static factories are the only place
 * that builds them, which keeps the field names in one spot.
 */
public final class Event {
    private Event() {}

    public enum Tier {
        CRYSTAL,
        CALLING,
        UNKNOWN
    }

    public enum Interrupt {
        LEFT_AREA,
        DISCONNECT,
        NEW_RITUAL,
        OTHER
    }

    /** Random, so two clients can never collide; the server dedupes retries on it. */
    public static String newId() {
        return UUID.randomUUID().toString();
    }

    /** Fight ids only need to be unique per account; 12 characters is plenty. */
    public static String newFightId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private static JsonObject base(String kind, long ts) {
        JsonObject o = new JsonObject();
        o.addProperty("id", newId());
        o.addProperty("ts", ts);
        o.addProperty("kind", kind);
        return o;
    }

    public static JsonObject spawn(long ts, String fight, Tier tier, boolean confirmed) {
        JsonObject o = base("SPAWN", ts);
        o.addProperty("fight", fight);
        o.addProperty("tier", tier.name());
        o.addProperty("confirmed", confirmed);
        return o;
    }

    public static JsonObject death(long ts, String fight) {
        JsonObject o = base("DEATH", ts);
        o.addProperty("fight", fight);
        return o;
    }

    public static JsonObject damage(long ts, String fight, long damage) {
        JsonObject o = base("DAMAGE", ts);
        o.addProperty("fight", fight);
        o.addProperty("damage", damage);
        return o;
    }

    public static JsonObject interrupt(long ts, String fight, Interrupt reason) {
        JsonObject o = base("INTERRUPT", ts);
        o.addProperty("fight", fight);
        o.addProperty("reason", reason.name());
        return o;
    }

    /** item is ARACHNE_CRYSTAL or ARACHNE_KEEPER_FRAGMENT. */
    public static JsonObject place(long ts, String item, String fight) {
        JsonObject o = base("PLACE", ts);
        o.addProperty("item", item);
        o.addProperty("count", 1);
        if (fight != null) o.addProperty("fight", fight);
        return o;
    }

    /** source is armor_stand, pickup or pet_claim. */
    public static JsonObject loot(long ts, String item, long count, String source, String fight) {
        JsonObject o = base("LOOT", ts);
        o.addProperty("item", item);
        o.addProperty("count", count);
        o.addProperty("source", source);
        if (fight != null) o.addProperty("fight", fight);
        return o;
    }

    public static JsonObject coins(long ts, double amount, String fight) {
        JsonObject o = base("COINS", ts);
        o.addProperty("amount", amount);
        o.addProperty("source", "scavenger");
        if (fight != null) o.addProperty("fight", fight);
        return o;
    }
}
