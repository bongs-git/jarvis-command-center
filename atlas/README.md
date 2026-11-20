# INDAI Market Pattern Atlas: data and engine

Source: **The Market Pattern Atlas, Corrected Direction Edition** (rev 1.1, November 20, 2026, 126 pages) by
Ini Akpabio, published under INDAI. © 2026 Ini Akpabio. All rights reserved. The data here was rebuilt from the
CSV and Python files embedded in the PDF and checked against its printed tables.

Ikpa's tasks for wiring this into INDAI: [`handoff/IKPA-ATLAS-TASKS.md`](../handoff/IKPA-ATLAS-TASKS.md).

## Files

| File | What it is |
|---|---|
| `indai_atlas_engine.js` | The reasoning layer. Plain JavaScript, no dependencies. Works with `require()`, in the browser and in Deno. |
| `index.mjs` | ESM entry point: `import createAtlas from './index.mjs'`. |
| `engine_test.mjs` | Checks the engine against the book's worked examples and printed tables. `node atlas/engine_test.mjs` (set `ATLAS_KB=/path/atlas_kb.json` if the data is not in this folder). |
| `atlas_kb.json` | The knowledge base, about 490 KB. **Not committed:** the repository is public. It belongs in a private Supabase table (task ATLAS-1). The owner has the file. |

## What `atlas_kb.json` holds

- `rules`: 67 tested rules (61 TA-Lib candle detectors plus 6 structure proxies). For each rule: tested side, side rule,
  long/short counts, evidence grade with its reason, `pooled[era][horizon]`, `matrix[era]["above|below/low|mid|high"][horizon]`
  (each cell has `n, wins, win, base, lift, net`), and `cell_grades`. Eras are `early` (2013–2015) and `later` (2016 to Feb 7, 2018).
  Horizons are 1, 5 and 20 sessions.
- `brackets` (1 ATR stop, 2 ATR target), `direction_split`, `sentiment` (VIX, AAII, UMich), `macd`, `cross_market`.
- `charts` (54 formation cards with shape, confirmation, failure path and objective), `references`, `price_action`,
  `playbooks`, `econ_patterns`, `studies`, `case_study`, `episodes`, `sources` (S01–S47), `meta`, `grades_legend`.

## Engine API

```js
const atlas = createAtlas(kb);
atlas.lookup({ rule: 'hammer', trend: 'below', vol: 'high', horizon: 5 });
//  -> { code, name, side, grade, gradeReason, pooled:{later,early}, cellKey, cell:{later,early}, cellGrade, cellGradeReason, bracket, directionSplit }
atlas.contextFromBars(dailyBars)       // bars [{O,H,L,C}], about 180+ daily bars -> { trend, vol, sma50, atrPct, q1, q2 }, binned exactly as the study did
atlas.read({ rule, bars | trend+vol, horizon, vix, aaiiSpread, sequence, intraday, options })
//  -> { verdict:{light, grade, text}, context, lookup, chart, sentiment, hats:{white,yellow,black,red,green,blue} }
atlas.combine(['doji', 'long-legged doji', 'hammer'], { trend, vol })
//  -> overlapping detectors collapse to one event; an untested joint gets no number
atlas.sentimentLookup({ vix, aaiiSpread, umichTrend, sequence, sample })
atlas.enumerate()                       // every tested permutation (2,525 rows)
createAtlas.f                           // formula desk: candle parts, TR, ATR, SMA/EMA, RSI, MACD, VWAP, Bollinger, Fibonacci,
                                        // net return, lift, expectancy, break-even, sizing, gap stress, drawdown, Sharpe, profit factor,
                                        // Omega, alpha/beta, z-score, OU half-life, Sahm, VIX move, Bayes, permutations,
                                        // BSM price and Greeks (incl. vanna, volga, charm), Black-76, implied vol, local P&L, GEX
```

## Rules the engine enforces (from the book)

- **Lights.** GREEN = positive lift and net in both eras with an interval above zero. Nothing in the atlas meets that.
  AMBER = a lean (positive in both eras, interval spans zero), or untested/sparse. RED = no edge over comparable days,
  net ≤ 0, or the sign flipped between eras. The specific trend × volatility × horizon cell decides when it is known.
- Quote the win rate *with* its matched baseline, lift, mean net return and n. Below n = 30 the result is sparse.
- Overlapping detectors on one bar are one event. An untested combination gets no probability.
- Every stock number comes from daily US-stock bars (2013–2018, next-open entry, 0.10% cost). For intraday or 0DTE
  options the logic carries over and the percentages do not. `read({intraday:true, options:true})` says so.
