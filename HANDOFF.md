# INDAI handoff: who builds what

## Website handback to Ikpa — November 20, 2026

Website [PR #1](https://github.com/bongs-git/bongs-git.github.io/pull/1) merged at `6011e72` on November 20.
Price freshness labels, missing-option explanations, drawing tools/undo, history states and push receipt timing
passed all three [CI groups](https://github.com/bongs-git/bongs-git.github.io/actions/runs/44714347979), including 360/820/1440px checks. Backend and vendor responses in regression tests are fixtures; live TradingView rendering was checked separately. Quest application files and backend
code are unchanged by this work.

**Backend requests:** `supabase/indai-brain/profile.ts` still permits only speech, ears, plan and watchlist.
`drawings` and `tuning` currently return `400 bad_key`; the website queues work locally and shows that limitation.
Please agree and implement these additive profile contracts before calling cross-device sync complete:

- `drawings`: `{version:1,items:{[id]:item}}`. Each item contains `id`, `symbol`, `updatedAt` (epoch ms),
  and either `deleted:true` or `type` (`line`, `level`, `ray`, `rect`) with existing drawing fields:
  level `p`, ray `a:{t,p}`, line/rectangle `a:{t,p},b:{t,p},day` (epoch ms).
  Atomically merge by ID on PUT; larger `updatedAt` wins, deletion wins an equal timestamp, preserve all
  other IDs/symbols, and return the canonical merged `value`. Whole-profile replacement loses concurrent
  device edits. Retain tombstones so a sleeping device cannot resurrect deleted work. Apply existing
  auth/owner scoping and input-size limits.
- `tuning`: `{version:1,adj,labels,minAdd,stop,target,at,basis?}`. `adj`/`labels` are keyed by time, kind, direction, symbol or warning group;
  reset is an empty adjustment map, `minAdd:0,stop:1,target:1`, with a new `at`. Select the larger `at`
  atomically and return canonical `value`. Keep these scoped to the same account and use them in the push
  scanner only after validation. A pending older profile must not overwrite a newer remote profile.

Example client requests (existing brain/passcode transport, no new route):
```js
relay.brain({mode:'profile',op:'get',key:'drawings'}, ownerToken)
relay.brain({mode:'profile',op:'put',key:'tuning',value:{version:1,adj:{},labels:{},minAdd:0,stop:1,target:1,at:Date.now()}}, ownerToken)
```

**Schwab:** no order endpoint contract is present yet. The website does not submit orders. Please specify
account authorization, exact contract identifier, quantity, limit/max-loss fields, preview/confirmation and
idempotency/error behavior before the confirm sheet is built.

**TradingView:** the Web Component failed on cookie access in an opaque frame. The website now uses
TradingView's vendor-hosted Advanced Chart in a cross-origin, credentialless sandboxed iframe. Candles,
controls and the provider's delay label rendered in the desktop preview; full screen works. Actual
iPhone/iPad rendering remains unverified. Owner-device checks for silent-ring voice and
closed-app push remain open. Receipt timing uses `barT + 300000` because scanner `barT` is the start of a
completed five-minute candle. A test push does not overwrite the latest market-alert receipt.


INDAI is one product with two faces: the Meta Quest command center (this repo) and a standalone website
for phone, tablet and laptop (separate project, see "Standalone website" below). Both sit on the same backend.
This file is the contract between the two builders so they never edit the same thing.

## The split

| Lane | Owner | Owns | Never touches |
|---|---|---|---|
| **Front end** | Claude | Everything a person sees, hears or touches: this repo's `index.html`, `js/`, `sw.js`, the Quest APK build, voice in and out, gestures, scenes, panels, and the standalone website UI | Supabase schema, edge function code |
| **Back end** | ChatGPT | Supabase project `zptjziewsfuvfcogrikz`: edge functions in `/supabase`, tables, scheduled jobs, data vendors, the LLM brain's prompts and memory, auth | Anything under `js/`, `index.html`, `sw.js` |

**Change of hands, November 19, 2026.** The owner's words: "You take the backend fix. I'll use chat gpt for front end
hand off." From that evening Claude works on the back end and ChatGPT on the front end, until the owner says otherwise.
The "Never touches" column still applies to whoever holds each lane, and the backlog headings below keep their old
names: the lane decides who picks an item up, not the name. Before starting, read the other side's notes:
`supabase/OPERATIONS.md` for the back end; `indai/SYNC.md` and `indai/README.md` in `bongs-git/bongs-git.github.io`
for the website. One exception so far: early on November 20 the owner asked Claude directly for a chart he can move,
zoom and draw on, and Claude built it in the website (`indai/js/chart.js`, `indai/js/draw.js`, `indai/js/views.js`,
`indai/index.html`, `indai/css/app.css`). Pull before editing those files.

Who is who, in the owner's words (November 20): **Ikpa** is the Claude bot on the back end and the website's chart
work (the session that wrote this note). **Papilo** is the Claude bot that builds the Meta Quest app; its current
brief is `handoff/QUEST-THEME-BRIEF.md`. **ChatGPT** takes the website's remaining front-end work from
`handoff/CHATGPT-FRONTEND-HANDOFF.md`. **Perplexity** is the research desk, twice over: inside INDAI through its API
(item 16 below), and on the team through the owner, checking facts the builders cannot reach
(`handoff/PERPLEXITY-BRIEF.md`). She does not push code.

Why it was first split this way round: the front end needs a real headset loop (WebXR emulator tests, hand tracking, on-device
speech models, APK builds) that is already set up and passing here. The back end is plain HTTP + SQL with a
written contract, so it can be built and tested from anywhere.

## The contract (do not break without agreeing a version bump)

Base URL `https://zptjziewsfuvfcogrikz.supabase.co`. Clients send the public project key as `apikey`. Send the signed-in user’s access token as `Authorization: Bearer`, or the public key for a signed-out request.
The only client is `js/relay.js`. The function sources in `/supabase` are the source of truth for response shapes; the original shapes were checked against the deployed brain function. `FEATURES.md` records which hosted features are active and which still need configuration.

| Endpoint | Purpose | Shape |
|---|---|---|
| `GET /functions/v1/indai-market?kind=snapshot&symbols=SPY,QQQ` | quotes | see `supabase/indai-market/index.ts` |
| `…?kind=bars&symbols=` | 1-minute candles | same file |
| `…?kind=daily&symbols=` | daily candles | same file |
| `…?kind=chain&symbol=&expiry=&range=` | options chain with Greeks and GEX | same file |
| `…?kind=news&symbol=` | headlines | same file |
| `GET /functions/v1/indai-tv` , `?bars=1&since=` | TradingView alerts and bridge candles | see `supabase/indai-tv/index.ts` |
| `GET /functions/v1/indai-tv?bars=1&ticker=QQQ&before=<ms>&limit=1000` | history for one ticker, for scrolling a chart back | `{ ticker, bars: [{t,o,h,l,c,v}], now }`: stored one-minute bridge candles older than `before` (default now), newest first, at most 1000 a call (regular and extended hours; page back with the oldest `t`). No key needed. It only holds what the bridge has sent since November 19, 2026 |
| `POST /functions/v1/indai-tv?key=…` | TradingView webhook (private key in `indai_private_config`) | Pine `alert()` JSON |
| `GET /functions/v1/indai-brain` | status | `{ configured, passcode, memory, brains: { claude, perplexity, chatgpt } }` (which brains are switched on) |
| `POST /functions/v1/indai-brain` `{mode:"trade"}` | researched RAG verdict | `{ result: { rag, confidence, headline, spoken, summary[], bullish[], bearish[], news[], events[], watch[], plan_notes, second? }, sources[], model, brains[] }`. `brains` lists who worked on the answer, in order: `{ brain: "perplexity"/"claude"/"chatgpt", role, model, ok, ms, tokens?, sources?, via?, error? }`. `result.second`, present when ChatGPT gave a second opinion: `{ by:"ChatGPT", model, rag, confidence, reason, risk, agrees }`. The rating is always Claude's; a disagreement is already folded into `confidence`, `summary` and `spoken`. `model` names the brain that wrote the result (ChatGPT's model when it stood in for Claude). `mode:"chat"` carries `brains` too. |
| `POST … {mode:"talk", question, history[], context, speech}` | conversation | `{ result: { spoken, summary?, command?, heard_as?, remember?, forget? }, remembered[] }` |
| `POST … {mode:"memory", op:"list"/"add"/"forget", text?, ids?}` | long-term memory | `{ memory: [{ id, kind, text, created_at }] }` |
| `GET /rest/v1/indai_gex_levels` | morning GEX levels | rows per ticker and scope |
| `POST indai-brain {mode:"talk",search:false,…}` | answer from supplied context | same talk envelope, empty sources |
| `POST indai-brain {mode:"talk",stream:true,…}` | SSE | `data: {"delta":"…"}`, one final talk envelope, then `data: [DONE]`. Once the upstream accepts the request, an SSE comment opens the connection. Later failures send an error event and close. |
| `POST indai-brain {mode:"profile",op:"get"/"put",key,value?,mutation_id?}` | shared profile | `{key,value,updated_at}`. Use the localStorage keys, `plan` or `watchlist`. Send speech counter increments and a stable mutation UUID on retry. Missing values return null. |
| `POST indai-brain {mode:"history",op:"list"/"clear",session?}` | saved conversation | `{turns:[]}`. Talk defaults to the same session on each device. Empty history resumes it. A stable talk `request_id` prevents duplicated stored turns on retry. |
| `POST indai-brain {mode:"memory",op:"add",text,kind?}` | learned memory | Rows add `uses,last_used`. Kinds are fact, preference, rule or vocabulary. Talk can return `used_ids`. |
| `POST indai-ears?symbols=QQQ,SPY` with `Content-Type: audio/wav` | server transcription | `{text,alternatives:string[],ms}`. 16 kHz mono 16-bit PCM, up to 30 s / 1 MB. Activate with `INDAI_STT_PROVIDER=deepgram` and the provider secret. |
| `GET indai-market?kind=health` | scheduled job health | `{jobs:[{job,ok,detail,at,state}]}`. The 09:20 ET `gex` check covers the entire universe. Database failure notifications and an optional HTTPS operations webhook report failures. |
| `POST /auth/v1/otp {email}` then use the SDK sign-in session | email magic link | Send the public project key as `apikey` and the user access token as Bearer. The existing owner passcode permits signed-out private access. With only the public key, talk is stateless. |
| `GET indai-market?kind=snapshot/bars/chain` | feed provenance | Same data shapes plus `source,delay` in seconds. Licensed users can receive Massive after provider activation. CBOE fallback reports 900. RSS and job health have no fixed delay. When CBOE refuses a ticker, `snapshot` and `bars` answer it from the TradingView bridge's stored candles instead: that quote or ticker entry carries `source:"TradingView bridge", delay:0` (and so does the whole answer when every answered ticker came from the bridge). A bridge quote has `price` (newest candle, extended hours included), `close` (last regular close) and `timestamp`; `open`, `high`, `low`, `volume`, `prevClose`, `change` are 0 when the stored candles cannot give them. Bridge bars are regular hours only. `chain` has no such fallback. |
| `GET indai-push`, `POST indai-push {op,subscription?,endpoint?}` | Web Push | GET returns the public VAPID key. Subscribe with `PushSubscription.toJSON()`. Unsubscribe or test by endpoint. Test returns the provider acceptance count. Sync a dated plan with aggr, capital, strategies, risk state, and watchlist. |
| Brain, bridge and health errors | operations | `429 budget` for daily token exhaustion, `429 rate_limited` for the hourly limit, `413 too_large` for oversized webhook bodies. Configure `INDAI_DAILY_TOKEN_BUDGET` in New York calendar days. |

Rules: add fields freely, never rename or remove one; errors are `{ error: code, message }` with a real HTTP status;
every function answers `OPTIONS` with open CORS; nothing secret is ever returned to the client.

## Back-end backlog (ChatGPT), in priority order

1. **Thinking key.** Hosted status reported `configured:true` on November 19, 2026. A no-search talk probe returned spoken text in 1.47 seconds after rollout. The target is under three seconds. Run `supabase/checks/brain-live.sh` after deployment.
2. **Streaming talk.** Live. Send `mode:"talk", stream:true` for `{delta}` chunks of `spoken`, then one final result envelope. Three hosted probes received the first spoken text in 868–911 ms. The clients can start playback once they have a sentence.
3. **Server speech-to-text (optional accuracy upgrade).** `indai-ears` is deployed. Selection and credentials for the optional Deepgram adapter are pending. The endpoint accepts a 16 kHz mono WAV and returns `{ text, alternatives[], ms }`. The client integration point is `transcribe()` in `js/voice.js`.
4. **Sync what she learns.** `mode:"profile"` with `op:"get"` or `op:"put"` is live for protected profiles, including `indai.speech.v1` and `indai.ears.v1`.
5. **Accounts.** Email accounts and scoped database access are live. Configure an owner passcode for the signed-out headset. Legacy-owner transfer is staged.
6. **Morning GEX job.** The scheduler starts at 09:14 ET, retries at 09:17 and audits coverage at 09:20. The November 19 deadline was missed. All 112 tickers had both scopes at 09:20:45 ET. The weekday failure monitor checks at 09:22 ET.
7. **Real-time data.** The live CBOE relay reports its 900-second delay. A Massive adapter is available once the owner selects the provider and obtains the required entitlements.
8. **Push alerts.** Subscription and alert delivery endpoints are deployed. The owner set the VAPID keys and the passcode on November 19, two browsers are registered, and a test push was accepted by the provider that evening. The scan now starts when the bridge stores the minute that completes a five-minute candle (migration `20261120001048`, see "Alert timing" in `supabase/OPERATIONS.md`); before that it ran only on the per-minute timer and was close to a minute behind every candle. No setup has been pushed in a live session yet: the first browser registered after the November 19 close, so November 20 is the first. Still to confirm: a notification displayed with the app closed.
9. **Push needs today's plan.** `eligible()` only sends when the stored `plan` carries today's New York date, and the website writes it when it is opened. A trader who has not opened INDAI that morning gets no pushes. Decide whether the last plan should carry into a new day with a fresh risk state.
10. **Bridge coverage.** On November 19 the bridge's candles start at 12:40 ET, so the scan ran on a part session (session VWAP, the clouds and the opening range all start from the first stored candle). Nothing warns when candles are missing after the open.
11. **Research replies cut off.** Researched `trade` and searched `talk` replies have come back incomplete (`502 parse`) while still being charged to the daily token budget. The website now protects itself, but the cause is here, probably the reply token limit.
12. **Read endpoints are open.** `indai-market`, the `indai-tv` GETs and `indai_gex_levels` answer without the owner passcode, so the access lock covers the brain, memory, profile and push but not prices or bridge candles.
13. **Learned adjustments.** The website's Retrospective changes scores on the device (`indai.web.retro.v1`); the push scanner does not know them, so a pushed score can differ from the one the app shows.
14. **CBOE refused the backend.** From about 17:25 ET on November 19 every CBOE request from the functions (quotes, intraday candles, option chains) returned 403, with no rise in our request rate beforehand. Whether that is an evening window on CBOE's side or a block is not known yet. `snapshot` and `bars` now fall back to the bridge's candles (see the contract row above); option chains, GEX levels and the morning GEX job still depend on CBOE. Do not disguise the client to get around a refusal. A source the owner is entitled to (Schwab's market data with his own developer app, or the Massive adapter) is the lasting answer.
15. **Bridge extended hours.** `tradingview/indai-bridge.pine` asks for the extended session by default. The owner pasted it and re-created the alert on a 1-minute chart at 00:27 ET on November 20; after-hours one-minute candles (19:59 ET) arrived from then on. The alert must sit on a 1-minute chart: for a few minutes that night a second alert on a 5-minute chart was sending `tf:"5"` candles, and because the table's key is `(ticker, t)` such a candle would have replaced the one-minute candle that starts at the same moment. Migration `20261120052807` now keeps a stored one-minute candle in that case. Still open: the key itself does not include the timeframe, and nothing tells the owner when the bridge is on the wrong timeframe.

16. **Three brains.** Live in version 11 of `indai-brain`, waiting for the owner's `PERPLEXITY_API_KEY` (see "Three brains" in `supabase/OPERATIONS.md`). Perplexity researches, Claude judges, ChatGPT gives a second opinion and stands in when Claude cannot answer. Still open: the first run against the real providers; conversation (`talk`) still searches with Claude alone, and Perplexity should become its search too once the first researched answers have been seen working; both apps should show `brains` and `result.second`.

17. **Website requests from ChatGPT (see "Website handback to Ikpa").** Received, not built yet: the `drawings` and `tuning` profile keys with their merge rules, and the Schwab order contract. Until then the website keeps that work on the device, as it says.
18. **Live ticks and extended hours.** The website now draws pre-market and after-hours candles from the bridge's stored candles and shows the extended-hours price under the regular one (`indai/js/ext.js` in the website repository; Ikpa built it at the owner's request on November 20, with ChatGPT's pull request already merged underneath). The owner added a Finnhub key on his device the same morning for trade-by-trade prices. Not known yet: whether Finnhub's free stream carries pre-market trades. The lasting answer for live data and option chains is still a source the owner is entitled to (item 14).

19. **Market Pattern Atlas.** The owner's book, *The Market Pattern Atlas*, arrived as an engine in `atlas/` (no data:
    the repository is public, and the knowledge base goes in a private table). Ikpa's tickets ATLAS-0 to ATLAS-8 are in
    `handoff/IKPA-ATLAS-TASKS.md`: load the data privately, an atlas read on every rated idea (`result.atlas`, additive),
    TA-Lib-matching candle detectors, VIX for the red hat, a no-model `mode:"atlas"` endpoint, chart marks on the website,
    the formula desk in the options calculator, and logging the owner's live results against the atlas baseline.

## Front-end backlog (Claude)

1. Tune gestures and voice on the real headset from the owner's feedback (levels: easy / normal / strict).
2. Consume streaming talk when it exists; speak sentence by sentence.
3. Standalone website (below), kept feature-for-feature with this app via `FEATURES.md`.
4. Rebuild the Quest APKs with the new logo icon.

## Standalone website

A separate, flat (no 3D) responsive site for phone, iPad and laptop. It reuses the same backend and the same
brains (`feeds.js`, `market.js`, `analysis.js`, `signals.js`, `options.js`, `relay.js`, `indai.js`, `voice.js`, `speech.js`)
and replaces only the presentation layer (`main.js`, `hud.js`, `panels.js`, `scenes.js`, `gestures.js`).
Every feature added to either app is recorded in `FEATURES.md` so the other can follow.

## How to hand work across

- One branch per change, small pull requests, a line in `FEATURES.md` for anything a user would notice.
- Back-end changes ship with a `curl` example in the PR. Front-end changes ship with a passing test from the test list in the README.
- If the contract has to change, change this file in the same PR.
