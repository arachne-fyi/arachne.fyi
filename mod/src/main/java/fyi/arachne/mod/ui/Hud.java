package fyi.arachne.mod.ui;

import fyi.arachne.mod.client.ArachneFyi;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.ChatScreen;

import java.util.List;

/**
 * Draws {@link HudText} in the top-left corner. This is the only class that calls the
 * rendering API, so a future Minecraft rendering change only needs porting here. Since 26.2
 * the open screen and F1 state live on {@code Minecraft.gui} ({@code gui.screen()},
 * {@code gui.hud.isHidden()}).
 */
public final class Hud {
    private static final int PADDING = 4;
    private static final int LINE = 10;
    private static final int BACKGROUND = 0xA0150F1C;

    public static void draw(GuiGraphicsExtractor graphics) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.gui.hud.isHidden() || !ArachneFyi.settings().hud) return;
        if (mc.gui.screen() != null && !(mc.gui.screen() instanceof ChatScreen)) return;
        if (!ArachneFyi.tracker().skyBlock()) return;

        long now = System.currentTimeMillis();
        List<HudText.Line> lines =
                HudText.build(
                        ArachneFyi.settings(),
                        ArachneFyi.sync().status(),
                        ArachneFyi.local(),
                        ArachneFyi.tracker().fighting(),
                        ArachneFyi.tracker().fightStartedAt(),
                        now,
                        ArachneFyi.settings().debug ? ArachneFyi.tracker().areaReason(now) : null);
        if (ArachneFyi.onAlpha()) {
            lines = new java.util.ArrayList<>(lines);
            lines.add(0, new HudText.Line("Alpha server: not tracked", HudText.Tone.WARN));
        }
        var font = mc.font;
        int width = 0;
        for (HudText.Line line : lines) width = Math.max(width, font.width(line.text()));
        int x = ArachneFyi.settings().hudX;
        int y = ArachneFyi.settings().hudY;
        graphics.fill(x, y, x + width + PADDING * 2, y + lines.size() * LINE + PADDING * 2 - 2, BACKGROUND);
        int rowY = y + PADDING;
        for (HudText.Line line : lines) {
            graphics.text(font, line.text(), x + PADDING, rowY, colour(line.tone()), true);
            rowY += LINE;
        }
    }

    private static int colour(HudText.Tone tone) {
        return switch (tone) {
            case TITLE -> 0xFFECE3D2;
            case GOLD -> 0xFFF0B84A;
            case NORMAL -> 0xFFE0D8E8;
            case MUTED -> 0xFF9A8DA6;
            case WARN -> 0xFFF0705F;
            case GOOD -> 0xFF7BD88F;
        };
    }

    private Hud() {}
}
