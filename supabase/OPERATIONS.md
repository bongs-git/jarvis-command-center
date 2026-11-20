# INDAI backend release

This release targets the existing INDAI project `zptjziewsfuvfcogrikz`. Its SQL upgrades the deployed TradingView, GEX and memory tables. A new empty database needs the original TradingView tables first. Apply the ticket migrations in filename order and deploy the six functions from the same reviewed revision.

## Hosted rollout on November 19, 2026

All six functions are deployed to `zptjziewsfuvfcogrikz`. The public headset key receives stateless talk and streamed speech. Saved history requires either a verified account or a signed-out request with a configured owner passcode. The owner passcode was unset at rollout. The live no-search probe returned spoken text in 1.47 seconds, and the live trade returned all eleven verdict fields. Three production probes timed the first spoken text at 868, 911 and 893 ms, measured from the jobs worker to the brain. Every stream’s deltas reproduced its final spoken text. These timings end at receipt of text. Headset playback is a separate client check.

Hosted isolation, profile-merge and rate-limit checks used synthetic data inside a rolled-back transaction. Hosted Auth advertises email sign-in, and public-key-only history requests returned HTTP 401. All six deployed function bundles matched the source files in this release and returned HTTP 204 with open CORS on browser preflight.

The GEX table contains both scopes for 112 tickers. The 09:20 watchdog recorded 110 tickers still missing current levels. All 224 rows were current at 09:20:45 ET. After correcting the CBOE envelope's UTC timestamp, the worker verified 14 batches covering all 112 tickers. `kind=health` distinguishes the deadline result (`gex`) from the later completeness check (`gex-coverage`). A separate failure-only ChatGPT monitor checks the result at 09:22 New York time on weekdays and skips exchange holidays. Its first scheduled check is November 20.

The hosted advisors reported one security warning for `pg_net` in the public schema. The installed extension is non-relocatable. Schedule any extension rebuild separately to preserve the HTTP queue and response history. [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)

## Deploy and maintain the existing project

The migrations in `supabase/migrations` use their actual hosted version numbers. The project also has seven migrations that predate this release. To use the CLI against this existing project, fetch the older history into a private temporary working directory. Keep its historical SQL local.

```bash
project=zptjziewsfuvfcogrikz
review_dir=$(mktemp -d)
mkdir -p "$review_dir/supabase"
cp supabase/config.toml "$review_dir/supabase/config.toml"
supabase migration fetch --remote="$project" --workdir="$review_dir"
cp supabase/migrations/*.sql "$review_dir/supabase/migrations/"
supabase db push --remote="$project" --workdir="$review_dir" --dry-run
```

For migrations in a later release, review the dry-run output and apply the reviewed changes from the same directory. Deploy functions from the repository root so the custom entrypoint paths and shared modules are included. The market relay uses the hosted JWT gateway. The jobs worker authenticates scheduled calls with its Vault token.

```bash
set -e
for name in indai-jobs indai-brain indai-market indai-tv indai-ears indai-push; do
  supabase functions deploy "$name" --remote="$project" --yes
done
supabase db advisors --remote="$project" --type all --level warn --fail-on error
```

The scheduler target is configured in Vault. The optional `indai_alert_url` Vault entry connects job failures to the owner's HTTPS operations endpoint. PostgreSQL emits warnings and publishes to `indai_job_failures`. To measure first spoken delta after a deployment, run `select public.indai_dispatch('brain-check')` in the SQL Editor. The worker uses a fixed stateless question, records both timings, and verifies every received delta against the final spoken text.

The nightly three-day bridge purge, the 150-row memory cap, semantic compaction and the administrative transfer of a legacy owner's data are staged in `supabase/pending/retention_and_memory.sql`. Applying that file schedules real removal of eligible records. Once approved and applied, move the file into `supabase/migrations` using the version recorded by the project. Private learning, profile sync, saved conversations and authenticated accounts already have their database objects. Until owner transfer is enabled, an administrator can identify the verified owner in **Authentication → Users** and retain that UUID for the later link.

## Alert timing

