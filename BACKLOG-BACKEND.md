# INDAI back-end backlog (for ChatGPT)

Paste this whole file into ChatGPT to start. Read `HANDOFF.md` in the same repo first: it has the split
(you own the back end, Claude owns the front end) and the API contract you must not break.

## Kickoff brief

You are the back-end engineer for INDAI, a personal trading command center (Meta Quest app plus a website).
- Repo: `github.com/bongs-git/jarvis-command-center`. Your code lives in `/supabase` (Deno edge functions). Do not edit `js/`, `index.html` or `sw.js`.
- Backend: Supabase project `zptjziewsfuvfcogrikz` (`https://zptjziewsfuvfcogrikz.supabase.co`). Existing functions: `indai-market`, `indai-brain`, `indai-tv` (all `verify_jwt: false`). Tables: `indai_gex_levels`, `indai_tv_alerts`, `indai_tv_bars`, `indai_private_config`, `indai_memory`.
- You need from the owner: a Supabase access token (or dashboard access) to deploy, and write access to the repo. Never put a secret in the repo or in a response body.
- Rules: add fields, never rename or remove them. Errors are `{ "error": "code", "message": "…" }` with a real HTTP status. Every function answers `OPTIONS` with open CORS (copy the `CORS` object from `indai-brain`). Each ticket ships with the curl test passing and a one-line entry in `FEATURES.md`.
- Work top to bottom. One pull request per ticket.

## Tickets

### BE-1 · Turn on the thinking brain  (owner action + check) · P0
`indai-brain` returns 503 `not_configured` because the `ANTHROPIC_API_KEY` secret is missing.
- Owner: Supabase dashboard → Edge Functions → Secrets → add `ANTHROPIC_API_KEY`. Optional: `INDAI_PASSCODE`.
- You: confirm with `curl -s $BASE/functions/v1/indai-brain` → `{"configured":true,…}`, then
  `curl -s -X POST $BASE/functions/v1/indai-brain -H 'content-type: application/json' -d '{"mode":"talk","name":"Bongs","question":"how are we looking this morning","history":[],"context":{}}'` returns `result.spoken`.
- Done when: both calls succeed and the talk reply arrives in under 3 seconds without web search.

### BE-2 · Streaming conversation · P0
Make INDAI start talking on the first sentence instead of after the whole answer.
- `POST indai-brain {mode:"talk", stream:true, …}` responds `text/event-stream`: events `data: {"delta":"…"}` carrying the `spoken` text as it is generated, then one `data: {"result":{…same object as today…},"remembered":[…]}` and `data: [DONE]`.
- Keep the non-streaming path exactly as it is.
- Hint: ask the model for the spoken text first as plain text, then a JSON trailer on a marker line; parse the trailer server-side.
- Done when: first `delta` arrives in under 1 second; final `result` matches the non-stream shape; `curl -N` shows chunks.

### BE-3 · One learned profile on every device · P1
The headset learns how the owner speaks (`localStorage` keys `indai.speech.v1` and `indai.ears.v1`). The phone and laptop should share it.
- Table `indai_profile(key text primary key, value jsonb, updated_at timestamptz)`, RLS on, service role only.
- `POST indai-brain {mode:"profile", op:"get", key}` → `{ key, value, updated_at }`; `op:"put", key, value` → merges and returns the same. Limit `value` to 64 KB.
- Merge rule for `speech`: union of `fixes` (higher `n` wins), sum of `used`, sum of `stats`.
- Done when: put from one client then get from another returns the merged profile.

### BE-4 · Conversation history on the server · P1
So a chat started in the headset continues on the phone.
- Table `indai_turns(id, session text, role text check in ('user','assistant'), text, created_at)`. `talk` appends the user line and INDAI's reply; if the request has no `history`, load the last 16 turns from the last 6 hours.
- `POST {mode:"history", op:"list"|"clear"}`.
- Done when: a `talk` call with empty `history` still knows what was said in the previous call.

