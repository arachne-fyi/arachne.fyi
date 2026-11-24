package fyi.arachne.mod.skyblock;

import com.google.gson.JsonObject;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which server the client is on, as raw text: the address typed into the server list, the
 * brand the server reports and its MOTD. Stamped on every event when it is recorded, so an
 * event still says where it came from after days in the offline queue.
 *
 * <p>The Alpha Hypixel Network (alpha.hypixel.net) is Hypixel's test server. Nothing earned
 * there is real, so the mod doesn't record it. The website decides again for itself from the
 * same three strings (rules.ts isAlphaOrigin); keep the two rules the same.
 */
public record ServerOrigin(String host, String brand, String motd) {
    private static final Pattern ALPHA_WORD = Pattern.compile("\\balpha\\b", Pattern.CASE_INSENSITIVE);

    public boolean alpha() {
        String h = host == null ? "" : host.toLowerCase(Locale.ROOT).trim().replaceAll(":\\d+$", "").replaceAll("\\.$", "");
        if (h.equals("alpha.hypixel.net") || h.endsWith(".alpha.hypixel.net")) return true;
        return (brand != null && ALPHA_WORD.matcher(brand).find()) || (motd != null && ALPHA_WORD.matcher(motd).find());
    }

    public JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("host", cut(host, 255));
        o.addProperty("brand", cut(brand, 200));
        o.addProperty("motd", cut(motd, 300));
        return o;
    }

    private static String cut(String s, int max) {
        return s == null ? null : s.length() > max ? s.substring(0, max) : s;
    }
}
