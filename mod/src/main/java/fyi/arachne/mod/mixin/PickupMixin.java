package fyi.arachne.mod.mixin;

import fyi.arachne.mod.client.ArachneFyi;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundTakeItemEntityPacket;
import net.minecraft.world.entity.item.ItemEntity;

import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Item pickups. The server tells the client "player X took item entity Y"; there is no Fabric
 * event for it, so this hooks the packet handler. Unchanged from v1.5.0.
 */
@Mixin(ClientPacketListener.class)
public abstract class PickupMixin {
    @Inject(method = "handleTakeItemEntity", at = @At("HEAD"))
    private void arachneFyi$pickup(ClientboundTakeItemEntityPacket packet, CallbackInfo ci) {
        Minecraft mc = Minecraft.getInstance();
        // Vanilla re-dispatches this handler to the client thread. Only observe that call.
        if (!mc.isSameThread() || mc.player == null || mc.level == null) return;
        if (packet.getPlayerId() != mc.player.getId()) return;
        if (mc.level.getEntity(packet.getItemId()) instanceof ItemEntity item) {
            int count = Math.min(packet.getAmount(), item.getItem().getCount());
            ArachneFyi.onPickup(item.getItem(), count);
        }
    }
}
