/*
 * Item pictures. Drop <ITEM_ID>.png files into src/icons/items/ (see the README there) and they
 * are used everywhere an item is shown; items without one keep the built-in icon from
 * public/icons/. Found at build time, so the browser never asks for a picture that isn't there.
 */
const files = import.meta.glob('./icons/items/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The built-in pictures, for items that have no file in src/icons/items/. */
const BUILT_IN: Record<string, string> = {
  COINS: '/icons/coin.svg',
  SOUL_STRING: '/icons/string.svg',
  ESSENCE_SPIDER: '/icons/essence.svg',
  KILL: '/icons/kill.svg',
};

/** Picture for an item ID (or COINS / KILL), or null if there is none. */
export function itemIcon(id: string): string | null {
  return files[`./icons/items/${id}.png`] ?? BUILT_IN[id] ?? null;
}
