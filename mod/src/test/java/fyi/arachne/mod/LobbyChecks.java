package fyi.arachne.mod;

import static fyi.arachne.mod.Check.*;

import fyi.arachne.mod.skyblock.Lobby;

import java.util.List;

/** Reading the Hypixel server id from the sidebar, and the boss key built from it. */
public final class LobbyChecks {
    public static void main(String[] args) {
        eq("m12ab", Lobby.find(List.of("SKYBLOCK", "11/26/26 m12AB", " Autumn 3rd")), "plain line");
        eq("mini7c", Lobby.find(List.of("§711/26/26 §8mini7C")), "colour codes");
        eq("m3d", Lobby.find(List.of("1/2/26  M3D  ")), "short date, extra spaces");
        eq(null, Lobby.find(List.of("Purse: 1,234", "www.hypixel.net")), "no lobby line");
        eq(null, Lobby.find(null), "no sidebar");
        // Same as node: sha256("m12ab|CRYSTAL").slice(0, 16); the server only checks the shape.
        eq("f74d27dbdd6023d8", Lobby.key("m12ab", "CRYSTAL"), "key matches sha256");
        yes(!Lobby.key("m12ab", "CRYSTAL").equals(Lobby.key("m12ac", "CRYSTAL")), "other lobby, other key");
        yes(!Lobby.key("m12ab", "CRYSTAL").equals(Lobby.key("m12ab", "CALLING")), "other tier, other key");
        eq(null, Lobby.key(null, "CRYSTAL"), "unknown lobby, no key");
        done("LobbyChecks");
    }
}
