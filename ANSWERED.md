# Already answered

Every bot working on INDAI (Ikpa, Papilo, ChatGPT, Perplexity, any Claude session) checks here before researching,
testing, diagnosing or asking Bongs a question again. Each answer cost credits once; reuse it.

**Look up:** `grep -n -i "<word>" ANSWERED.md`, then read only the matching entry. The index below lists every entry.
**Reuse:** if an entry answers the question and its "Stale when" has not happened, use it and say where it came from.
If only part is time-sensitive (a price, a version, whether a service is up), re-check that one part with the
cheapest probe, not the whole investigation.
**Add:** when you answer a question, finish research, diagnose a bug or Bongs decides something, add an entry at the
top of "Entries" and a line to the index. Keep it short: the answer, where the work is, and what would make it stale.
If an entry turns out wrong or stale, edit it in place and say what changed; do not add a second copy.

**This repository is public.** No keys, passwords, account numbers, balances, personal finances, trades taken or the
atlas's numbers. Those stay in the private backend tables or the owner's chat memory.

## Index

- 2026-11-21 · Can her hosted voice be faster or slower, or more expressive?
- 2026-11-21 · How do ChatGPT and Perplexity follow the same credit-saving skills?
- 2026-11-21 · Which headset requests carry the owner's passcode?
- 2026-11-21 · Which headset (Quest app) emulator test failures are timing, not bugs?
- 2026-11-21 · Talk answers cut off: what limit does talk need?
- 2026-11-20 · Where do option chains, GEX and daily history come from now that CBOE blocks us?
- 2026-11-20 · Which paid or free options-data providers were compared, and what do they cost?
- 2026-11-20 · Why did INDAI's written read come back empty?
- 2026-11-20 · How does Analyze / Capture decide what to send the brain?
- 2026-11-20 · Where does the Pattern Atlas data live?
- 2026-11-20 · How are 30m, 1h, 4h, daily and weekly candles built, and what is kept on the device?
- 2026-11-20 · Which website test failures are the time of day, not a bug?
- 2026-11-20 · What does deploying an edge function without the CLI cost?
- 2026-11-20 · How far back do daily candles go?
- 2026-11-20 · Why did the daily chart hammer the backend when CBOE refused?

## Entries

