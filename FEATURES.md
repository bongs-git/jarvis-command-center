# INDAI feature log

One line per user-visible feature, newest first. The Quest app and the standalone website both follow this list;
`web` shows whether the website has it yet.

| Date | Feature | Where | web |
|---|---|---|---|
| 2026-11-19 | Optional server transcription uses watchlist tickers and learned pronunciations. | Backend BE-6 (pending deployment) | todo |
| 2026-11-19 | INDAI prioritizes frequently used memories and consolidates duplicate facts nightly. | Backend BE-5 (pending deployment) | todo |
| 2026-11-19 | The last 16 turns follow a conversation between devices for six hours. | Backend BE-4 (pending deployment) | todo |
| 2026-11-19 | Speech fixes, listening settings, watchlists and day plans sync across devices. | Backend BE-3 (pending deployment) | todo |
| 2026-11-19 | Talk can stream the spoken reply as it is generated. | Backend BE-2 (pending deployment) | todo |
| 2026-11-19 | Talk can explicitly skip web search for a latency-sensitive reply. | Backend BE-1 (pending deployment) | todo |
| 2026-11-19 | Brand logo on the launch screen and app icons | index.html, icons/, brand/ | todo |
| 2026-11-19 | Thinking brain "talk" mode: free conversation, runs commands from loose wording, fixes mishears | supabase/indai-brain, js/indai.js `converse` | todo |
| 2026-11-19 | Long-term memory: "remember that …", "what do you remember" (shared across devices) | indai_memory table, js/indai.js | todo |
| 2026-11-19 | Speech learning: fixes for mishears, learned pauses and noise floor, fuzzy command matching, "no, I said …" | js/speech.js, js/voice.js `ears` | todo |
| 2026-11-19 | Hands-free follow-up: mic re-opens after INDAI answers | js/indai.js `keepListening` | todo |
| 2026-11-19 | Faster listening: Moonshine model, speculative transcription at the pause, multi-core via cross-origin isolation | voice worker, js/voice.js, sw.js | todo |
| 2026-11-19 | Gesture engine v2 (25 joints, held starts, levels easy/normal/strict/off) and hand skeleton dots | js/gestures.js, js/main.js | n/a (headset only) |
| 2026-11-19 | Gesture tutorial with start and finish frames | js/panels.js `CoachPanel` | n/a |
| 2026-11-19 | Scenes: passthrough, Loft, Midnight, Ocean, Orbit, Command deck | js/scenes.js | n/a |
| 2026-11-19 | Self-test and practice alert | js/indai.js `selfTest` | todo |
| 2026-11-19 | Daily game plan, check-in, strategy alerts with sized contract ideas | js/signals.js, js/indai.js | todo |
| 2026-11-19 | TradingView bridge: live candles and alerts | supabase/indai-tv, tradingview/indai-bridge.pine | todo |
| 2026-11-19 | Trade idea analysis to a RAG verdict, deep dive, options profit calculator | js/analysis.js, js/options.js | todo |
| 2026-11-19 | Watchlist, chart with VWAP/EMA clouds/GEX levels, lead-lag, risk breaker | js/panels.js | todo |
