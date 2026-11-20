# Ikpa: wire the Market Pattern Atlas into INDAI

From the owner, November 20, 2026: "Send them over and give Ikpa the tasks." The owner wrote **The Market Pattern
Atlas** (INDAI research edition, Corrected Direction Edition, 126 pages) and wants INDAI to reason as it: every
pattern, every tested probability, honest combinations, the six thinking hats, and the formulas.

What arrived in this pull request:
- `atlas/indai_atlas_engine.js` + `atlas/index.mjs`: the engine (lookup, binning from daily bars, honest combining,
  six-hat read with a red/amber/green light, every tested permutation, the full formula desk). No dependencies.
- `atlas/engine_test.mjs`: checks against the book's worked examples and printed tables (27 formula checks without the
  data, 42 with it; all pass).
- `atlas/README.md`: data layout, engine API, the evidence rules.

What did **not** arrive: `atlas/atlas_kb.json` (about 490 KB, every number from the book). This repository is public
and the owner chose to keep the data private. **Ask the owner to attach `atlas_kb.json` to your session** (he has it
from the chat that built it) and load it as ATLAS-1 says. `atlas/.gitignore` keeps it out of commits; never commit it,
paste it into a response body or serve it as a static file.

If your session lists the `indai-pattern-atlas` skill, load it before you start: it is the same knowledge in prose,
including the rules for answering.

## What the atlas found (the brain must say this honestly)

- Stock tests: 502 US large-caps, **daily** bars, 2013 to Feb 2018, enter next open, exit 1/5/20 sessions, 0.10% cost,
  each result compared with matched comparison days (same stock, era, side, trend and volatility bin).
- No rule earned GREEN: none of the 63 bootstrap intervals for lift lay entirely above zero. Best leans (AMBER):
  inverted hammer (+3.16 pp, AMBER in 5 of 6 trend/volatility cells), hammer (+1.92 pp, 4 of 6), tasuki gap,
  gap three methods, counterattack lines, rising/falling three methods, morning star, morning doji star, piercing line.
- Bull flag, cup and handle and engulfing won **less** often than comparable days. The exit changes the rate:
  bull flag 53.7% at five sessions, 42.0% with a 1-ATR stop / 2-ATR target.
- The owner trades 0DTE options on 5-minute charts. The atlas's logic (trigger, invalidation, baseline, sizing)
  carries over; its percentages do not. Every atlas read on an intraday or options idea must say so.

## Tickets, in priority order

One branch and one pull request per ticket, a `FEATURES.md` line for anything the owner will notice, and
`HANDOFF.md` contract rows for any new field or mode, as usual.

### ATLAS-0 · Review and merge this pull request · P0
Run `ATLAS_KB=/path/atlas_kb.json node atlas/engine_test.mjs` (42 passed). Merge.

**Done November 20, 2026.** 27 passed without the data, 42 with it, and 42 on the data as the database returns it
(the table stores it with keys in another order, which the engine does not mind).

### ATLAS-1 · Load the atlas privately · P0
- Migration: table `indai_atlas(key text primary key, value jsonb not null, version text, updated_at timestamptz default now())`,
  RLS on, no policies for `anon` or `authenticated` (service role only), same pattern as `indai_private_config`.
- Load the owner's `atlas_kb.json` as key `kb`, version `rev1.1-corrected`. Do it with a one-off script or the SQL
  editor, not a migration file, so the data never enters the repository.
- Edge functions read it once per cold start through `_shared/db.ts` and cache it in memory.
- Done when: `select pg_size_pretty(pg_column_size(value)::bigint) from indai_atlas where key='kb'` returns a row, and
  `GET /rest/v1/indai_atlas` with the public key returns nothing.

**Done November 20, 2026**, except the reader: that arrives with the first function that uses it (ATLAS-5).
The table holds an exact copy of the owner's file (67 rules, 223 kB stored, version `rev1.1-corrected`), and the public
key is answered "permission denied". How it was loaded, and how to load the next revision: `atlas/load/README.md`.

### ATLAS-2 · An atlas read on every rated idea · P0
In `supabase/indai-brain`, `mode:"trade"`:
1. For the idea's ticker, fetch about 260 daily bars (`indai-market` `kind=daily`).
2. `atlas.contextFromBars(bars)` → trend and volatility bin, exactly as the study binned them.
3. Detect candle patterns and structure proxies on the **last completed daily bar** (ATLAS-3).
4. `atlas.combine(found, ctx)`, then `atlas.read({ rule, trend, vol, horizon: 5, vix, intraday, options })` for each
   independent signal. Set `intraday:true` when the idea's timeframe is under a day and `options:true` for any option idea.