The bridge stores each one-minute candle about three seconds after the minute closes (November 19: median 2.8 s, 95% within 5.6 s). The `indai-push-scan` timer runs at second 0 of every minute, so on its own it finds a finished five-minute candle close to a minute late. Migration `20261120001048_indai_push_scan_on_bar_arrival.sql` adds the statement trigger `indai_bars_arrived` on `indai_tv_bars`: when a write stores a new one-minute candle that completes a five-minute candle (and is at most seven minutes old), it calls `public.indai_push_tick()`, the same entry the timer uses. The session check, the subscriber check, the scanner and the one-setup-per-user-ticker-candle rule are unchanged, and the timer remains as the fallback. A failure inside the trigger is swallowed so a candle is always stored.

`supabase/checks/bars-arrival.sql` exercises the trigger in a disposable database (the command is at the top of the file). On the hosted project it was applied after a rolled-back trial write as `service_role`, and a manual `select public.indai_dispatch('push')` after the close completed with "Market closed.".

To measure the delay from a candle's close to its alert being queued on a trading day:

```sql
select ticker, strat, at, round(extract(epoch from at - to_timestamp((bar_t + 300000) / 1000.0))::numeric, 1) as seconds_after_close
from public.indai_signal_events where at > now() - interval '1 day' order by at;
```

First trading day with the trigger, November 20, checked at 9:46 ET: besides the timer's run at second 0 of every minute, a scan was logged at 9:35:02.4, 9:40:04.1 and 9:45:03.8, two to four seconds after each five-minute candle closed (and at 9:30:18 for the last pre-market candle, which TradingView delivered late at the opening bell). All 21 runs since 9:30 ended "Queued 0 setups", none failed, and every `net._http_response` row was 200. The six bridge tickers had every one-minute candle from 9:30, stored 2.4 s after the close on average and 6.8 s at worst. The owner's plan was today's and eligible, with three devices subscribed. No setup had fired, so `indai_signal_events` was still empty and the delay to a real alert has not been measured yet: run the query above after the first alert.

To remove it: `drop trigger indai_bars_arrived on public.indai_tv_bars; drop function public.indai_bars_arrived();`

A second trigger on the same table, `indai_keep_minute_bar` (migration `20261120052807_indai_tv_bars_keep_minute_candles.sql`), protects the one-minute candles the scan is built from. The table's key is `(ticker, t)`, so a bridge alert left on another timeframe sends candles that start at the same moment as a one-minute candle; an update that would change a stored one-minute candle's timeframe is now skipped, while a one-minute candle still replaces a stored candle of another timeframe. `supabase/checks/bars-arrival.sql` checks both triggers. The bridge alert belongs on a 1-minute chart: `select tf, count(*), max(received_at) from public.indai_tv_bars group by tf` shows what is arriving.

## Prices between candle closes

Finished candles arrive once a minute. From `indai-tv` version 11 the bridge can also send the candle that is still forming: `tradingview/indai-bridge.pine` cuts each one-minute candle into four parts and sends one update on the first tick in each later part (`{"kind":"live","tf":"1","bars":[…]}`), so about every 15 seconds, plus the finished candle at the close. TradingView stops a regular alert after "no more than 15 triggers in 3 minutes"; three updates and one close a minute is 12, and the script cannot send more than its setting allows.

The updates are kept in their own table, `indai_tv_live` (migration `20261120110046_indai_tv_live.sql`), one row per ticker, written by `indai_tv_live_put`, which never lets an older update replace a newer one. They never enter `indai_tv_bars`: the push scanner, the price fallback and chart history all count on that table holding finished candles only, and the scan trigger fires on inserts there. `GET indai-tv?bars=1` returns them in `live` while they are under 90 seconds old.

The same answer now carries a `cursor`. An app that sends it back as `seen` gets only what was stored since, so a look that finds nothing new reads a few index entries and returns two empty lists. The cursor is held 1.5 seconds short of now so a write that lands a moment late is not missed.

To see what is arriving: `select ticker, to_timestamp(t/1000), c, received_at from public.indai_tv_live order by ticker`. No rows younger than a minute during trading hours means the alert on TradingView is still the old one (an alert keeps the script it was created with), sits on a chart that is not one-minute, or has been stopped. Checks: `supabase/checks/live_test.ts`, `supabase/checks/live-feed.sql` (disposable database). The endpoint's bundle is `indai-tv/index.ts`, `indai-tv/live.ts` and `_shared/http.ts`, `auth.ts`, `db.ts`, with `verify_jwt` off.

## Schwab

