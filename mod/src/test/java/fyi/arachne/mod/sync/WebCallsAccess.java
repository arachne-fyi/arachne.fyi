package fyi.arachne.mod.sync;

import com.google.gson.JsonObject;

/** Lets the checks reach WebCalls' package-private parsing. */
public final class WebCallsAccess {
    public static String newestFor(JsonObject versions, String minecraft) {
        return WebCalls.newestFor(versions, minecraft);
    }

    private WebCallsAccess() {}
}
