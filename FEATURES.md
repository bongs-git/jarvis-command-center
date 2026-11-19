# INDAI feature log

One line per user-visible feature, newest first. The Quest app and the standalone website both follow this list;
`web` shows whether the website has it yet.

| Date | Feature | Where | web |
|---|---|---|---|
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