The owner's own Schwab account is INDAI's source of live quotes, candles and option chains for him (and for nobody else: Schwab's data is for the account holder). Three parts:

- **His app at Schwab.** Its key and secret are the Supabase secrets `SCHWAB_APP_KEY` and `SCHWAB_APP_SECRET`, which he types in himself. The callback registered on the app is `https://127.0.0.1` (`SCHWAB_CALLBACK` if it is ever another). Do not edit the app at Schwab: any change sends it back to "Approved - Pending" for days.
- **His sign-in** (`indai-schwab`, `_shared/schwab.ts`, page `indai/schwab.html` on the website). He opens Schwab's sign-in, approves, and his browser lands on `https://127.0.0.1/?code=…`, a page that cannot load. He pastes that address into the page within about 30 seconds; the function trades the code for tokens and keeps them in `public.indai_schwab` (service role only). The access token lasts 30 minutes and is renewed by whichever instance needs it; the refresh token lasts seven days from the sign-in and nothing renews it: he signs in again weekly. `select signed_in_at, access_until, updated_at from public.indai_schwab` shows the state without showing a token. If Schwab refuses the refresh token the row is deleted and the page says "Not connected".
- **The data** (`indai-market/schwab.ts`). A request that carries his passcode or his own sign-in is answered from Schwab: `snapshot` and `quote` with one request for all symbols, `daily` from price history, `chain` from the next 46 days and the 120 strikes nearest the price (asked whole; if Schwab refuses the size, in four date ranges), `bars` from the bridge for the tickers it carries and from Schwab for the rest. Anything Schwab cannot give falls through to the public sources. Answers are marked `source:"Schwab"` and `Cache-Control: private, no-store`. Schwab allows about 120 requests a minute.

None of this has met the real Schwab yet. It was written from the documented shapes and runs against stand-ins (`supabase/checks/schwab_test.ts`). When he first connects, check in this order: the page's first quote (`test`), `kind=snapshot` with the passcode (is `delay` 0, are extended-hours prices what he sees at Schwab), `kind=chain` for SPY (does the whole request pass or does it take four parts, how long, are open interest and implied volatility filled in), `kind=daily&days=6000`. Function logs show `Schwab <status> for <path>` only inside error text returned to him, never tokens.

Not built: streaming and orders. The GEX morning refresh does not use Schwab; it runs without his passcode.

## The atlas (`mode:"atlas"`)

The Market Pattern Atlas's knowledge base is the owner's private data. It lives in one row of `public.indai_atlas` (key `kb`), readable only by the service role, and nowhere in the repository; `atlas/load/README.md` is how it gets there. `indai-brain` version 12 answers questions from it with no model call (`indai-brain/atlas.ts`): it reads the row once per cold start, builds the engine (`_shared/atlas/indai_atlas_engine.js`, a copy of `atlas/indai_atlas_engine.js` that a check keeps identical), and returns the engine's answer to one question at a time. The whole knowledge base is never returned.

Who is answered: the owner's passcode, or the owner's own sign-in. Any other signed-in account gets 403. Each request is counted in the `atlas` bucket of `indai_rate_events`, 600 an hour.

To check it on the hosted project: `GET indai-brain` lists `atlas` in `modes`; `POST {mode:"atlas",op:"lookup",rule:"hammer",trend:"below",vol:"high",horizon:5}` with the passcode returns `result.cell.later` of 0.573 against 0.543 on 1,101 cases with `cellGrade:"RED"`; the same request without the passcode returns 401. `503 atlas_unavailable` means the row is missing: `select version, pg_size_pretty(pg_column_size(value)::bigint) from public.indai_atlas`. After loading a new revision, the running instances keep the old one until they restart; redeploy the function, or wait for it to go cold.

In the function's log line an atlas request shows as mode `unknown`: the list of names the log knows is in `_shared/http.ts`, which all six functions bundle, and it was left alone so the other five still match the repository byte for byte. Every other accepted mode is in that list, so in the brain's log `unknown` means atlas. Add the name the next time `http.ts` changes and all six are deployed.

Checks: `supabase/checks/atlas_test.ts` uses a stand-in knowledge base with made-up numbers; run it with `ATLAS_KB=/path/atlas_kb.json` to also check the book's published example against the real file. The brain's bundle is now `indai-brain/index.ts`, `atlas.ts`, `history.ts`, `memory.ts`, `profile.ts`, `stream.ts`, `super.ts`, `_shared/http.ts`, `budget.ts`, `db.ts`, `auth.ts` and `_shared/atlas/indai_atlas_engine.js`, with `verify_jwt` off.

## When CBOE refuses the backend

On November 19 from about 17:25 ET, CBOE answered every request from the functions with 403 (quotes, intraday candles and option chains alike). `indai-market` version 10 keeps the apps supplied with prices and candles from the TradingView bridge in that case: when the CBOE request for a ticker fails, `snapshot` and `bars` answer that ticker from `indai_tv_bars` (`indai-market/bridge.ts`), marked `source: "TradingView bridge"`, `delay: 0`. While CBOE answers, nothing changes. During regular trading a bridge quote is only given if the newest stored candle is at most ten minutes old, so an old candle is never shown as the current price; outside regular trading the last stored candle is given with its own timestamp. Tickers the bridge does not send, and all option chains, still fail as before.

**It is a block, not a nightly window.** Checked on November 20 at 9:02 ET: still refused. The last option-chain request CBOE answered was at 17:17 ET on November 19; every one since 17:25 ET has failed, through the night and the pre-market, more than fifteen hours. The night before, the functions' requests were answered between 1:00 and 7:00 ET, and on November 19 chains were answered from 9:05 ET, so the hour of day does not explain it. At 9:02 ET `snapshot` answered SPY, MSFT and IWM from the bridge and gave AAPL and SPX `CBOE 403`; `chain` answered 502, and again at 9:48 ET. It is the functions' addresses that are refused, not an outage at CBOE: at 8:47 ET the same morning the owner's "Morning GEX refresh" task read every chain from CBOE through his own browser. Treat CBOE as gone for the functions until a request succeeds: a replacement option-data source is job 4 in `handoff/PERPLEXITY-BRIEF.md`. We do not change the functions' headers or addresses to get around the refusal.

**GEX levels still arrive while the block lasts, by the other road.** Two of the owner's scheduled tasks sit outside this back end: "Morning GEX refresh" (8:45 ET, his browser) computes the levels, and "INDAI GEX sync" (9:14 ET) copies them into `indai_gex_levels`. On November 20 the back end's own refresh failed on every chain request (29 failed batches from 9:14 to 9:20 ET, and the 9:20 watchdog recorded "112 tickers still lack current levels"), and five seconds later the sync wrote all 224 rows, as of 8:47 ET. So on such a day `kind=health` shows `gex` as failed while the table is complete: `select count(*) from public.indai_gex_missing(current_date)` returning 0 is the truth about coverage. What is missing during the block is the live recalculation from the chain, every option chain, and prices for tickers the bridge does not send. An earlier version of this section said the levels would stay a day old; that was wrong.

**The servers stop asking while they are refused** (`indai-market` version 11, `indai-market/gate.ts`). Until then every request from the apps tried CBOE again: about 16,000 refused requests between the evening of November 19 and the afternoon of November 20. Now the first 403 (or 429) writes a row in `public.indai_feed_gate` (`name = 'cboe'`, with `until`), and until that time no instance sends CBOE anything: quotes and candles go straight to the bridge, and `chain`, `quote` and `daily` fail at once, with the same error text as before. When the pause ends, one request per instance tries the door. An answer deletes the row and everything flows again; another refusal doubles the pause: five minutes, ten, twenty, forty, then an hour at a time. An instance lives about a minute, which is why the memory is a table and not a variable. If the table cannot be read, requests go out as if there were no pause.

`select * from public.indai_feed_gate` shows whether CBOE is refusing right now and when the next try is; no row means it is answering (or has not been asked since the last answer). To try sooner, delete the row. Checks: `supabase/checks/gate_test.ts`.

`supabase/checks/bridge_test.ts` covers the fallback. To see what the hosted function is answering, call `kind=snapshot` and read each quote's `source` and `error`; a quote with `ok:false` carries CBOE's status in `error`. To see when it began or whether it has cleared, count `function_edge_logs` rows for `indai-market` with `kind=chain` by hour and response status: 200 is answered, 502 is refused.

Deploying one function without the CLI: upload every file of its bundle with the same names the hosted bundle has (`indai-market/index.ts`, `indai-market/licensed.ts`, `indai-market/bridge.ts`, `indai-market/gate.ts`, `indai-market/schwab.ts`, `_shared/http.ts`, `_shared/auth.ts`, `_shared/db.ts`, `_shared/schwab.ts`; `indai-schwab` is `indai-schwab/index.ts` with `_shared/http.ts`, `auth.ts`, `db.ts`, `schwab.ts`, `verify_jwt` off), entrypoint `indai-market/index.ts`, `verify_jwt` as in `config.toml`, then read the bundle back and compare it with the repository byte for byte. Version 10 was deployed and checked that way. The brain's bundle is `indai-brain/index.ts`, `history.ts`, `memory.ts`, `profile.ts`, `stream.ts`, `super.ts` and `_shared/http.ts`, `budget.ts`, `db.ts`, `auth.ts`, with `verify_jwt` off.

## Three brains

From version 11, `indai-brain` can answer a researched request (`trade` and `chat`) with three models, each with one job (`indai-brain/super.ts`). The owner's order of trust, November 20: "Your brain, perplexity especially and then ChatGPT last".

| Brain | Job | Switched on by |
|---|---|---|
| Claude | The judge: writes the verdict or the answer, as before. | `ANTHROPIC_API_KEY` |
| Perplexity | The research desk, first in line: today's news, events and sentiment from the live web, with sources. Claude is then handed that research and one search of its own (three on a deep idea) instead of five. | `PERPLEXITY_API_KEY` |
| ChatGPT | Last: an independent second read of every trade idea, run at the same time as Claude, and the stand-in when Claude is down or its reply is cut off. | The Perplexity key (through Perplexity's model catalog, `openai/gpt-6.1-sol`), or `OPENAI_API_KEY` to ask OpenAI directly |

- With neither key set nothing calls out and the function answers as version 10 did.
- Claude's rating always stands. A second opinion that disagrees lowers `confidence` (10 for one step apart, 25 for green against red), adds one line to `summary` and one sentence to `spoken`. It is kept in `result.second`.
- A failed research step or second opinion never fails the answer: Claude then searches as before. The answer's `brains` list says who did what, and the function logs one line per answer (`"brains":[…]`, with the provider's error type in `detail`).
- A spent daily budget or a refused request is final. ChatGPT stands in for an outage or a cut-off reply, never around the budget.
- Every outside call reserves and settles tokens in the same daily budget as Claude (`INDAI_DAILY_TOKEN_BUDGET`).
- Perplexity is sent the question, the parsed idea, the ticker and the headlines on screen. ChatGPT is sent the context Claude gets. Neither is sent the trader's name.
- Conversation (`talk`) is unchanged: Claude alone, with its own web search.
- Requests to Perplexity are spaced a little over a second apart, because its smallest usage tier takes one request a second.

Checked against Perplexity's documentation on November 20, 2026: the Sonar chat-completions API ended on September 27, 2026 and the Agent API (`POST https://api.perplexity.ai/v1/agent`, the same shape as OpenAI's `POST /v1/responses`) replaces it; its catalog includes OpenAI, Anthropic and Google models; API credits are bought in advance at console.perplexity.ai and are separate from a Pro or Max subscription.

