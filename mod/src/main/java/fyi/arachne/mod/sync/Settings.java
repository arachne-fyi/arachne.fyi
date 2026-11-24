package fyi.arachne.mod.sync;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonParseException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Everything the player can change, saved as {@code config/arachnefyi/settings.json}.
 *
 * <p>The token sits in this file in plain text, like any launcher-side secret. It can only
 * write events for its owner and can be revoked from the dashboard at any time.
 */
public final class Settings {
    public enum Scope {
        GROUP,
        USER,
        ACCOUNT
    }

    /** How much the HUD shows: just profit, the usual lines, or everything. */
    public enum HudStyle {
        MINIMAL,
        NORMAL,
        FULL
    }

    public enum Window {
        TODAY,
        WEEK,
        ALL
    }

    private static final Pattern TOKEN = Pattern.compile("^al_[A-Za-z0-9_-]{20,}$");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public String endpoint = "";
    public String token = "";
    public boolean paused = false;
    public boolean hud = true;
    public Scope scope = Scope.GROUP;
    public Window window = Window.TODAY;
    public int hudX = 4;
    public int hudY = 4;
    public HudStyle hudStyle = HudStyle.NORMAL;
    /** Adds a line saying where tracking thinks you are; for "why didn't it count?". */
    public boolean debug = false;
    /** Look for a newer build on the download page once per game start. */
    public boolean updateCheck = true;

    public boolean paired() {
        return !endpoint.isEmpty() && !token.isEmpty();
    }

    public static boolean validToken(String token) {
        return token != null && TOKEN.matcher(token).matches();
    }

    /**
     * Accepts "app.arachne.fyi", "https://app.arachne.fyi/" and so on. Plain http is only
     * allowed for this computer or the local network, so a token never crosses the
     * internet unencrypted.
     */
    public static String normalizeEndpoint(String input) {
        String url = input.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (!url.contains("://")) url = "https://" + url;
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.startsWith("https://")) return url;
        if (lower.matches("^http://(localhost|127\\.0\\.0\\.1|192\\.168\\.[0-9.]+|10\\.[0-9.]+)(:[0-9]+)?$")) return url;
        throw new IllegalArgumentException("Use an https:// address (plain http only works for localhost or your LAN).");
    }

    public static Settings load(Path file) {
        try {
            if (Files.exists(file)) {
                Settings s = GSON.fromJson(Files.readString(file, StandardCharsets.UTF_8), Settings.class);
                if (s != null) return s.validated();
            }
        } catch (IOException | JsonParseException ignored) {
            // A damaged settings file falls back to defaults; the player can pair again.
        }
        return new Settings();
    }

    private Settings validated() {
        if (endpoint == null) endpoint = "";
        if (token == null || !validToken(token)) token = "";
        if (scope == null) scope = Scope.GROUP;
        if (window == null) window = Window.TODAY;
        if (hudStyle == null) hudStyle = HudStyle.NORMAL;
        hudX = Math.max(0, hudX);
        hudY = Math.max(0, hudY);
        return this;
    }

    public void save(Path file) {
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, GSON.toJson(this), StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException ignored) {
            // Settings are re-saved on the next change.
        }
    }
}
