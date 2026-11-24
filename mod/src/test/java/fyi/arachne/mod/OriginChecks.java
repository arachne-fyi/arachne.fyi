package fyi.arachne.mod;

import static fyi.arachne.mod.Check.*;

import fyi.arachne.mod.skyblock.ServerOrigin;

/** The Alpha rule. Same cases as the server's test (platform.test.ts), so the two stay in step. */
public final class OriginChecks {
    public static void main(String[] args) {
        yes(new ServerOrigin("alpha.hypixel.net", null, null).alpha(), "alpha address");
        yes(new ServerOrigin("ALPHA.hypixel.net:25565", null, null).alpha(), "case and port");
        yes(new ServerOrigin("mc.hypixel.net", "Hypixel Alpha BungeeCord", null).alpha(), "brand says alpha");
        yes(new ServerOrigin("play.example", null, "Hypixel Network [ALPHA]").alpha(), "motd says alpha");
        yes(!new ServerOrigin("mc.hypixel.net", "Hypixel BungeeCord (2026.11.1)", "Hypixel Network").alpha(), "main server");
        yes(!new ServerOrigin("alphabet.hypixel.net", null, null).alpha(), "only the alpha host");
        yes(!new ServerOrigin(null, null, null).alpha(), "nothing known");
        done("OriginChecks");
    }
}
