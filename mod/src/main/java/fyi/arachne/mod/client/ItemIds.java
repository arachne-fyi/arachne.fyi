package fyi.arachne.mod.client;

import fyi.arachne.mod.skyblock.LootLabels;

import com.google.gson.JsonParser;

import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;

/** SkyBlock item id of a stack, from its custom data; ported from v1.5.0. */
public final class ItemIds {
    public static String of(ItemStack stack) {
        CustomData custom = stack.get(DataComponents.CUSTOM_DATA);
        if (custom != null) {
            CompoundTag root = custom.copyTag();
            CompoundTag attrs = root.getCompound("ExtraAttributes").orElse(root);
            String id = attrs.getStringOr("id", "");
            if (id.equals("PET") || id.startsWith("TARANTULA;")) {
                try {
                    var pet =
                            JsonParser.parseString(attrs.getStringOr("petInfo", "{}"))
                                    .getAsJsonObject();
                    if (pet.has("type")
                            && pet.get("type").getAsString().equals("TARANTULA")
                            && pet.has("tier")) {
                        String tier = pet.get("tier").getAsString();
                        if (tier.equals("EPIC") || tier.equals("LEGENDARY")) {
                            return "TARANTULA_" + tier;
                        }
                    }
                    return "";
                } catch (RuntimeException ignored) {
                    return "";
                }
            }
            if (!id.isEmpty()) {
                return id;
            }
        }
        LootLabels.Drop drop = LootLabels.parse(TextFormat.legacy(stack.getHoverName()));
        return drop == null ? "" : drop.item();
    }

    private ItemIds() {}
}
