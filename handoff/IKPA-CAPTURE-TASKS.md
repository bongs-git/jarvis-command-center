# Ikpa: the server side of Analyze / Capture

From the owner, November 20, 2026: he wants to draw a box on the chart (like the Rectangle tool, but called
Capture), or tap an on-screen Analyze button. INDAI then reads every pattern in the box, shows what the chart is
doing, the possibilities and the next moves, and suggests timeframes to look at. He also asked for timeframes up to
daily, years of candles "just like TradingView", and for yesterday's candles to stay put after the close.

The website side is in **bongs-git/bongs-git.github.io PR #2** (`website/capture-timeframes-history`). It works today
without any of these tickets: the reading is done on the device, and INDAI's written read comes from `mode:"talk"`
with `search:false` and `session:"capture"`. These tickets add the parts only the server can do: the atlas's tested
numbers for each pattern, and a read that looks at the picture.

**Pull the website before ATLAS-6.** `indai/js/chart.js` and `indai/js/history.js` changed a lot in PR #2. The chart
now has 30m, 1h, 4h, D and W (`app.tf`); `js/patterns.js` already detects the atlas's patterns with TA-Lib's rules;
and the Capture sheet already shows a light per pattern once CAP-1 answers.

Same rules as the atlas tickets: one branch and one pull request per ticket, a `FEATURES.md` line, and `HANDOFF.md`
contract rows. Never send the knowledge base to the browser.

## Tickets, in priority order

### CAP-0 · List the brain's modes, and refuse unknown ones · P0 (small)
- `GET indai-brain` adds `modes: string[]`, listing only what this deployment answers (today: `talk`, `trade`, `chat`,
  `memory`, `profile`, `history`; add `atlas` with CAP-1 and `capture` with CAP-2).
- `POST` with a mode not in that list returns `400 {error:"bad_mode"}`. Today an unknown mode falls through to the
  researched trade/chat path, which costs tokens.
- Why it matters: the website asks for `atlas` or `capture` only when `modes` lists it. Without `modes` it never
  asks, so nothing breaks, and nothing lights up either.
- Done when: GET lists `modes`, and `{mode:"nonsense"}` returns 400 without a model call.

### CAP-1 · `mode:"atlas", op:"scan"`: numbers for the patterns found in a capture · P0
Builds on ATLAS-5 (the same reader and engine, with no model call, scoped to the owner).

Request, as the website sends it:
```json
{ "mode": "atlas", "op": "scan", "symbol": "SPY", "timeframe": "15min", "intraday": true,
  "patterns": [ { "code": "CDLHAMMER", "name": "Hammer", "at": "2026-11-19T19:30:00.000Z", "side": "long",
                  "trendBin": "below", "volBin": "high", "confirm": 671.2, "fail": 668.9, "alsoFired": [] } ] }
```
`code` is TA-Lib's function name (`CDL…`) or one of the six proxies (`BULLFLAG`, `BEARFLAG`, `CUPHANDLE`,
`INVERSECUP`, `TRAPFLAG`, `CHANNEL20`). `side` is `long`, `short`, or `none` for neutral candles; the atlas scores
neutral candles as a fade of the trend, so the server keeps its own rule. Bins use the atlas's definitions (close
against SMA50; ATR14/close against the terciles of the prior 126 ratios).

Response:
```json
{ "reads": [ { "code": "CDLHAMMER", "at": "2026-11-19T19:30:00.000Z", "light": "AMBER", "win": 0.573, "base": 0.543,
               "n": 1101, "cellKey": "below/high/5", "line": "a lean, not a proven edge" } ] }
```
- One read per pattern, at 5 sessions by default. Use the cell when it exists; fall back to the rule's overall row
  and say so in `line`.
- `GREY` when n < 30. A pattern the atlas never tested gets `light:"NONE"` and no numbers. Never invent a number.
- When `intraday` is true, `line` says the percentages were measured on daily stock candles.
- Done when: the request above returns the hammer's below/high/5 cell (0.573 / 0.543 / 1101), and an untested code
  returns no numbers.

### CAP-2 · `mode:"capture"`: INDAI reads the picture · P1
Request:
```json
{ "mode": "capture", "name": "Bongs", "symbol": "SPY", "timeframe": "15min",
  "image": "data:image/jpeg;base64,…", "capture": { …the device's reading… }, "question": "Read my chart capture: …" }
```
- `image` is a JPEG of the box plus the price axis, at most 960 px wide (usually 60 to 150 kB). `capture` is the
  device's reading: box, trend, momentum, patterns, shapes, levels, GEX, paths, what to watch. See `summarize()` in
  the website's `js/patterns.js`.
- Send the image to Claude as a vision input with the facts. Run CAP-1's scan on `capture.patterns` first and give
  the model those numbers. The model must not make up probabilities. On intraday timeframes it must say the book's
  daily percentages do not carry over.
- No web search unless the question asks for news. Same owner scope and budget as `talk`. Session `capture`, so it
  does not crowd the owner's conversation memory.
- Response: `{ result: { spoken: "two or three sentences INDAI can say", summary: ["up to 6 short lines"] } }`.
- Done when: a fixture image and capture return a read that cites the box's trigger levels and the CAP-1 lights, and a
  15-minute capture carries the daily-numbers warning.

### CAP-3 · Years of daily candles · P1
**The `days` part is written in this pull request** (`supabase/indai-market/index.ts`, five lines): review it, deploy
`indai-market`, and check the result. The Twelve Data fallback is still to do.
- `indai-market?kind=daily&symbols=SPY&days=6000`: honour `days`, from 1 to 6000, with a default of 260 so the Quest
  app is unchanged. Today it always returns the last 260. Cache per symbol, not per `days`, and slice the result.
- If CBOE refuses or sends a short history, and the owner has saved a Twelve Data key on the server, use
  `time_series?interval=1day&outputsize=5000`. Otherwise return what there is.
- The website already sends `days=6000` and keeps every daily candle on the device, so years fill in from the first
  answer.
- Done when: `days=6000` for SPY returns more than 2,500 rows.

### CAP-4 · Keep the bridge's minute candles · P2
The website now keeps 45 days of one-minute candles on the device, but a new device or a cleared browser starts from
the server. Check that nothing prunes `indai_tv_bars`. If a job does, keep at least 45 days.
- Done when: `indai-tv?bars=1&ticker=SPY&before=<30 days ago>` returns candles once the bridge has run that long.

## Notes for the other builders

- **ChatGPT (website front end):** do not compute atlas numbers in the browser. `js/capture.js` already shows CAP-1's
  `reads` and CAP-2's `result`.
- **Papilo (Quest app):** Capture is website-only for now. The same calls work from the app once these ship.