### 2026-11-21 · Can her hosted voice be faster or slower, or more expressive?
- Answer: yes, from Settings on the website (and `indai-voice` `op:"tune"`), kept for every device. Speed 0.7 to
  1.2. Eleven v4 and v4 Turbo have no speed (ElevenLabs' v4 page, November 21: "Style and Speed sliders are not
  available in Eleven v4"), so any speed but 1.0 is spoken by `eleven_flash_v2_5`, a little less expressive. Feel is
  stability: steady 0.75, expressive 0.3, natural sends none. Unknown until heard: whether v4 takes 0.75 and 0.3 (v3
  took only 0, 0.5, 1); if not, she is asked again without them and Settings says so.
- Where: `supabase/indai-voice/voice.ts`, migration `20261121155940_indai_voice_tune.sql`, OPERATIONS.md "Her
  hosted voice"; website `indai/js/voice-tune.js` (website PR #5, merged).
- Stale when: ElevenLabs gives v4 a speed, or her model changes.
- By: Ikpa, November 21.

### 2026-11-21 · How do ChatGPT and Perplexity follow the same credit-saving skills?
- Answer: they cannot load Claude skills. `handoff/PARTNER-PLAYBOOK.md` is the same playbook in plain words: check
  this ledger first, reuse answers that are not stale, re-check only time-sensitive parts, end with an "ANSWERED
  entry" that a Claude bot logs. Its last section has short instructions to paste into the ChatGPT INDAI project and
  the Perplexity INDAI space. Both partner briefs now point to it.
- Where: `handoff/PARTNER-PLAYBOOK.md`, `handoff/PERPLEXITY-BRIEF.md`, `handoff/CHATGPT-FRONTEND-HANDOFF.md`.
- Stale when: a partner gets repository access (then it adds entries itself), or the skills change.
- By: Claude (website session).

### 2026-11-21 · Which headset requests carry the owner's passcode?
- Answer: on the Quest app (`/jarvis-command-center/`), `x-indai-pass` goes to `indai-market` (his Schwab prices,
  added by `js/owner-feed.js`), `indai-schwab` (the stream's sign-in details), `indai-voice` (her hosted voice,
  `js/cloud-voice.js`) and `indai-brain` (research, as before). Nothing else, and none of them without a saved
  passcode; in demo mode there is no `indai-schwab` or `indai-voice` request. Checked with stand-ins in
  `tests/schwab-headset.js` and `tests/voice-headset.js` (Papilo, PRs #23 to #25).
- Stale when: `owner-feed.js` or `cloud-voice.js` change on the website and are copied again.

### 2026-11-21 · Which headset (Quest app) emulator test failures are timing, not bugs?
- Answer: the WebXR emulator (IWER) under SwiftShader draws only a few frames a second. A controller needs about a
  second after it is aimed before a press lands on the right button, so a scene-tile click can miss with shorter
  waits. Two presses can't come closer than about 650 ms, which is longer than the 500 ms double-pinch window, so
  double-pinch (chart reset, a window up front) is tested in the 2D preview with the mouse instead, where it passes.
  None of these are app bugs.
- Stale when: the tests run on a GPU, or the double-pinch window changes (`js/panels.js`, `js/main.js`).

### 2026-11-21 · Talk answers cut off: what limit does talk need?
- Answer: `claude-haiku-5-5` thinks before it answers and the thinking counts against `max_tokens`. At 700, a
  question with a few KB of context used all 700 on thinking and returned an empty `spoken` (measured November 20:
  `output_tokens: 700`, empty answer). Talk needs about 1600; the spoken answer stays short because the prompt asks
  for 1 to 3 sentences. Version 12 ran at 1600. Commit f233647 ("think an idea through") set
  `talkTokens = deep ? 1500 : 700`; pull request #22 (November 21) set plain talk back to 1600 on `main`. It goes
  live with the next `supabase functions deploy indai-brain` from `main`. Until then the deployed brain still has 700.
- Where: `supabase/indai-brain/index.ts` (`talkTokens`), pull request #22.
- Stale when: talk's model changes, or the limit is raised again.
- By: Claude (website session), November 21.

### 2026-11-20 · Where do option chains, GEX and daily history come from now that CBOE blocks us?
- Answer: CBOE has refused every request from the functions since about 17:25 ET on November 19. On November 20 at
  9:33 ET its delayed-quotes address showed Cloudflare's "Sorry, you have been blocked" page even in the owner's own
  Chrome, so treat the free CBOE feed as gone, not as an outage. INDAI now reads live quotes, option chains, minute
  candles and up to 20 years of daily candles from the owner's own Schwab account (Connect Schwab page, signed in
  about once a week). The TradingView bridge still supplies prices and one-minute candles for bridge tickers.
- Where: FEATURES.md (November 20 Schwab lines), HANDOFF.md backlog item 14, `supabase/indai-schwab`.
- Stale when: the Schwab sign-in lapses, or the owner picks another provider.
- By: Claude (website session) and Ikpa.

### 2026-11-20 · Which paid or free options-data providers were compared, and what do they cost?
- Answer (prices as published on November 20; re-check the provider's page before buying):
  - MarketData.app: Starter $12 a month billed yearly ($30 monthly), 10,000 credits a day, chains 15 minutes
    delayed, a full chain is 1 credit with its cached snapshots, 30-day free trial without a card.
  - FlashAlpha: GEX levels (gamma flip, call wall, put wall) computed for you; free tier 5 calls a day; paid from
    $63 a month.
  - Tradier and Schwab: chains with Greeks free for people with a brokerage account there (Schwab was chosen).
  - Alpaca: the free feed is indicative (modelled quotes, trades 15 minutes late); real OPRA data needs a paid plan.
  - Massive (formerly Polygon): an adapter exists (`INDAI_MARKET_PROVIDER=massive`), needs a paid options plan.
  - Robinhood, where the owner trades, offers no options-data feed for this.
- Where: this entry; `handoff/PERPLEXITY-BRIEF.md` asked Perplexity for the same comparison.
- Stale when: the owner wants a second source besides Schwab, or prices change.
- By: Claude (website session).

### 2026-11-20 · Why did INDAI's written read come back empty?
- Answer: the talk limit (see the November 21 entry), plus an 11 KB reading sent as context. The website now sends a
  brief of about 1 to 2 KB (the newest 8 patterns, paths, levels, up to 4 watch items) and asks for three or four
  sentences. An empty answer shows "It was cut off before it finished" with Try again.
- Where: website `indai/js/capture.js` (`brief()`), website PR #3.
- Stale when: the capture read moves to the server's own `mode:"capture"`.
- By: Claude (website session).

### 2026-11-20 · How does Analyze / Capture decide what to send the brain?
- Answer: the reading is done on the device (`patterns.js`: TA-Lib candle rules checked against TA-Lib 0.8.3, the
  atlas's six structure proxies, shapes, levels, paths, suggested timeframes). The page asks for `mode:"atlas"` or
  `mode:"capture"` only when the brain's GET status lists them in `modes`; otherwise it uses `talk` with
  `search:false`. Each capture is its own conversation (`session: capture-<id>`), so a new read does not mix in
  earlier boxes. The atlas's numbers come only from the server. Intraday captures say the book's daily percentages
  do not carry over.
- Where: website `indai/js/capture.js`, `indai/js/patterns.js`; `handoff/IKPA-CAPTURE-TASKS.md`.
- Stale when: the capture contract in IKPA-CAPTURE-TASKS.md changes.
- By: Claude (website session).

### 2026-11-20 · Where does the Pattern Atlas data live?
- Answer: the owner chose to keep it private. `atlas_kb.json` is never committed to either public repository; it is
  in the private, service-role-only table `indai_atlas`, read by `indai-brain` `mode:"atlas"`. The engine code is in
  `atlas/`. Claude chat sessions have the skill "indai-pattern-atlas".
- Where: `atlas/README.md`, `handoff/IKPA-ATLAS-TASKS.md`, OPERATIONS.md (atlas checks).
- Stale when: a new atlas revision is loaded.
- By: Claude (website session) and Ikpa.

### 2026-11-20 · How are 30m, 1h, 4h, daily and weekly candles built, and what is kept on the device?
- Answer: 30m, 1h and 4h are built from 5-minute candles anchored to the 9:30 open (pre-market buckets end at 9:30,
  after-hours start at 4:00), like TradingView. Daily and weekly come from daily candles. The chart draws with a
  single candle. The browser keeps one-minute candles for 45 days, daily candles for good and the newest 60 captures
  (IndexedDB `indai-candles`), so yesterday is still there after the close.
- Where: website `indai/js/timeframes.js`, `daily.js`, `candle-store.js`, `history.js`.
- Stale when: those files change.
- By: Claude (website session).

### 2026-11-20 · Which website test failures are the time of day, not a bug?
- Answer: in roughly the first 15 minutes after the open the demo data has one day, and these fail on `main` too:
  chart-test "zooming out shows more than one session", flow "practice alert", and capture checks that want several
  candles. Until website PR #5 (merged November 21), extra.js "morning check-in starts on the first tap" also failed
  every weekend and holiday morning, on `main` too: it checked only the hour, while the app starts a check-in on
  trading days only; it now reads `isTradingDay` from `js/market.js`. final-touches "1440px failed option chains" is flaky on GitHub's runners and passes on a re-run
  (`gh api -X POST repos/bongs-git/bongs-git.github.io/actions/runs/<id>/rerun-failed-jobs`). ext-test sets its own
  clock. Do not chase these: re-run after 10:00 ET, or compare with `main` once.
- Where: website `indai/tests/`, `.github/workflows/indai-website-tests.yml`.
- Stale when: those tests get their own clock.
- By: Claude (website session).

### 2026-11-20 · What does deploying an edge function without the CLI cost?
- Answer: the MCP deploy needs every file of the bundle sent as text. indai-brain was about 56 KB, roughly 15,000
  output tokens per deploy, plus reading it back. Deploy with `supabase functions deploy` from the repository root
  whenever a session has the CLI; use the MCP route only when the owner asks for it now. The bundle lists are in
  OPERATIONS.md ("Deploying one function without the CLI").
- Where: `supabase/OPERATIONS.md`.
- Stale when: never, unless the MCP tool changes.
- By: Claude (website session).

### 2026-11-20 · How far back do daily candles go?
- Answer: `indai-market?kind=daily&days=` takes 1 to 6000 (default 260). With CBOE blocked, daily history comes
  from Schwab (up to 20 years).
- Where: `supabase/indai-market/index.ts`.
- Stale when: the daily source changes.
- By: Claude (website session).

### 2026-11-20 · Why did the daily chart hammer the backend when CBOE refused?
- Answer: after a failed load the website asked again on every frame (31 requests in 4 seconds). It now says "Daily
  candles could not load" and waits 30 seconds before asking again.
- Where: website `indai/js/daily.js` (`want()`), checked in `capture-test.js`.
- Stale when: never.
- By: Claude (website session).
