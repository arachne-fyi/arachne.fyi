# Landing page redesign (static)

Open `index.html` in a browser. Nothing is wired up: the buttons do nothing and every
number is made up. The header links scroll to each section.

- `styles.css` holds all the styling. The Arachne Pixel fonts are embedded in it as
  data URLs so the page also works when opened straight from disk (Chrome refuses to load
  font files over file://). The same fonts are in `fonts/` for when this moves into the app.
- Fonts come from the new `build-font-pixel.py` (pixel grid, bold keeps gaps open, 0 bolds
  solid). Pixel text uses sizes that are multiples of 16px, where the font is sharpest.
