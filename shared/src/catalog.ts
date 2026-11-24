/**
 * Item catalog and fixed sell prices. Ported from v1.5.0 (`skyblock/Catalog.java`,
 * `pricing/NpcPrices.java`). The mod has its own copy of the IDs in `Catalog.java`;
 * keep the two lists in step.
 */

/** Stable SkyBlock item IDs → display names, in display order. */
export const ITEMS = {
  SOUL_STRING: 'Soul String',
  ARACHNE_FRAGMENT: 'Arachne Fragment',
  ENCHANTED_STRING: 'Enchanted String',
  ENCHANTED_SPIDER_EYE: 'Enchanted Spider Eye',
  STRING: 'String',
  SPIDER_EYE: 'Spider Eye',
  DARK_QUEENS_SOUL_DROP: "Dark Queen's Soul",
  ARACHNE_HELMET: "Arachne's Helmet",
  ARACHNE_CHESTPLATE: "Arachne's Chestplate",
  ARACHNE_LEGGINGS: "Arachne's Leggings",
  ARACHNE_BOOTS: "Arachne's Boots",
  LUXURIOUS_SPOOL: 'Luxurious Spool',
  ARACHNE_FANG: "Arachne's Fang",
  ARACHNE_SHARD: 'Arachne Shard',
  ARACK: 'Arack',
  ESSENCE_SPIDER: 'Spider Essence',
  TARANTULA_EPIC: 'Tarantula Pet (Epic)',
  TARANTULA_LEGENDARY: 'Tarantula Pet (Legendary)',
} as const satisfies Record<string, string>;

export type ItemId = keyof typeof ITEMS;

/**
 * What an item gives when salvaged at the Spider Tamer, for the "value armour as essence"
 * setting. Hypixel SkyBlock wiki, Salvaging and Arachne's Armor pages: every Arachne's Armor
 * piece salvages for 5 Spider Essence (each star on a piece would add 2 more; drops have none).
 */
export const SALVAGE: Partial<Record<ItemId, { item: 'ESSENCE_SPIDER'; count: number }>> = {
  ARACHNE_HELMET: { item: 'ESSENCE_SPIDER', count: 5 },
  ARACHNE_CHESTPLATE: { item: 'ESSENCE_SPIDER', count: 5 },
  ARACHNE_LEGGINGS: { item: 'ESSENCE_SPIDER', count: 5 },
  ARACHNE_BOOTS: { item: 'ESSENCE_SPIDER', count: 5 },
};

/** Summon items. These are costs, never loot. */
export const SUMMON_ITEMS = {
  ARACHNE_CRYSTAL: 'Arachne Crystal',
  ARACHNE_KEEPER_FRAGMENT: "Arachne's Calling",
} as const;

export type SummonItemId = keyof typeof SUMMON_ITEMS;

export function itemName(id: string): string {
  return (
    (ITEMS as Record<string, string>)[id] ?? (SUMMON_ITEMS as Record<string, string>)[id] ?? id
  );
}

/**
 * NPC sell values; pets use George's per-rarity sale price. 0 means "no NPC sale".
 * Sources (from v1.5.0): api.hypixel.net/v2/resources/skyblock/items and the wiki's
 * George price table.
 */
export const NPC_PRICES: Record<ItemId, number> = {
  SOUL_STRING: 5_000,
  ARACHNE_FRAGMENT: 500,
  ENCHANTED_STRING: 576,
  ENCHANTED_SPIDER_EYE: 480,
  STRING: 3,
  SPIDER_EYE: 3,
  DARK_QUEENS_SOUL_DROP: 5_000,
  ARACHNE_HELMET: 2_000,
  ARACHNE_CHESTPLATE: 2_000,
  ARACHNE_LEGGINGS: 2_000,
  ARACHNE_BOOTS: 2_000,
  LUXURIOUS_SPOOL: 1,
  ARACHNE_FANG: 500,
  ARACHNE_SHARD: 0,
  ARACK: 5_000,
  ESSENCE_SPIDER: 0,
  TARANTULA_EPIC: 2_000,
  TARANTULA_LEGENDARY: 100_000,
};

/** Shaggy's Arachne Crystal recipe (v1.5.0 `Config.recipeCost`). */
export const CRYSTAL_RECIPE: Partial<Record<ItemId, number>> = {
  ARACHNE_FRAGMENT: 2,
  ENCHANTED_SPIDER_EYE: 16,
  ENCHANTED_STRING: 16,
};

/** Drops counted as "RNG" for profit-without-RNG style stats. */
export const RNG_ITEMS: ReadonlySet<string> = new Set([
  'TARANTULA_EPIC',
  'TARANTULA_LEGENDARY',
  'ARACHNE_FANG',
]);

/** Bazaar product IDs the server snapshots: every catalog item plus the summon items. */
export const PRICE_WATCHLIST: readonly string[] = [
  ...Object.keys(ITEMS).filter((id) => !id.startsWith('TARANTULA_')),
  ...Object.keys(SUMMON_ITEMS),
  'BOOSTER_COOKIE',
];

/**
 * "What would this cost in real money?" The only official route from money to coins is:
 * buy SkyBlock Gems on the Hypixel Store, spend them on Booster Cookies (325 gems each,
 * from Elizabeth), and sell the cookies on the Bazaar. Nobody actually buys coins this way;
 * it is a fun comparison, not a real price.
 */
