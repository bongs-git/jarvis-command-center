# INDAI handoff: who builds what

INDAI is one product with two faces: the Meta Quest command center (this repo) and a standalone website
for phone, tablet and laptop (separate project, see "Standalone website" below). Both sit on the same backend.
This file is the contract between the two builders so they never edit the same thing.

## The split

| Lane | Owner | Owns | Never touches |
|---|---|---|---|
| **Front end** | Claude | Everything a person sees, hears or touches: this repo's `index.html`, `js/`, `sw.js`, the Quest APK build, voice in and out, gestures, scenes, panels, and the standalone website UI | Supabase schema, edge function code |
| **Back end** | ChatGPT | Supabase project `zptjziewsfuvfcogrikz`: edge functions in `/supabase`, tables, scheduled jobs, data vendors, the LLM brain's prompts and memory, auth | Anything under `js/`, `index.html`, `sw.js` |

Why this way round: the front end needs a real headset loop (WebXR emulator tests, hand tracking, on-device
speech models, APK builds) that is already set up and passing here. The back end is plain HTTP + SQL with a
written contract, so it can be built and tested from anywhere.

## The contract (do not break without agreeing a version bump)

Base URL `https://zptjziewsfuvfcogrikz.supabase.co`. Clients send the public project key as `apikey`. Send the signed-in user’s access token as `Authorization: Bearer`, or the public key for a signed-out request.
The only client is `js/relay.js`. The function sources in `/supabase` are the source of truth for response shapes; the original shapes were checked against the deployed brain function. Additions marked pending in `FEATURES.md` describe the release candidate.

| Endpoint | Purpose | Shape |
|---|---|---|
| `GET /functions/v1/indai-market?kind=snapshot&symbols=SPY,QQQ` | quotes | see `supabase/indai-market/index.ts` |
| `…?kind=bars&symbols=` | 1-minute candles | same file |
| `…?kind=daily&symbols=` | daily candles | same file |
| `…?kind=chain&symbol=&expiry=&range=` | options chain with Greeks and GEX | same file |
| `…?kind=news&symbol=` | headlines | same file |
| `GET /functions/v1/indai-tv` , `?bars=1&since=` | TradingView alerts and bridge candles | see `supabase/indai-tv/index.ts` |
| `POST /functions/v1/indai-tv?key=…` | TradingView webhook (private key in `indai_private_config`) | Pine `alert()` JSON |
| `GET /functions/v1/indai-brain` | status | `{ configured, passcode, memory }` |
| `POST /functions/v1/indai-brain` `{mode:"trade"}` | researched RAG verdict | `{ result: { rag, confidence, headline, spoken, summary[], bullish[], bearish[], news[], events[], watch[], plan_notes } }` |
| `POST … {mode:"talk", question, history[], context, speech}` | conversation | `{ result: { spoken, summary?, command?, heard_as?, remember?, forget? }, remembered[] }` |
| `POST … {mode:"memory", op:"list"/"add"/"forget", text?, ids?}` | long-term memory | `{ memory: [{ id, kind, text, created_at }] }` |
| `GET /rest/v1/indai_gex_levels` | morning GEX levels | rows per ticker and scope |
| `POST indai-brain {mode:"talk",search:false,…}` | answer from supplied context | same talk envelope, empty sources |
| `POST indai-brain {mode:"talk",stream:true,…}` | SSE | `data: {"delta":"…"}`, one final talk envelope, then `data: [DONE]`. A failure after speech starts sends an error event and closes. |
| `POST indai-brain {mode:"profile",op:"get"/"put",key,value?,mutation_id?}` | shared profile | `{key,value,updated_at}`. Use the localStorage keys, `plan` or `watchlist`. Send speech counter increments and a stable mutation UUID on retry. Missing values return null. |
| `POST indai-brain {mode:"history",op:"list"/"clear",session?}` | saved conversation | `{turns:[]}`. Talk defaults to the same session on each device. Empty history resumes it. A stable talk `request_id` prevents duplicated stored turns on retry. |
| `POST indai-brain {mode:"memory",op:"add",text,kind?}` | learned memory | Rows add `uses,last_used`. Kinds are fact, preference, rule or vocabulary. Talk can return `used_ids`. |
| `POST indai-ears?symbols=QQQ,SPY` with `Content-Type: audio/wav` | server transcription | `{text,alternatives:string[],ms}`. 16 kHz mono 16-bit PCM, up to 30 s / 1 MB. Activate with `INDAI_STT_PROVIDER=deepgram` and the provider secret. |
| `GET indai-market?kind=health` | scheduled job health | `{jobs:[{job,ok,detail,at,state}]}`. The 09:20 ET `gex` check covers the entire universe. Database failure notifications and an optional HTTPS operations webhook report failures. |
| `POST /auth/v1/otp {email}` then use the SDK sign-in session | email magic link | Send the public project key as `apikey` and the user access token as Bearer. The existing owner passcode permits signed-out private access. With only the public key, talk is stateless. |
| `GET indai-market?kind=snapshot/bars/chain` | feed provenance | Same data shapes plus `source,delay` in seconds. Licensed users can receive Massive after provider activation. CBOE fallback reports 900. RSS and job health have no fixed delay. |
| `GET indai-push`, `POST indai-push {op,subscription?,endpoint?}` | Web Push | GET returns the public VAPID key. Subscribe with `PushSubscription.toJSON()`. Unsubscribe or test by endpoint. Test returns the provider acceptance count. Sync a dated plan with aggr, capital, strategies, risk state, and watchlist. |

Rules: add fields freely, never rename or remove one; errors are `{ error: code, message }` with a real HTTP status;
every function answers `OPTIONS` with open CORS; nothing secret is ever returned to the client.

## Back-end backlog (ChatGPT), in priority order

1. **Thinking key.** Hosted status reported `configured:true` on November 19, 2026. A no-search talk probe returned spoken text in 6.26 seconds. The target is under three seconds. Run `supabase/checks/brain-live.sh` after deployment.
2. **Streaming talk.** Add `mode:"talk", stream:true` returning server-sent events (`{delta}` chunks of `spoken`, then one final `{result}`), so INDAI starts speaking on the first sentence.
3. **Server speech-to-text (optional accuracy upgrade).** `POST /functions/v1/indai-ears` taking 16 kHz mono WAV, returning `{ text, alternatives[] }`. The client already has a single `transcribe()` seam in `js/voice.js` to plug it into.
4. **Sync what she learns.** Table + endpoints for the speech profile (`indai.speech.v1` and `indai.ears.v1` in localStorage today) so the headset, phone and laptop share one learned profile: `mode:"profile", op:"get"|"put"`.
5. **Accounts.** Today it is single-user with a public key and an optional passcode. Add Supabase Auth and row-level security before anyone else uses it.
6. **Morning GEX job.** `indai_gex_levels` last refreshed 11-16; make the 9:14 ET job reliable and alert on failure.
7. **Real-time data.** Replace the 15-minute delayed CBOE relay with a licensed real-time source when the owner picks one; keep the response shapes.
8. **Push alerts.** Web Push for signals when the app is closed (the website will need this on phones).

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
