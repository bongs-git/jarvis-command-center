# INDAI feature log

One line per user-visible feature, newest first. The Quest app and the standalone website both follow this list;
`web` shows whether the website has it yet.

| Date | Feature | Where | web |
|---|---|---|---|
| 2026-11-21 | Her voice, her speed and her feel in Settings: pick any voice in his ElevenLabs account, speed 0.70× to 1.20×, Steady / Natural / Expressive; saved once for every device, the headset included, and she says a line in it. At any speed but 1.00× ElevenLabs' Flash model speaks for her (Eleven v4 has no speed) | Backend: `indai-voice` version 3 (`tune`); website: `indai/js/voice-tune.js` (website PR #5); headset: hears it with no change | waiting for website PR #5 |
| 2026-11-21 | PAP-3: her hosted voice (ElevenLabs) on the headset: nothing to download for speaking, first sentence fetched alone, the headset's own voice takes over on any failure, Settings line and "Choose her voice". Not yet checked on the headset: MP3 decoding in Oculus Browser and loudness next to the on-device voice | js/cloud-voice.js (copied unchanged), js/main.js, js/ui.js | done (website first) |
| 2026-11-21 | PAP-1: his Schwab prices on the headset, tick by tick (passcode on price requests only, Schwab stream into the feed, pre-market and after-hours trades move the extended price and survive a feed restart). Not yet checked on the headset: whether Oculus Browser reports the page as hidden when the headset is taken off; until then the stream may stay open while it sleeps, and the two devices take turns every five minutes | js/owner-feed.js, js/schwab-stream.js (copied unchanged), js/owner-hours.js, js/main.js | done (website first) |
| 2026-11-21 | PAP-2: "Live · Schwab" / "Live · TradingView" on the top bar, no delayed note or spoken heads-up when prices are live, and INDAI is told they are live | js/data-status.js (copied), js/price-status.js, js/panels.js, js/main.js | done (website first) |
| 2026-11-20 | Her hosted voice: every device speaks in the ElevenLabs voice he picks once, with nothing to download; the device's own voice takes over when it is off, slow, refused or out of credit; at most 60,000 characters a day | Backend: `indai-voice`; website: `indai/js/cloud-voice.js`, `indai/voice.html`; headset: `handoff/PAPILO-TASKS.md` PAP-3 | done, waiting for his ElevenLabs key |
| 2026-11-20 | Thinking an idea through: a follow-up question about the idea he last rated is answered by the stronger model with the idea, its numbers and her verdict; and a plain-text door for a Siri shortcut on a locked iPhone | Backend: `indai-brain` version 21; headset shows long replies in full: PAP-4 | works as is |
| 2026-11-20 | Verdicts no longer cut off (every researched verdict had been since November 19), and a failed step says why in the logs | Backend: `indai-brain` version 19 | n/a |
| 2026-11-20 | Orders to his Schwab account from the Trade page: a filled-in ticket with a stop 20% below, the stop as a line dragged on the option's own chart, close, cancel; limit orders only, nothing over $5,000, approved devices only | Backend: `indai-orders`; website: `indai/trade.html`, `indai/js/trade.js`, `indai/js/trade-chart.js`; not on the headset this round | done, no real order yet |
| 2026-11-20 | Live prices tick by tick from his Schwab account's stream: price and forming candle move with every trade, pre-market and after hours included | Backend: `indai-schwab` `op:"stream"`; website: `indai/js/schwab-stream.js`, `indai/js/owner-feed.js`, "Test live stream" on `indai/schwab.html`; headset: PAP-1 | done (confirmed by him November 20) |
| 2026-11-20 | Market Pattern Atlas engine: tested pattern odds vs matched baselines, honest combining, six-hat read with a red/amber/green light, formula desk (data kept private; wiring in progress) | atlas/, handoff/IKPA-ATLAS-TASKS.md | todo (ATLAS-6) |
| 2026-11-20 | Schwab connected: the owner signs in to his own Schwab account (Connect Schwab page, once a week) and INDAI reads live quotes, option chains, minute candles and up to 20 years of daily candles from it, for him alone. Streaming and orders are not part of it. | Backend: indai-schwab v4, indai-market v16; website: `indai/schwab.html`, passcode sent with price requests | todo (send `x-indai-pass` on indai-market requests) |
| 2026-11-20 | Atlas numbers for the patterns in a Capture: tested win rate against comparable days, number of cases and a red/amber/green light for each, from INDAI's server with no model call (owner only). Also `modes` in the brain's status, and unknown modes refused. | Backend: indai-brain v18 (`mode:"atlas"`); website shows it in the Capture sheet | todo |
| 2026-11-20 | Per-ticker source/freshness labels, unknown previous close shown as —, and missing-option/GEX explanations | Website PR #1: data-status.js, views.js, sheets.js, ideas.js | done (website PR #1, all CI groups passed) |
| 2026-11-20 | Drawing undo, horizontal ray, rectangle, touch magnifier; history loading/end labels and earlier-session hour labels | Website PR #1: draw.js, chart.js, history.js | done (website PR #1, all CI groups passed) |
| 2026-11-20 | Cross-origin TradingView Advanced Chart and full-screen control | Website PR #1: views.js | done; real-device rendering pending |
| 2026-11-20 | Last setup push arrival delay and accepted test-device count in Settings | Website PR #1: push.js, sw.js, sheets.js | done; real iPhone push pending |
| 2026-11-20 | Local drawing/tuning save queue with honest cloud-sync status | Website PR #1: profile-sync.js | backend drawings/tuning keys and merge contract pending |
| 2026-11-20 | Headset chart works like the website's: move, zoom (two hands, axes, thumbstick), reset, trend lines and levels (same drawing store as the website, `js/draw.js` copied from it) | js/panels.js MainChart, js/draw.js, js/main.js | done (website had it first) |
| 2026-11-20 | Resize windows (two-hand stretch or corner grip), double-pinch a top bar to bring a window up front, palm-to-talk gesture, four new tutorial steps | js/main.js, js/hud.js, js/panels.js | n/a (headset only) |
| 2026-11-20 | Sharper text in the headset: panels painted at 1.6x, half-mip sharper sampling, no foveated blur, 1.2x framebuffer, text never thinner than medium weight, brighter secondary text | js/hud.js, js/main.js | n/a (headset only) |
| 2026-11-20 | Headset matches the website's look: same palette, Geist and Geist Mono shipped with the app (works offline), flat panels with hairline borders, gold for brand and selected, gold corner brackets on the chart, website chart colours and line styles, logo on the top bar | index.html, js/hud.js, js/panels.js, fonts/, brand/ | done (source of the look) |
| 2026-11-19 | Brain spending has a daily token budget, and TradingView webhooks enforce a 16 KiB payload limit. | Backend BE-11 (budget and bridge limits live, retention staged) | todo |
| 2026-11-19 | Web Push endpoints support A-grade setup notifications from completed bridge candles during market hours. | Backend BE-10 (deployed, VAPID and browser acceptance pending) | todo |
| 2026-11-19 | Market responses identify source and feed delay, with an opt-in licensed real-time adapter. | Backend BE-9 (delayed feed live, licensing pending) | todo |
| 2026-11-19 | Email magic-link accounts isolate saved data and cap research and talk at 60 requests per rolling hour. | Backend BE-8 (account isolation live, owner transfer staged) | todo |
| 2026-11-19 | Morning GEX refresh covers both scopes for the saved universe, retries missing tickers, and reports failures. | Backend BE-7 (live, first deadline missed and coverage recovered) | todo |
| 2026-11-19 | Optional server transcription uses watchlist tickers and learned pronunciations. | Backend BE-6 (deployed, provider activation pending) | todo |
| 2026-11-19 | INDAI prioritizes frequently used memories. Nightly duplicate cleanup is staged for approval. | Backend BE-5 (learning live, nightly cleanup staged) | todo |
| 2026-11-19 | The last 16 turns follow a conversation between devices for six hours. | Backend BE-4 (live, authenticated) | todo |
| 2026-11-19 | Speech fixes, listening settings, watchlists and day plans sync across devices. | Backend BE-3 (live, authenticated) | todo |
| 2026-11-19 | Talk can stream the spoken reply as it is generated. | Backend BE-2 (live, first spoken text in 868–911 ms in three hosted checks) | todo |
| 2026-11-19 | Talk can explicitly skip web search for a latency-sensitive reply. | Backend BE-1 (live) | todo |
| 2026-11-19 | Standalone website for phone, tablet and laptop: https://bongs-git.github.io/indai/ | bongs-git.github.io `/indai/` (see its SYNC.md) | done |
| 2026-11-19 | Brand logo on the launch screen and app icons | index.html, icons/, brand/ | done |
| 2026-11-19 | Thinking brain "talk" mode: free conversation, runs commands from loose wording, fixes mishears | supabase/indai-brain, js/indai.js `converse` | done |
| 2026-11-19 | Long-term memory: "remember that …", "what do you remember" (shared across devices) | indai_memory table, js/indai.js | done |
| 2026-11-19 | Speech learning: fixes for mishears, learned pauses and noise floor, fuzzy command matching, "no, I said …" | js/speech.js, js/voice.js `ears` | done |
| 2026-11-19 | Hands-free follow-up: mic re-opens after INDAI answers | js/indai.js `keepListening` | done |
| 2026-11-19 | Faster listening: Moonshine model, speculative transcription at the pause, multi-core via cross-origin isolation | voice worker, js/voice.js, sw.js | done (multi-core in Chrome and Edge; Safari runs single-core) |
| 2026-11-19 | Gesture engine v2 (25 joints, held starts, levels easy/normal/strict/off) and hand skeleton dots | js/gestures.js, js/main.js | n/a (headset only) |
| 2026-11-19 | Gesture tutorial with start and finish frames | js/panels.js `CoachPanel` | n/a |
| 2026-11-19 | Scenes: passthrough, Loft, Midnight, Ocean, Orbit, Command deck | js/scenes.js | n/a |
| 2026-11-19 | Self-test and practice alert | js/indai.js `selfTest` | done |
| 2026-11-19 | Daily game plan, check-in, strategy alerts with sized contract ideas | js/signals.js, js/indai.js | done |
| 2026-11-19 | TradingView bridge: live candles and alerts | supabase/indai-tv, tradingview/indai-bridge.pine | done |
| 2026-11-19 | Trade idea analysis to a RAG verdict, deep dive, options profit calculator | js/analysis.js, js/options.js | done |
| 2026-11-19 | Watchlist, chart with VWAP/EMA clouds/GEX levels, lead-lag, risk breaker | js/panels.js | done |

