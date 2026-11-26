package fyi.arachne.mod.skyblock;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which Hypixel server (lobby) the player is on, read from the sidebar's top line, for example
 * {@code 11/26/26 m12AB}. Every account in the same lobby sees the same boss, so the lobby is
 * what lets the server match their spawn and death reports up.
 */
public final class Lobby {
    // Date, then the server id: m12AB, mini12AB, M7C ... Only letters and digits.
    private static final Pattern LINE = Pattern.compile("\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\s+([A-Za-z]{1,8}\\d{1,4}[A-Za-z]{0,4})\\b");

    /** The lobby id from cleaned sidebar lines, or null when none is shown. */
    public static String find(List<String> sidebar) {
        if (sidebar == null) return null;
        for (String raw : sidebar) {
            Matcher m = LINE.matcher(LocationDetection.clean(raw));
            if (m.find()) return m.group(1).toLowerCase(java.util.Locale.ROOT);
        }
        return null;
    }

    /**
     * The boss key sent with spawn and death packets: the first 16 hex characters of
     * sha256("lobby|tier"). The lobby itself never leaves the PC, only this hash. Null when
     * the lobby is unknown (the server then matches by group instead).
     */
    public static String key(String lobby, String tier) {
        if (lobby == null || lobby.isEmpty()) return null;
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((lobby + "|" + (tier == null ? "" : tier)).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            return null; // every JVM has SHA-256; kept only for the checked exception
        }
    }

    private Lobby() {}
}