Not yet run against the real providers: no key was set when version 11 was deployed, so the provider calls have run only against stand-ins (`supabase/checks/super_test.ts`, 16 tests). After the owner saves a key, read the first researched answer's `brains`, or the log line, before trusting it. If Perplexity refuses the research request's shape, the function already retries in the plain form (`model: "perplexity/sonar"` with the `web_search` tool).

## Owner-controlled configuration

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Active for talk and trade. |
| `PERPLEXITY_API_KEY` | Optional. Switches on Perplexity's research for `trade` and `chat`, and ChatGPT's second opinion through the same key. Created at console.perplexity.ai; needs API credits, which a Pro or Max subscription does not include. |
| `OPENAI_API_KEY` | Optional. Sends ChatGPT's part straight to OpenAI instead of through Perplexity. A ChatGPT subscription does not include API use. |
| `INDAI_SECOND_OPINION=off` | Optional. Keeps the research and the stand-in but skips the second read of every idea. |
| `INDAI_SECOND_MODEL` | Optional. The model for ChatGPT's part, default `gpt-6.1-sol`. |
| `INDAI_RESEARCH_EFFORT`, `INDAI_RESEARCH_EFFORT_DEEP` | Optional. Perplexity's effort level for a fast idea (default `fast`) and a deep one (default `low`). |
| `INDAI_PASSCODE` | Set an owner-chosen secret in Edge Function Secrets, then enter it in the original headset's settings for signed-out access to private memory. |
| `INDAI_DAILY_TOKEN_BUDGET` | Optional override for the default 250,000-token New York calendar day. |
| `INDAI_STT_PROVIDER=deepgram`, `DEEPGRAM_API_KEY` | Enable the optional server transcription adapter after selecting the provider. |
| `INDAI_MARKET_PROVIDER=massive`, `MASSIVE_API_KEY` | Enable an entitled real-time feed after licensing the relevant data. `INDAI_MARKET_LICENSED_USERS` takes additional licensed user UUIDs. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Set the stable owner-managed signing pair and contact URI in Edge Function Secrets to enable browser push. |

