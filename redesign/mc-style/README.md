# Minecraft-style look (18 Nov 2026)

- web/src/mc.css: the block kit (copy-paste components between `@component` / `@end` markers).
- web/src/mc-theme.css: GENERATED from theme.src.css here. It restyles the existing classes.
  Edit theme.src.css, then run: python gen_theme.py theme.src.css > ..\..\web\src\mc-theme.css
- web/src/mc-bg.ts: mounts the panorama (site.ts on public pages, main.tsx on the dashboard, dimmed).
- Mockups: https://claude.ai/artifact/ULuqXo3rDEC7FWmKVkTzzo
- Originals of changed files: redesign\backup\mc-style\
