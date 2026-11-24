package fyi.arachne.mod.sync;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.function.Consumer;

/**
 * One-off calls to the website that are not event syncing: trading a pairing code for a
 * token, and checking for a newer build. Both run on a background thread and report back
 * through a callback (which may run on that thread).
 */
public final class WebCalls {
    /** Where codes from the dashboard are traded, unless the player names another server. */
    public static final String DEFAULT_ENDPOINT = "https://app.arachne.fyi";
    /** The public download page's API. */
    public static final String PUBLIC_SITE = "https://arachne.fyi";

    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public static boolean looksLikeCode(String s) {
        return s != null && s.trim().toUpperCase(java.util.Locale.ROOT).matches("^[A-Z0-9]{6}$");
    }

    public record Paired(String endpoint, String token, String user) {}

    /** Trade a six-letter code from the dashboard for a token. {@code onError} gets a sentence. */
    public static void pairWithCode(String endpoint, String code, Consumer<Paired> onOk, Consumer<String> onError) {
        run(() -> {
            JsonObject body = new JsonObject();
            body.addProperty("code", code.trim().toUpperCase(java.util.Locale.ROOT));
            var req = HttpRequest.newBuilder(URI.create(endpoint + "/api/v1/pair"))
                    .timeout(Duration.ofSeconds(15))
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();
            var res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 404) {
                onError.accept("That code is wrong or more than 10 minutes old. Get a new one on the dashboard.");
                return;
            }
            if (res.statusCode() == 403 && res.body().contains("read_only")) {
                onError.accept("That server is read only (offline dev mode), so it can't pair. Use one started by start.bat.");
                return;
            }
            if (res.statusCode() == 429) {
                onError.accept("Too many tries. Wait a minute and run the command again.");
                return;
            }
            if (res.statusCode() != 200) {
                onError.accept("The server answered " + res.statusCode() + ". Try again in a minute.");
                return;
            }
            JsonObject r = JsonParser.parseString(res.body()).getAsJsonObject();
            String token = r.get("token").getAsString();
            // Trust the address we asked, not one in the reply, for where the token is used.
            onOk.accept(new Paired(endpoint, token, r.has("user") ? r.get("user").getAsString() : ""));
        }, onError);
    }

    /**
     * Is there a newer build for this Minecraft version? Calls {@code onNewer} with its
     * version only when there is.
     */
    public static void checkForUpdate(String base, String modVersion, String minecraftVersion, Consumer<String> onNewer) {
        run(() -> {
            var req = HttpRequest.newBuilder(URI.create(base + "/api/public/versions")).timeout(Duration.ofSeconds(15)).GET().build();
            var res = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) return;
            String newest = newestFor(JsonParser.parseString(res.body()).getAsJsonObject(), minecraftVersion);
            if (newest != null && !newest.equals(modVersion)) onNewer.accept(newest);
        }, e -> {});
    }

    /** The newest build's mod version for one Minecraft version, from /api/public/versions. */
    static String newestFor(JsonObject versions, String minecraftVersion) {
        JsonArray groups = versions.getAsJsonArray("versions");
        if (groups == null) return null;
        for (JsonElement g : groups) {
            JsonObject group = g.getAsJsonObject();
            if (!minecraftVersion.equals(group.get("minecraft").getAsString())) continue;
            JsonArray builds = group.getAsJsonArray("builds");
            return builds.isEmpty() ? null : builds.get(0).getAsJsonObject().get("mod").getAsString();
        }
        return null;
    }

    private interface Task {
        void run() throws Exception;
    }

    private static void run(Task task, Consumer<String> onError) {
        Thread t = new Thread(() -> {
            try {
                task.run();
            } catch (Exception e) {
                onError.accept("Could not reach the server: " + e.getClass().getSimpleName());
            }
        }, "arachne-fyi-web");
        t.setDaemon(true);
        t.start();
    }

    private WebCalls() {}
}