Register the actual website or app landing URL under **Authentication → URL Configuration** for email magic links. Confirm the owner's email sign-in before onboarding other users.

## Verify live behavior

Set `BASE` to the project URL and `ANON_KEY` to its public project key. For private acceptance cases, export a temporary verified user's `USER_JWT`, or set the owner's `INDAI_PASSCODE` for legacy access. The checks print status and timings without printing credentials or conversation text.

```bash
bash supabase/checks/brain-live.sh
python3 supabase/checks/stream-live.py
curl -fsS -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  "$BASE/functions/v1/indai-market?kind=health"
```

Check the GEX table after **9:20 a.m. New York time on a trading day**. Both scopes must be current for every saved ticker and the `gex` health entry must be successful. A previous close (including an early close) can supply the pre-open options snapshot. Stale or incomplete inputs leave the prior levels in place and show a failed refresh. The seeded exchange calendar covers 2026–2028. Extend `indai_sessions` when the exchange publishes later dates.

For speech, use a genuine four-second WAV of “QQQ calls expiring today six sixty five strike” to check text accuracy and the 700 ms target. For push, subscribe from the actual browser, call `op:"test"`, close the app, and confirm a notification appears. Provider acceptance can be measured on the server. Display requires Claude’s service worker and browser permission.

Daily plan updates should include `date` (YYYY-MM-DD in New York), `aggr`, `capital`, `strategies`, and current risk fields such as `tripped`, `pnl`, `goal`, and `cooldownUntil`. The separate `watchlist` profile is an object with a `symbols` array. Send deltas for speech `used`/`stats` counts and keep the same `mutation_id` on network retries. A talk `request_id` deduplicates saved turns. Use `mode:"history"` with the same `session` to resume across devices.

