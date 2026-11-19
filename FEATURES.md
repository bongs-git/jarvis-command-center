# INDAI feature log

One line per user-visible feature, newest first. The Quest app and the standalone website both follow this list;
`web` shows whether the website has it yet.

| Date | Feature | Where | web |
|---|---|---|---|
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

