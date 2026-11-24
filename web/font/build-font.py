"""
Turns a Minecraft font sheet (ascii.png) into web fonts for the dashboard.

    pip install fonttools brotli pillow
    python web/font/build-font.py

Reads web/font/ascii.png, writes web/public/fonts/arachne-regular.woff2 and
arachne-bold.woff2. Re-run it after editing the sheet.

How it mirrors Minecraft:
- The sheet is a 16 x 16 grid; cell N holds character code N (so row 2 starts at space,
  0x20). Only printable ASCII (0x20-0x7E) is converted from it.
- Extra characters live in web/font/extra/, one 16 x 16 PNG per character, named by its
  Unicode code in hex (00A3.png is the pound sign). Same rules as a sheet cell.
- Width: blank columns on the right of a cell are trimmed, then one game pixel of spacing
  is added. Space is 4 game pixels wide.
- Bold: the glyph is drawn twice, the second copy one game pixel to the right, and the
  character gets one game pixel wider. Minecraft does this at draw time; here it is baked
  into a second font file, which stays sharp in the browser.
- A sheet with 16-pixel cells is drawn at double detail, so one game pixel is 2 sheet
  pixels. With 8-pixel cells it is 1.

Each lit sheet pixel becomes a small square in the outline, so the result is a crisp
pixel font at any size that is a whole multiple of the cell height in CSS pixels.
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

HERE = Path(__file__).resolve().parent
SHEET = HERE / "ascii.png"
OUT = HERE.parent / "public" / "fonts"

UNIT = 64  # font units per sheet pixel
FIRST, LAST = 0x20, 0x7E


def load_cells():
    image = Image.open(SHEET).convert("RGBA")
    if image.width != image.height or image.width % 16:
        raise SystemExit("ascii.png must be a square 16 x 16 grid")
    cell = image.width // 16
    pixels = image.load()
    cells = {}
    for code in range(FIRST, LAST + 1):
        x0, y0 = (code % 16) * cell, (code // 16) * cell
        cells[code] = [
            [pixels[x0 + x, y0 + y][3] > 127 for x in range(cell)] for y in range(cell)
        ]
    for png in sorted((HERE / "extra").glob("*.png")):
        extra = Image.open(png).convert("RGBA")
        if extra.size != (cell, cell):
            raise SystemExit(f"{png.name} must be {cell} x {cell}, like a sheet cell")
        px = extra.load()
        cells[int(png.stem, 16)] = [[px[x, y][3] > 127 for x in range(cell)] for y in range(cell)]
    return cell, cells


def thicken(grid, shift):
    """Bold: OR the glyph with itself moved `shift` pixels right."""
    width = len(grid[0]) + shift
    out = [[False] * width for _ in grid]
    for y, row in enumerate(grid):
        for x, lit in enumerate(row):
            if lit:
                out[y][x] = True
                out[y][x + shift] = True
    return out


def rectangles(grid):
    """Horizontal runs per row, merged downwards when the run below is identical."""
    runs = []
    for y, row in enumerate(grid):
        x = 0
        while x < len(row):
            if row[x]:
                start = x
                while x < len(row) and row[x]:
                    x += 1
                runs.append((y, start, x))
            else:
                x += 1
    merged = []
    for y, x0, x1 in runs:
        for rect in merged:
            if rect[1] == x0 and rect[2] == x1 and rect[3] == y:
                rect[3] = y + 1
                break
        else:
            merged.append([y, x0, x1, y + 1])
    return merged


def build(cell, cells, bold):
    game_px = max(1, cell // 8)
    ascent = round(cell * 7 / 8)
    codes = sorted(cells)
    names = [".notdef"] + [f"uni{code:04X}" for code in codes]
    glyphs, metrics = {}, {}

    pen = TTGlyphPen(None)
    glyphs[".notdef"] = pen.glyph()
    metrics[".notdef"] = (4 * game_px * UNIT, 0)

    for code in codes:
        grid = cells[code]
        if bold:
            grid = thicken(grid, game_px)
        used = [x for row in grid for x, lit in enumerate(row) if lit]
        if code == 0x20 or not used:
            advance = 4 * game_px + (game_px if bold else 0)
        else:
            advance = max(used) + 1 + game_px
        pen = TTGlyphPen(None)
        for top, x0, x1, bottom in rectangles(grid):
            # Sheet rows grow downwards; font units grow upwards from the baseline.
            yt = (ascent - top) * UNIT
            yb = (ascent - bottom) * UNIT
            pen.moveTo((x0 * UNIT, yb))
            pen.lineTo((x0 * UNIT, yt))
            pen.lineTo((x1 * UNIT, yt))
            pen.lineTo((x1 * UNIT, yb))
            pen.closePath()
        name = f"uni{code:04X}"
        glyphs[name] = pen.glyph()
        metrics[name] = (advance * UNIT, min(used) * UNIT if used else 0)

    family = "Arachne Pixel"
    style = "Bold" if bold else "Regular"
    fb = FontBuilder(cell * UNIT, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({code: f"uni{code:04X}" for code in codes})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ascent * UNIT, descent=-(cell - ascent) * UNIT)
    fb.setupNameTable(
        {
            "familyName": family,
            "styleName": style,
            # Full and PostScript names: browsers manage without them, but the server's image
            # renderer (resvg) skips a font that lacks them.
            "fullName": f"{family} {style}",
            "psName": f"ArachnePixel-{style}",
        }
    )
    fb.setupOS2(
        sTypoAscender=ascent * UNIT,
        sTypoDescender=-(cell - ascent) * UNIT,
        usWinAscent=ascent * UNIT,
        usWinDescent=(cell - ascent) * UNIT,
        usWeightClass=700 if bold else 400,
        fsSelection=0x20 if bold else 0x40,
    )
    fb.setupPost()
    fb.font["head"].macStyle = 1 if bold else 0
    fb.font.flavor = "woff2"
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"arachne-{style.lower()}.woff2"
    fb.save(str(path))
    print(f"wrote {path.relative_to(HERE.parent.parent)}")
    # The server draws link-preview images, and its renderer reads TrueType, not WOFF2.
    fb.font.flavor = None
    ttf = HERE.parent.parent / "server" / "assets" / f"arachne-{style.lower()}.ttf"
    ttf.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(ttf))
    print(f"wrote {ttf.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    cell, cells = load_cells()
    build(cell, cells, bold=False)
    build(cell, cells, bold=True)