## Code and database checks

```bash
deno check supabase/indai-*/index.ts
deno test supabase/checks/*_test.ts
```

To repeat the integration checks, use a non-root development account with Bash, Node 22+, Deno 2, Python 3, curl and jq. The runner starts a private PostgreSQL cluster and loopback-only services on ports 55432–55436. Install PostgreSQL 18 binaries, PostgREST 16.6 and Supabase Auth v2.198.0 with its bundled migrations. Supply absolute paths when these are outside your system path.

```bash
npm ci --prefix supabase/checks/integration --ignore-scripts
export PGBIN=/path/to/postgres/bin
export POSTGREST_BIN=/path/to/postgrest
export GOTRUE_BIN=/path/to/auth
export GOTRUE_DB_MIGRATIONS_PATH=/path/to/auth-release/migrations
# Optional for the local advisor check, using Supabase's published Splinter SQL.
export SPLINTER_SQL=/path/to/splinter.sql
bash supabase/checks/integration/run.sh
```

The runner generates credentials for its disposable local database and prints the directory containing its logs and results. It also compares both scanners over 7,920 chart windows and runs both curl/stream acceptance scripts against the local API.

The 18 local integration checks used PostgreSQL 18, PostgREST 16, Supabase Auth and local SMTP. They exercised actual HTTP, two user sessions, concurrent writes, incremental SSE, provider adapters, migrations and the job workers. Anthropic, market data, Deepgram and browser push responses were fixtures. Cron, Vault and outbound database HTTP were simulated for those checks. Hosted provider timings, licensed data and browser notification display require the live checks above.

For recovery, keep the previous function revisions available in the dashboard. Restore a compatible function set alongside its database permissions. Reverting to an unscoped legacy brain after accounts have saved private data would expose those accounts. Owner transfer, retention and semantic compaction are held outside the active migrations. If these are activated later, records they remove can only be recovered from a suitable backup.
