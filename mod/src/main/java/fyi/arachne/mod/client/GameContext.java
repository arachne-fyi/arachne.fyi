package fyi.arachne.mod.client;

import fyi.arachne.mod.skyblock.LocationDetection;

import net.minecraft.client.Minecraft;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.PlayerScoreEntry;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.TeamColor;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** A snapshot of server-provided HUD data, including a reason when detection is waiting. */
public final class GameContext {
    public record Snapshot(
            boolean onHypixel,
            boolean skyBlock,
            boolean sanctuary,
            String detectionReason,
            String location,
            List<String> sidebarLines,
            List<String> tabLines) {
        public Snapshot {
            sidebarLines = List.copyOf(sidebarLines);
            tabLines = List.copyOf(tabLines);
        }
    }

    /** The server the client is connected to right now, or null between worlds. */
    public static fyi.arachne.mod.skyblock.ServerOrigin origin(Minecraft client) {
        var connection = client.getConnection();
        if (connection == null) return null;
        var server = client.getCurrentServer();
        return new fyi.arachne.mod.skyblock.ServerOrigin(
                server == null ? null : server.ip,
                connection.serverBrand(),
                server == null || server.motd == null ? null : server.motd.getString());
    }

    public static Snapshot snapshot(Minecraft client) {
        if (client.player == null || client.level == null || client.getConnection() == null) {
            return new Snapshot(
                    false, false, false, "Not connected to a world", "", List.of(), List.of());
        }
        var connection = client.getConnection();
        var server = client.getCurrentServer();
        String host = server == null ? "" : server.ip;
        Scoreboard scoreboard = client.level.getScoreboard();
        Objective sidebar = activeSidebar(scoreboard, client.player.getScoreboardName());
        String title = sidebar == null ? "" : sidebar.getDisplayName().getString();
        List<String> sidebarLines = readSidebarLines(scoreboard, sidebar);
        List<String> tabLines = readTabLines(client);
        var result =
                LocationDetection.detect(
                        host, connection.serverBrand(), title, sidebarLines, tabLines);
        List<String> diagnosticSidebar = new ArrayList<>();
        if (!title.isEmpty()) {
            diagnosticSidebar.add("Title: " + LocationDetection.clean(title));
        }
        diagnosticSidebar.addAll(sidebarLines);
        return new Snapshot(
                result.onHypixel(),
                result.skyBlock(),
                result.sanctuary(),
                result.detectionReason(),
                result.location(),
                diagnosticSidebar,
                tabLines);
    }

    private static List<String> readSidebarLines(Scoreboard scoreboard, Objective sidebar) {
        List<String> sidebarLines = new ArrayList<>();
        if (sidebar != null) {
            scoreboard.listPlayerScores(sidebar).stream()
                    .filter(entry -> !entry.isHidden())
                    .sorted(
                            Comparator.comparingInt(PlayerScoreEntry::value)
                                    .reversed()
                                    .thenComparing(
                                            PlayerScoreEntry::owner, String.CASE_INSENSITIVE_ORDER))
                    .limit(15)
                    .forEach(
                            entry -> {
                                // ownerName() respects modern per-score display components; team
                                // prefix/suffix are still needed.
                                String row =
                                        PlayerTeam.formatNameForTeam(
                                                        scoreboard.getPlayersTeam(entry.owner()),
                                                        entry.ownerName())
                                                .getString();
                                sidebarLines.add(LocationDetection.clean(row));
                            });
        }
        return sidebarLines;
    }

    private static List<String> readTabLines(Minecraft client) {
        return client.getConnection().getListedOnlinePlayers().stream()
                .map(
                        info ->
                                LocationDetection.clean(
                                        client.gui
                                                .hud
                                                .getTabList()
                                                .getNameForDisplay(info)
                                                .getString()))
                .toList();
    }

    /**
     * Mirrors the vanilla visible-sidebar choice, preventing stale hidden objectives from winning.
     */
    static Objective activeSidebar(Scoreboard scoreboard, String playerName) {
        var team = scoreboard.getPlayersTeam(playerName);
        if (team != null) {
            DisplaySlot slot = team.getColor().map(TeamColor::displaySlot).orElse(null);
            Objective colored = slot == null ? null : scoreboard.getDisplayObjective(slot);
            if (colored != null) {
                return colored;
            }
        }
        return scoreboard.getDisplayObjective(DisplaySlot.SIDEBAR);
    }

    public static boolean arena(Minecraft client) {
        return snapshot(client).sanctuary();
    }

    private GameContext() {}
}
