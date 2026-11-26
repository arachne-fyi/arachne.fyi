# Item icons

Put one PNG per item here, named by its SkyBlock item ID, for example:

    SOUL_STRING.png   ESSENCE_SPIDER.png   ARACHNE_FRAGMENT.png   ARACHNE_CRYSTAL.png
    ENCHANTED_STRING.png   ENCHANTED_SPIDER_EYE.png   ARACHNE_FANG.png   ...

Two extra names are not items: COINS.png (Scavenger coins) and KILL.png (kills).

Every file here is picked up at build time (src/item-icons.ts) and used everywhere the site
shows that item: the dashboard, the Graphs page and the landing page. An item with no file
here keeps the built-in pixel icon from public/icons/, or no icon.

Only add pictures you are allowed to publish. Textures from a resource pack belong to the
pack's artists: get their permission first (FurfSky Reborn is "all rights reserved").
