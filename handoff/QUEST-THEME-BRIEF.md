# Brief for the Meta Quest app build: make the headset look and feel like the website

Owner's request (November 20, 2026): "I want the Meta app to be a perfect replica of font, feel and theme, but still in
its VR 3D individual windows."

The website (`bongs-git/bongs-git.github.io`, folder `indai/`, live at https://bongs-git.github.io/indai/) is the
reference. The Quest app (this repo: `index.html`, `js/`) keeps everything that makes it a headset app. Only its look changes.

## What must not change

- The 3D layout: every panel stays its own window in space, grabbable and placeable as now. No flat page.
- Gestures, scenes, voice, the tutorial, recentering, the APK build.
- The shared brain modules, byte for byte: `feeds.js`, `market.js`, `analysis.js`, `signals.js`, `options.js`,
  `relay.js`, `indai.js`, `voice.js`, `speech.js`, `store.js`. The website copies them with `indai/sync.sh`; a change
  there changes both apps.
- Anything under `supabase/` (the back end) and the contract in `HANDOFF.md`.
- No feature work in this task. If something is missing on the headset, note it in `FEATURES.md`, do not build it here.

## The theme, exactly

Colours. Replace the headset's palette with the website's. Today's values are in `index.html` (`:root`) and `js/hud.js` (`C`).

| Role | Website (use this) | Headset today |
|---|---|---|
| Page / deepest background | `#050709` | `#05080f` |
| Panel background | `#0a0e14` | `#0c121d`, canvas `rgba(9,14,24,0.80)` |
| Raised surface (inputs, rows) | `#111721` | `#121a28`, canvas `rgba(16,24,38,0.90)` |
| Hover / pressed | `#18202c` | `rgba(24,34,52,0.95)` |
| Hairline border | `rgba(255,255,255,.08)` | `rgba(255,255,255,.09)` |
| Stronger border | `rgba(255,255,255,.15)` | `rgba(255,255,255,.16)` |
| Text | `#f3f1ea` | `#eef4fb` |
| Dim text | `#9aa3b2` | `#9aa8bb` |
| Faint text | `#647084` (canvas `#5f6a7a`) | `#66758a` |
| Gold (brand, primary, selected) | `#dcbf6e` | `#f0c674` |
| Text on gold | `#17120a` | |
| Gold wash / gold line | `rgba(220,191,110,.12)` / `rgba(220,191,110,.5)` | `rgba(240,198,116,0.35)` |
| Up | `#3ecf8e` | `#34d399` |
| Down | `#f2706b` | `#f87171` |
| Amber (warnings, gamma flip) | `#f0b34a` | `#fbbf24` |
| Sky (last price tag, info) | `#6ec3f2` | accent `#5ad1ff` |
| Violet (QQQ line, the trader's drawings) | `#a99bf5` | `#a78bfa` |
| White (SPY line, selected drawing) | `#fcfbf5` | `#f8fbff` |
| Chart grid | `rgba(255,255,255,0.055)` | `rgba(255,255,255,0.06)` |

The headset's cyan accent (`#5ad1ff`, used for panel outlines and highlights) goes: outlines become the hairline border,
and anything that marks "selected", "primary" or "brand" becomes gold. Sky is only for the last-price tag and neutral info.

Type. Geist for words, Geist Mono for every number, price, time and ticker read-out. The website ships the fonts itself:
copy `indai/fonts/geist.woff2` and `indai/fonts/geist-mono.woff2` into this repo and load them with `@font-face`
(weights 100 to 900), then drop the Google Fonts link so the headset works offline. Canvas panels must wait for
`document.fonts.load(...)` for both families before their first draw, or the first frame renders in the fallback face.
Weights on the website: 400 body, 500 buttons and numbers, 600 labels and emphasis, 700 the ticker name.

Panels. Background `#0a0e14`, 1px hairline border, 10px corner radius, 12px padding. The main chart panel carries the
website's gold corner brackets (`.framed` in `indai/css/app.css`): four short gold L-shapes at the corners, nothing else
glows. In VR keep panel backgrounds at 0.92 opacity or more so text holds its contrast against the scene.

Controls. Buttons: 1px stronger border, `rgba(255,255,255,.03)` fill, 8px radius. Primary: gold fill, `#17120a`
text, weight 600. Selected segment or toggle: gold wash with gold text. Win and loss buttons use the up and down colours
at 10% fill with a 50% border. Status pills are small rounded rectangles with the same colours.

Chart. Candles up `#3ecf8e`, down `#f2706b`. VWAP gold, dashed 6/4, 1.5px. Fast EMA cloud
`rgba(62,207,142,0.22)` / `rgba(242,112,107,0.22)`, slow cloud `rgba(110,195,242,0.13)` / `rgba(240,150,74,0.13)`.
Call wall in up, put wall in down, gamma flip in amber, dashed 9/6. Last price: a sky tag with `#04121c` text.
Labels sit on a `rgba(5,7,9,0.72)` backing so they never fight the candles. The website's drawing code is
`indai/js/chart.js`; copy its constants, not its DOM handling.

Feel. Calm and dense, like an instrument panel: no gradients, no glow, no drop shadows, thin lines, generous use of
dim and faint text for anything secondary, gold used sparingly. Motion stays as the headset has it.

## How to check it

1. Put a headset panel screenshot next to the same panel on the website (phone width is the closest match) for:
   watchlist, chart, GEX levels, lead/lag, risk breaker, today's plan, the conversation, settings, and a setup alert.
   Colours, fonts, weights, radii and spacing should read as the same product.
2. The existing headset tests (the list in `README.md`, the WebXR emulator run) pass unchanged.
3. `git diff` shows no change in the shared brain modules or under `supabase/`.
4. One row in `FEATURES.md` for the new look, and rebuild the APK with the logo icon while you are there
   (item 4 of the front-end backlog in `HANDOFF.md`).

Work on a branch, keep it to one pull request, and do not merge anything that touches the back end.