## The website

Lives in [bongs-git/bongs-git.github.io](https://github.com/bongs-git/bongs-git.github.io) under `/indai/`. It copies the shared modules from this repo
(`relay`, `feeds`, `market`, `analysis`, `options`, `signals`, `store`, `indai`, `voice`, `speech`, the voice worker and `vendor/ort`)
and replaces only the screens. After changing a shared module here, run `indai/sync.sh /path/to/this/repo` there. `indai/SYNC.md` lists every file and the commit it was copied at.

`web` = done means the feature is built and passes the website's browser tests (demo data, and a mocked backend that follows the HANDOFF contract).
Still to try on real devices: the on-device voice and microphone on an iPhone and iPad (Safari), and everything against the live backend during market hours.

## Website-first (not in the Quest app yet)

| Date | Feature | Where (website) |
|---|---|---|
| 2026-11-19 | Typed conversation: everything voice can do, from a text box, without the mic opening by itself | js/app.js `send` |
| 2026-11-19 | Tap-to-answer buttons during the morning check-in, and a typed command mid check-in runs as a command | js/views.js `pinCard`, js/app.js |
| 2026-11-19 | Tapping the mic again before speaking closes it quietly | js/app.js |
| 2026-11-19 | Practice mode offline: simulated options chain in demo mode so ratings, deep dive and calculator still work | js/demo.js |
| 2026-11-19 | Back to real data by herself after a demo fallback; no long waits while the backend is unreachable | js/app.js `reconnect`, js/demo.js |
| 2026-11-19 | Undo also takes back the cooldown that the undone loss started | js/app.js `undoTrade` |
| 2026-11-19 | Calculator for a ticker with no price yet snaps its strike to the chain | js/app.js `calcFromChain` |
| 2026-11-19 | Add a ticker from the watchlist; type the win/loss amount; extended-hours move in the watchlist | js/views.js |
| 2026-11-19 | Chart fits the session so far (no mostly-empty morning chart); wall, flip and VWAP labels never overlap | js/chart.js |
| 2026-11-19 | Fresh prices the moment the app comes back to the foreground; quick retry after a failed quote pull | js/app.js `refreshNow` |
| 2026-11-19 | Thinking budget care: one clear line when the daily budget is used up (no "couldn't reach my thinking brain" plus "I heard …"), built-in commands and market-data ratings carry on; web research that fails twice in a row pauses itself until midnight New York time so it stops spending the budget | js/demo.js |
| 2026-11-19 | Audible on iPhone: plays through the silent switch, lets go of the mic the moment listening ends (no quiet call volume), wakes the audio engine after the lock screen or another app, falls back to the phone's voice when the natural one is slow to start | js/app.js |
| 2026-11-19 | Ideas strip on every screen, a card with Analyze and Chart when a new idea lands, and the Ideas list: reasons, sized contract, stop, entry and target, what price did next. The chart marks every idea and draws stop and target for the one in focus | js/ideas.js, js/chart.js |
| 2026-11-19 | Faster alerts: the scan runs the moment new candles land, bridge candles are picked up within seconds of the minute turning, a "Forming" look at the candle that is still open, and a short spoken alert with the full text on screen | js/app.js `scanTick`, `lookAhead` |
| 2026-11-19 | No lost ideas: the day's ideas survive reloads, setups missed while the page was closed or asleep are caught up quietly, setups past the hourly alert limit are listed quietly, and nothing new is listed while the breaker has alerts paused | js/app.js `catchUp` |
| 2026-11-19 | Access lock: with the backend's owner passcode set, a device without the accepted access token shows only a lock screen and nothing runs behind it; the token is asked for again if the backend stops accepting it; Settings can lock a device by hand and says when no token is set | js/lock.js |
| 2026-11-19 | Push notifications, client side: register and unregister this browser with `indai-push`, send a test, keep the backend's `plan` and `watchlist` profile current, show each push from the service worker and open that ticker's idea on tap. Waiting on the backend's push keys and passcode | js/push.js, sw.js |
| 2026-11-19 | Retrospective: after the close, how the day's setups did (win rate, result in R), where they missed most (time, kind of setup, direction, ticker, entry, stop, target), and proposed changes to what she alerts on, learned over the kept days and applied only when the trader says so | js/retro.js, js/ideas.js |
| 2026-11-19 | Back-test of the Retrospective's changes: the kept days with and without them (setups, win rate, result, average, dollars at the plan's risk, profit factor, drawdown, losing run, each day), and a fair test that judges each day with only what was learned before it | js/retro.js |
| 2026-11-19 | TradingView back-test and Bar Replay: the scanner as a TradingView strategy (Pine v5) with the learned changes pasted in as one line, plus a page to copy the script from | tradingview/indai-backtest.pine, tradingview/index.html, js/retro.js, js/ideas.js |
| 2026-11-19 | Back end: setup pushes are scanned the moment the bridge stores the minute that completes a five-minute candle, instead of on the per-minute timer that ran close to a minute behind. Nothing changes for the apps | supabase/migrations/20261120001048_indai_push_scan_on_bar_arrival.sql |
| 2026-11-19 | Back end: when CBOE refuses a ticker, prices and one-minute candles come from the TradingView bridge's stored candles instead of failing, marked with their own source. Option chains and GEX levels still need CBOE | supabase/indai-market/bridge.ts, supabase/indai-market/index.ts |
| 2026-11-19 | TradingView bridge can send pre-market and after-hours candles (on by default; needs the script pasted again and its alert re-created) | tradingview/indai-bridge.pine |
| 2026-11-20 | Back end: a bridge alert left on another timeframe can no longer replace one-minute candles | supabase/migrations/20261120052807_indai_tv_bars_keep_minute_candles.sql |
| 2026-11-20 | Website: the main chart can be moved (drag), zoomed (pinch, wheel) and reset, and drawn on: trend lines and price levels that can be selected, moved, changed and deleted, kept on the device per ticker. Not in the Quest app | indai/js/chart.js, indai/js/draw.js (website repo) |
| 2026-11-20 | Website: the price and time axes can be dragged to rescale; scrolling back shows earlier sessions from the stored bridge candles; TradingView's embedded chart can replace INDAI's in the panel. Not in the Quest app | indai/js/chart.js, indai/js/history.js, indai/js/views.js (website repo) |
| 2026-11-20 | Back end: `indai-tv?bars=1&ticker=…&before=…` returns stored one-minute candles for one ticker, for scrolling a chart back | supabase/indai-tv/index.ts |
| 2026-11-20 | Back end: three brains on a rated idea. Perplexity researches the news and events, Claude gives the verdict, ChatGPT gives a second opinion beside it and stands in when Claude cannot answer. Off until the owner saves a Perplexity key; the apps do not show the second opinion as its own element yet (it already appears in the summary and in what she says) | supabase/indai-brain/super.ts |
| 2026-11-20 | Website: pre-market and after-hours candles on the chart (after the session, and between earlier sessions), an "Ext" switch, and the extended-hours price with its change under the regular price; with a Finnhub key that price and its candle move trade by trade. Not in the Quest app | indai/js/ext.js, indai/js/history.js, indai/js/chart.js (website repo) |
| 2026-11-20 | Prices move between candle closes: the TradingView bridge sends the forming candle about every 15 seconds (needs the script pasted again and its alert re-created), the back end keeps it apart from finished candles, and the website shows it during the session and in extended hours. The website also asks the bridge feed only for what is new and rests between updates. Not in the Quest app yet | tradingview/indai-bridge.pine, supabase/indai-tv/live.ts, supabase/migrations/20261120110046_indai_tv_live.sql; website: indai/js/app.js, indai/js/ext.js |
| 2026-11-20 | Website: an Analyze button and a Capture box on the chart. INDAI reads the candles in the box (TA-Lib patterns and the atlas's structure proxies, shapes, momentum, levels, GEX walls, bull/bear/range paths, timeframes to check next) and writes its own read. Chart sizes 30m, 1h, 4h, daily and weekly with years of history, and candles kept on the device after the close. The atlas's numbers and a read of the picture wait for Ikpa's CAP-1 and CAP-2. Not in the Quest app | indai/js/capture.js, indai/js/patterns.js, indai/js/timeframes.js, indai/js/daily.js, indai/js/candle-store.js (website repo); handoff/IKPA-CAPTURE-TASKS.md |