5. Put the result in the evidence all three brains see: `context.atlas = { light, grade, rule, cellKey, cell, pooled, hats, transfer, combine }`.
6. Add to `SYSTEM` (and the judge/second-opinion prompts in `super.ts`):
   - Quote atlas numbers as win vs matched baseline, lift in points, mean net return and n, with the horizon.
   - Never invent a probability for a combination the atlas did not test; say it is untested.
   - The atlas grade never makes an idea GREEN on its own; live data, flow and news decide the rest.
   - Atlas percentages come from daily stock bars; for 0DTE or intraday say the percentages do not transfer.
7. Return it additively as `result.atlas` (light, rule name, cell, one-line white/black hats, transfer note).
   Add the field to the `mode:"trade"` contract row in `HANDOFF.md`.
- Done when: the curl for "QQQ calls expiring today 665 strike" returns `result.atlas` with `light`, `cellKey` and a
  transfer note, every existing field is unchanged, and the cost stays inside the daily token budget (the atlas adds
  no LLM call).

### ATLAS-3 · Candle detectors that match TA-Lib · P0
The atlas used TA-Lib 0.8.3 with default candle settings. Port, in plain TypeScript under `supabase/_shared/atlas/`:
- First the rules the brain will mention most: hammer, inverted hammer, shooting star, hanging man, engulfing,
  harami / harami cross, doji family (doji, long-legged, rickshaw man, dragonfly, gravestone, high wave, spinning top,
  short line), morning/evening star and doji star, piercing line, dark cloud cover, three inside/outside, marubozu,
  tasuki gap, gap three methods, counterattack, stick sandwich, rising/falling three methods, hikkake (confirmed ±200 only).
- The six structure proxies exactly as defined on atlas p. 062 (`atlas/README.md` and the skill have the formulas):
  bull flag, bear flag, cup and handle, inverted cup, failed bear flag after engulfing, 20-day channel break.
- Side rules: detector sign sets the side, except the six neutral candles, which fade the trend (prior close below
  SMA50 → long, at or above → short). Gravestone doji was tested long only.
- Fixtures: run real TA-Lib (Python, `pip install TA-Lib`) on a few tickers' daily bars and save expected signals;
  the TypeScript must agree on at least 99% of bars per detector.
- Done when: the fixture test passes in `supabase/checks/`.

### ATLAS-4 · Crowd readings for the red hat · P1
- VIX close for the signal date (FRED `VIXCLS`, or the CBOE/Massive feed already in `indai-market`), cached daily.
- Optional: AAII weekly bull-minus-bear spread.
- Pass `vix` (and `aaiiSpread`, `sequence`) to `read()`. Done when: `result.atlas.hats.red` names the VIX state and its
  historical row.

### ATLAS-5 · An atlas endpoint with no model call · P1
`POST indai-brain {mode:"atlas", op:"lookup"|"read"|"combine", symbol?, rule?, trend?, vol?, horizon?, vix?}`,
owner-scoped like profile and memory, no tokens spent. Returns the engine output (never the whole knowledge base).
- Done when: `{mode:"atlas",op:"lookup",rule:"hammer",trend:"below",vol:"high",horizon:5}` returns win 0.573,
  base 0.543, n 1101, `cellGrade:"RED"` (the early era went the other way). Add the contract row.

### ATLAS-6 · Atlas marks on the website chart · P1 (your chart lane)
On the website's daily chart (`indai/js/chart.js`), mark bars where a tested pattern fired, coloured by its light.
Tapping a mark opens a sheet with the light, the cell numbers and the six hats, fetched from ATLAS-5. Keep the
knowledge base on the server.
- Done when: marks and sheet work at 360, 820 and 1440 px in the website's CI, with fixtures for the endpoint.

### ATLAS-7 · Formula desk in the options calculator · P2
The owner asked for an optionsprofitcalculator.com-style calculator. Use `createAtlas.f`: `bsm` (price and Greeks),
`impliedVol`, `pnlApprox`, `breakEven`, `expectancy`, `sharesForRisk`, `gapStress`. Show GEX with its sign assumption
(`f.gex1pct`). The book's worked example must reproduce: call $2.45, delta 0.53, gamma 0.069, theta −$0.044/day,
vega $0.114 per vol point.

### ATLAS-8 · Measure the owner's own live results · P2
Table `indai_atlas_outcomes(id, user_id, symbol, rule, cell_key, light, idea_at, horizon, outcome_at, net_return, won)`.
Log every rated idea's atlas read; fill the outcome at the horizon (and the same-day close for 0DTE). The website's
Retrospective then shows, per pattern, the owner's live win rate against the atlas baseline with n. This is the
book's validation protocol (p. 119): frozen rules, a forward sample nobody tuned on.

## Notes for the other builders (pass on once ATLAS-2 ships)

- **ChatGPT (website front end):** show `result.atlas` on the idea sheet: a light chip, the rule and cell line, and
  the hats behind a "Why" tap. Do not compute atlas numbers in the browser.
- **Papilo (Quest app):** the same fields as a small panel beside the verdict; INDAI can speak the white and black
  hats.