### BE-5 · Smarter memory · P1
`indai_memory` is a flat list read into every prompt. Make it scale and stay tidy.
- Add `kind` values `fact | preference | rule | vocabulary`, `uses int`, `last_used timestamptz`. Have the talk prompt return which memory ids it used; bump `uses`.
- Nightly job: merge duplicates and near-duplicates (ask the model), cap at 150 rows by dropping the least used oldest.
- Done when: adding the same fact in different words twice leaves one row after the job runs.

### BE-6 · Server speech-to-text (accuracy upgrade) · P2
On-device recognition is fast but small. Offer a server path.
- New function `indai-ears`: `POST` 16 kHz mono 16-bit WAV (≤ 30 s, ≤ 1 MB) → `{ text, alternatives: [..], ms }`. Bias it with the watchlist tickers and the vocabulary from `indai_profile`. Pick the provider with the owner (needs their API key as a secret).
- Target: under 700 ms for a 4-second clip.
- Done when: `curl --data-binary @clip.wav` returns the right text for "QQQ calls expiring today six sixty five strike".

### BE-7 · Morning GEX refresh that cannot silently fail · P1
`indai_gex_levels` was last refreshed on 11-16; the app falls back to live-chain levels when it is stale.
- Move the refresh into a scheduled edge function (pg_cron at 9:14 ET on trading days) that computes call wall, put wall, second walls, gamma flip and net GEX per ticker from the chain data already in `indai-market`, and upserts.
- Write a row to `indai_job_log(job, ok, detail, at)` on every run; `GET indai-market?kind=health` returns the last run of each job.
- Done when: the table has today's date by 9:20 ET and `kind=health` shows `ok:true`.

### BE-8 · Accounts and row-level security · P1 (before anyone else uses it)
Today it is single-user with a public key.
- Supabase Auth (email magic link). Add `user_id` to `indai_memory`, `indai_profile`, `indai_turns`; RLS `user_id = auth.uid()`; functions read the JWT when present and fall back to the owner's rows when not (so the current app keeps working until the front end adds sign-in).
- Per-user rate limit on `talk` and `trade` (for example 60 per hour) with `429 { error:"rate_limited" }`.
- Done when: two test users cannot read each other's memory; the current app still works signed out.

### BE-9 · Real-time market data · P2
`indai-market` relays CBOE data delayed about 15 minutes; live candles only come from the owner's TradingView bridge.
- Add a provider layer behind the same `kind=snapshot|bars|chain` shapes; first provider chosen with the owner (needs their key). Add `"delay": seconds` and `"source"` to every response.
- Done when: `snapshot` reports `delay:0` with the provider key set, and the old path still works without it.

### BE-10 · Push alerts when the app is closed · P2
- Table `indai_push_subs(endpoint, keys, user_id)`, `POST indai-push {op:"subscribe"|"unsubscribe"|"test"}`, VAPID keys as secrets.
- A scheduled scan (every minute in market hours) runs the same setup rules the app runs (`js/signals.js` is the reference: copy the logic, do not import it) on bridge candles and sends a Web Push for A-grade setups, honouring the day's plan stored by the app (`POST {mode:"profile", key:"plan"}` from BE-3).
- Done when: `op:"test"` delivers a notification to a subscribed browser.

### BE-11 · Hardening · ongoing
- Run the Supabase security and performance advisors; fix what they flag.
- `indai-tv` webhook: constant-time key compare, 16 KB body limit, drop rows older than 3 days nightly.
- Structured logs (`fn`, `mode`, `ms`, `status`) on every request; a `kind=health` roll-up.
- Cost guard: daily token budget for `indai-brain`; return `429 { error:"budget" }` past it.

## Definition of done for every ticket
1. Deployed and the curl example in the PR passes against the live project.
2. No existing field renamed or removed; `HANDOFF.md` contract table updated if you added anything.
3. One line added to `FEATURES.md`.
4. A short note for the front end: what to call, what comes back.
