package fyi.arachne.mod.client;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.network.chat.TextColor;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Turns a chat Component into a legacy string with § colour codes. {@code getString()} would
 * drop the colours, and a pet's rarity on Hypixel is only visible as its colour. Ported from
 * v1.5.0 {@code LootLabels.formatted}.
 */
public final class TextFormat {
    /** RGB of each of the 16 legacy colours → its code character (0-9, a-f). */
    private static final Map<Integer, Character> LEGACY = new HashMap<>();

    static {
        for (char code : "0123456789abcdef".toCharArray()) {
            LEGACY.put(TextColor.fromLegacyFormat(ChatFormatting.getByCode(code)).getValue(), code);
        }
    }

    public static String legacy(Component text) {
        if (text == null) return "";
        StringBuilder result = new StringBuilder();
        text.visit(
                (style, part) -> {
                    char code = 'r';
                    if (style.getColor() != null) {
                        code = LEGACY.getOrDefault(style.getColor().getValue(), 'r');
                    }
                    result.append('§').append(code).append(part);
                    return Optional.empty();
                },
                Style.EMPTY);
        return result.toString();
    }

    private TextFormat() {}
}