export const GEMS_PER_COOKIE = 325;
/** The 1,800-gem pack (1,750 + 50 bonus) on the Hypixel Store, as priced in Nov 2026. */
export const GEM_PACK = { gems: 1800, GBP: 13.63, USD: 17.99 } as const;
export type Currency = 'GBP' | 'USD';

/** Real money for `coins`, given what one Booster Cookie instantly sells for on the Bazaar. */
export function coinsToMoney(coins: number, cookieCoins: number, currency: Currency): number {
  if (!(cookieCoins > 0)) return 0;
  const cookies = coins / cookieCoins;
  return ((cookies * GEMS_PER_COOKIE) / GEM_PACK.gems) * GEM_PACK[currency];
}

/**
 * SkyBlock rarity of each drop, and the colour the game shows it in (Minecraft's own chat
 * colours). Same mapping as v1.5.0's ItemRarity. Used to colour drops on the dashboard.
 */
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'SPECIAL';

export const RARITY_COLOUR: Record<Rarity, string> = {
  COMMON: '#ffffff',
  UNCOMMON: '#55ff55',
  RARE: '#5555ff',
  EPIC: '#aa00aa',
  LEGENDARY: '#ffaa00',
  SPECIAL: '#ff55ff',
};

const RARITY: Partial<Record<string, Rarity>> = {
  ENCHANTED_STRING: 'UNCOMMON',
  ENCHANTED_SPIDER_EYE: 'UNCOMMON',
  LUXURIOUS_SPOOL: 'UNCOMMON',
  ARACHNE_FANG: 'UNCOMMON',
  SOUL_STRING: 'RARE',
  ARACHNE_FRAGMENT: 'RARE',
  ARACHNE_SHARD: 'RARE',
  ARACHNE_HELMET: 'RARE',
  ARACHNE_CHESTPLATE: 'RARE',
  ARACHNE_LEGGINGS: 'RARE',
  ARACHNE_BOOTS: 'RARE',
  ARACK: 'EPIC',
  DARK_QUEENS_SOUL_DROP: 'EPIC',
  TARANTULA_EPIC: 'EPIC',
  TARANTULA_LEGENDARY: 'LEGENDARY',
  ESSENCE_SPIDER: 'SPECIAL',
};

export function rarity(item: string): Rarity {
  return RARITY[item] ?? 'COMMON';
}

export function rarityColour(item: string): string {
  return RARITY_COLOUR[rarity(item)];
}

/**
 * Base drop chances from the Hypixel SkyBlock wiki (hypixelskyblock.minecraft.wiki/w/Arachne,
 * read 17 Nov 2026). Callings summon the Lv300 boss, a crystal the Lv500 one. Only the
 * chances the wiki lists are here; anything missing is shown as "no wiki figure".
 * Magic Find and pet luck raise these for real players, so observed rates usually come out
 * higher. Dark Queen's Soul from Lv500 is 100% for whoever placed the crystal and 50% for the
 * top three in damage, so it is left out (it depends on who placed).
 */
/**
 * Drops every kill gets, with the amount range the wiki lists (Hypixel SkyBlock wiki, Arachne,
 * checked 17 Nov 2026). For these a "chance" says nothing; the page compares the average
 * amount per kill with this range instead. Dark Queen's Soul is left out: whether you get it
 * depends on your place in the fight, which the mod doesn't see.
 */
export const WIKI_DROP_AMOUNT: Record<'CALLING' | 'CRYSTAL', Partial<Record<ItemId, { min: number; max: number }>>> = {
  CALLING: {
    STRING: { min: 10, max: 20 },
    ENCHANTED_STRING: { min: 0, max: 2 },
    SPIDER_EYE: { min: 10, max: 20 },
    ENCHANTED_SPIDER_EYE: { min: 0, max: 2 },
    SOUL_STRING: { min: 1, max: 10 },
    ESSENCE_SPIDER: { min: 8, max: 8 },
    LUXURIOUS_SPOOL: { min: 1, max: 1 },
    ARACHNE_FRAGMENT: { min: 1, max: 1 },
  },
  CRYSTAL: {
    STRING: { min: 10, max: 60 },
    ENCHANTED_STRING: { min: 0, max: 6 },
    SPIDER_EYE: { min: 10, max: 60 },
    ENCHANTED_SPIDER_EYE: { min: 0, max: 6 },
    SOUL_STRING: { min: 1, max: 44 },
    ESSENCE_SPIDER: { min: 30, max: 30 },
  },
};

export const WIKI_DROP_CHANCE: Record<'CALLING' | 'CRYSTAL', Partial<Record<ItemId, number>>> = {
  CALLING: {
    ARACHNE_SHARD: 0.25,
    ARACHNE_FANG: 0.1,
    ARACHNE_HELMET: 0.1,
    ARACHNE_CHESTPLATE: 0.1,
    ARACHNE_LEGGINGS: 0.1,
    ARACHNE_BOOTS: 0.1,
    TARANTULA_EPIC: 0.02,
  },
  CRYSTAL: {
    ARACK: 0.25,
    ARACHNE_HELMET: 0.25,
    ARACHNE_CHESTPLATE: 0.25,
    ARACHNE_LEGGINGS: 0.25,
    ARACHNE_BOOTS: 0.25,
  },
};
