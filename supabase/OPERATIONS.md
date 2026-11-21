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

Released on November 20, 2026 at 2:15 PM New York time, during the session, at the owner's request ("I would like the release to go now rather than wait"): `indai-market` version 16, `indai-brain` version 18, with `indai-schwab` version 4 already live. All three were read back and matched the repository byte for byte. Version numbers on this project also move when a secret is added, which is why they jump.

The owner's own Schwab account is INDAI's source of live quotes, candles and option chains for him (and for nobody else: Schwab's data is for the account holder). Three parts:

- **His app at Schwab.** Its key and secret are the Supabase secrets `SCHWAB_APP_KEY` and `SCHWAB_APP_SECRET`, which he types in himself. The callback registered on the app is `https://127.0.0.1` (`SCHWAB_CALLBACK` if it is ever another). Do not edit the app at Schwab: any change sends it back to "Approved - Pending" for days.
- **His sign-in** (`indai-schwab`, `_shared/schwab.ts`, page `indai/schwab.html` on the website). He opens Schwab's sign-in, approves, and his browser lands on `https://127.0.0.1/?code=…`, a page that cannot load. He pastes that address into the page within about 30 seconds; the function trades the code for tokens and keeps them in `public.indai_schwab` (service role only). The access token lasts 30 minutes and is renewed by whichever instance needs it; the refresh token lasts seven days from the sign-in and nothing renews it: he signs in again weekly. `select signed_in_at, access_until, updated_at from public.indai_schwab` shows the state without showing a token. If Schwab refuses the refresh token the row is deleted and the page says "Not connected".
- **The data** (`indai-market/schwab.ts`). A request that carries his passcode or his own sign-in is answered from Schwab: `snapshot` and `quote` with one request for all symbols, `daily` from price history, `chain` from the next 46 days and the 120 strikes nearest the price (asked whole; if Schwab refuses the size, in four date ranges), `bars` from the bridge for the tickers it carries and from Schwab for the rest. Anything Schwab cannot give falls through to the public sources. Answers are marked `source:"Schwab"` and `Cache-Control: private, no-store`. Schwab allows about 120 requests a minute.

`indai-schwab` version 1 and the table (migration `20261120180346_indai_schwab.sql`) went live on November 20 at 1:03 PM New York time, ahead of the rest, so that he could sign in during the day; the data part ships with `indai-market` version 16. He connected on November 20 at 2:04 PM New York time, after one correction: his app's callback is `https://127.0.0.1/` with a closing slash, so the secret `SCHWAB_CALLBACK` holds that (Schwab refuses the sign-in after the login when the callback differs by a character; `op:"check"` and the page say whether the key and secret are recognised, which narrows it to the callback). Real requests with his sign-in then showed: quotes marked `realtime: true` for SPY and `$SPX`, with the field names the adapter reads; an SPY chain for 46 days and 120 strikes in one request (14 expirations, 3,360 contracts, 4 MB, open interest and implied volatility in percent as expected); 20 years of daily candles (5,031); and one thing the stand-ins could not show: price history without `endDate` answers with the last finished session, so the adapter now sends `endDate` = now and gets today's candles up to the current minute (and today's forming daily candle). With `needExtendedHoursData=true` Schwab's minute candles start at 7:00 AM. Still to check with his passcode on the live service: the page's first quote (`test`), `kind=snapshot` with the passcode (is `delay` 0, are extended-hours prices what he sees at Schwab), `kind=chain` for SPY (does the whole request pass or does it take four parts, how long, are open interest and implied volatility filled in), `kind=daily&days=6000`. Function logs show `Schwab <status> for <path>` only inside error text returned to him, never tokens.

- **The live stream** (`indai-schwab` version 6, live November 20 at 3:13 PM New York time, read back and identical to the repository). A function cannot hold a long connection, so his own browser opens Schwab's stream. `op:"stream"` asks Schwab's `trader/v1/userPreference` for the stream's address and the account's stream identifiers and returns them with the current access token, to the owner only, and only an address under `schwab.com` is passed on. This is the one place a token leaves the back end: it is good for at most thirty minutes, it reaches a browser that has just sent the owner's passcode, and it can do whatever his sign-in can do at Schwab, so nothing in the page stores it or prints it. The refresh token still never leaves. Requests for it are counted in the `schwab-stream` bucket (120 an hour), apart from the page's `schwab` bucket (60), so a stream that keeps reconnecting cannot lock him out of the Connect page; the website's client also slows to one try every five minutes when a stream keeps failing. Schwab allows one stream per person: a second device takes it and the first waits five minutes before asking again. Without the passcode `op:"stream"` answers 401 (checked on the live service). Not checked from here: the answer with his passcode, because it holds a token. If the "Test live stream" button on `indai/schwab.html` reports that the stream closed before signing in, Schwab's stream is refusing connections from a browser page, and the alternative is a relay.

The GEX morning refresh does not use Schwab; it runs without his passcode.

## Orders (`indai-orders`)

Asked for by the owner on November 20, 2026 ("how can i trigger a position from India", "I want it to be very easy. And i want to be able to move my stop Loss levels via line on the graph by grabbing and moving"), with three choices he made the same afternoon: the stop is a real order held at Schwab, every buy goes out with a stop 20% under its limit price, and nothing over $5,000 is sent. Version 1 went live that day at 3:37 PM New York time (read back, identical to the repository) with migration `20261120203259_indai_orders.sql`.

INDAI never sends an order by herself. Every send is the owner's tap on the Trade page (`indai/trade.html` on the website), and the function accepts only: one option contract bought to open with a limit, with a stop attached; that stop moved; a held contract sold to close with a limit; one working order cancelled. The rules are in `indai-orders/orders.ts` and are enforced in the back end, whatever a page sends: $5,000 an order (`MAX_ORDER_USD`; the secret `INDAI_ORDER_MAX_USD` can lower it, never raise it), 50 contracts, no market orders to open, no shorts, no shares, nothing on an expired contract, and a stop that is at or above the option's price is refused because it would sell at once. A stop is `orderType STOP`, `stopType MARK` (it sells at market when the middle of bid and ask touches it, the trigger his own orders at Schwab use), for the day on a contract expiring today and until cancelled otherwise. Moving a stop or closing a position replaces the one working sell order at Schwab (`PUT`), so a contract is never offered twice.

Two protections beyond the passcode. **A record and no double sends:** each send carries a `nonce` the page makes per tap; the request is written to `public.indai_orders` before Schwab is called and completed with Schwab's answer (`status`, `order_id`, `message`), and a second request with the same nonce is answered from that row. `select at, op, account_tail, request, status, order_id, message from public.indai_orders order by id desc limit 20` is the history of what INDAI was asked to send; it holds the last four digits of the account, never the number. **An approved device:** the passcode alone reads (positions, quotes, Schwab's preview) but cannot send. Sending needs the header `x-indai-device`, a key made and kept by one of his devices; `public.indai_trade_devices` holds only its SHA-256. The first device to open the Trade page is approved; any later one waits until he approves it from an approved device. So a passcode guessed through any function still cannot place an order. If he loses every approved device (browser storage cleared), he runs `delete from public.indai_trade_devices;` in the SQL editor and the next device to open the page is the first again.

Shapes were read from his real account before writing the code (key names and order kinds only, no values): the account list, positions, sixty days of orders, an option's quote and its one-minute candles. Not yet seen from Schwab, because they need a real order: the answer to a buy with an attached stop (`TRIGGER`), to a replace, and to `previewOrder`. The page shows Schwab's own words when it refuses, and the first real order should be one contract. `supabase/checks/orders_test.ts` covers the rules; `deno run -A supabase/checks/orders-wiring.ts "$PWD/supabase/indai-orders/index.ts"` runs the real function against stand-ins and checks every call it makes.

Requests are counted in `indai_rate_events`: `orders` (reads, 1,500 an hour: the page asks for the book every few seconds while it is open) and `orders-send` (60 an hour). His Schwab app allows 20 orders a minute.

## The atlas (`mode:"atlas"`)

The Market Pattern Atlas's knowledge base is the owner's private data. It lives in one row of `public.indai_atlas` (key `kb`), readable only by the service role, and nowhere in the repository; `atlas/load/README.md` is how it gets there. `indai-brain` version 18 answers questions from it with no model call (`indai-brain/atlas.ts`): it reads the row once per cold start, builds the engine (`_shared/atlas/indai_atlas_engine.js`, a copy of `atlas/indai_atlas_engine.js` that a check keeps identical), and returns the engine's answer to one question at a time. The whole knowledge base is never returned.

Who is answered: the owner's passcode, or the owner's own sign-in. Any other signed-in account gets 403. Each request is counted in the `atlas` bucket of `indai_rate_events`, 600 an hour.

To check it on the hosted project: `GET indai-brain` lists `atlas` in `modes`; `POST {mode:"atlas",op:"lookup",rule:"hammer",trend:"below",vol:"high",horizon:5}` with the passcode returns `result.cell.later` of 0.573 against 0.543 on 1,101 cases with `cellGrade:"RED"`; the same request without the passcode returns 401. `503 atlas_unavailable` means the row is missing: `select version, pg_size_pretty(pg_column_size(value)::bigint) from public.indai_atlas`. After loading a new revision, the running instances keep the old one until they restart; redeploy the function, or wait for it to go cold.

A capture's scan is never refused for its size (version 22, live November 20 at 6:43 PM New York time, read back and identical). Until then a list of more than 40 patterns got `400`, and a box drawn over a few dozen candles easily holds more: the owner's capture at 6:26 PM that evening came back 400 and showed "The atlas lookup did not answer this time." Now up to 400 patterns are read, and of a longer list the newest 400, marked `truncated:true`. The website sends its newest 150.

In the function's log line an atlas request shows as mode `unknown`: the list of names the log knows is in `_shared/http.ts`, which all six functions bundle, and it was left alone so the other five still match the repository byte for byte. Every other accepted mode is in that list, so in the brain's log `unknown` means atlas. Add the name the next time `http.ts` changes and all six are deployed.

Checks: `supabase/checks/atlas_test.ts` uses a stand-in knowledge base with made-up numbers; run it with `ATLAS_KB=/path/atlas_kb.json` to also check the book's published example against the real file. The brain's bundle is now `indai-brain/index.ts`, `atlas.ts`, `history.ts`, `memory.ts`, `profile.ts`, `stream.ts`, `super.ts`, `_shared/http.ts`, `budget.ts`, `db.ts`, `auth.ts` and `_shared/atlas/indai_atlas_engine.js`, with `verify_jwt` off.

## Thinking an idea through, and asking without the app

`indai-brain` version 21, live November 20, 2026 at 5:30 PM New York time (read back, identical to the repository), with the table `public.indai_last_idea` (service role only; one row per account).

**The idea is kept.** Every `mode:"trade"` request from a known account writes that row before the research starts: the trader's words, the parsed idea, and the numbers the app sent as `context` (up to 24,000 characters). When the verdict comes back 200 it is added to the same row. A failed verdict leaves the row with the numbers and no verdict. The next idea replaces it.

**A question about it is reasoned.** In `talk`, the row is read alongside memory. `aboutIdea` (`indai-brain/idea.ts`) decides: within 30 minutes of the idea, or of the last question about it, every question counts; after that, for 8 hours, only one that names the idea's ticker or uses an idea word (strike, stop, target, break-even, what if, odds, size, exit, roll, calls, puts, green, amber, red and the like). Such a question goes to the verdict model (`claude-sonnet-5-5`) with 1,500 tokens and a system prompt that carries the idea, the numbers and her verdict, and tells her to answer first, do the arithmetic, say what would change her read, and never to tell him to buy or sell. Everything else keeps the quick model and 700 tokens, exactly as before. If the table cannot be read or written, verdicts and conversation carry on without it. To see it working: the answer carries `about:"idea"` and `model:"claude-sonnet-5-5"`; `select at, talked_at, question, verdict is not null as has_verdict from public.indai_last_idea` shows what she is holding.

**Asking with no app on screen.** A `talk` request that brings no `context` gets one from the server: what the clock says about the market (holidays are not known), and live prices for the tickers named in the question (company names such as Tesla are understood), the idea's ticker, and SPY, QQQ and IWM. The prices come from `indai-market`, asked with the caller's own passcode or sign-in, so the owner gets his Schwab quotes. With `format:"text"` the answer is her spoken words as plain text and nothing else, and she is told there is no screen. This is what a Siri shortcut calls:

1. Shortcuts app, new shortcut named **Ask INDAI**.
2. Action **Dictate Text**.
3. Action **Get Contents of URL**: URL `https://zptjziewsfuvfcogrikz.supabase.co/functions/v1/indai-brain`, method POST, one header `x-indai-pass` holding his passcode, request body JSON with `mode` = `talk`, `format` = `text`, `session` = `siri`, `question` = the Dictated Text.
4. Action **Speak Text** with the contents of the URL.

"Hey Siri, Ask INDAI" then runs it. For the phrase "Hey INDAI" without "Siri": Settings, Accessibility, Vocal Shortcuts, set up a phrase that runs the shortcut (iOS 18 or later). These steps were written from how Shortcuts works and have not been run on his phone; whether dictation runs while the phone is locked, and whether Vocal Shortcuts listens while locked, are reported both ways and are to be tested there. The passcode sits inside the shortcut on his phone. Anyone who can speak to the locked phone can ask her a question and hear the answer; nothing can be bought or sold through this door (orders are a different function and need an approved device).

Checks: `supabase/checks/idea_test.ts`, and `deno run -A supabase/checks/idea-wiring.ts "$PWD/supabase/indai-brain/index.ts"` runs the real function against stand-ins. Not yet seen with real requests: all of it. The brain's bundle is now thirteen files: the twelve listed under "The atlas" plus `indai-brain/idea.ts`.

## Her hosted voice (`indai-voice`)

The owner, November 20, 2026: "She sounds to robotic. And i can't even download the actual voice we had created", and, offered ElevenLabs or Cartesia, "The best vocal engine one". Version 1 went live that day at 5:49 PM New York time (read back, identical to the repository) with migration `20261120224738_indai_voice.sql`. Until he saves `ELEVENLABS_API_KEY` it answers `configured:false` and every device keeps the voice it had.

Why: the natural voice on the website and the Quest app is a model the device downloads (about 90 MB on a phone) and runs itself. An iPhone's browser is slow at that or fails, and the app then falls back to the phone's built-in voice. With `indai-voice` his devices send her words and get audio back, so nothing is downloaded and every device sounds the same.

How it is set up (`indai-voice/voice.ts`, checked against ElevenLabs' documentation on November 20, 2026): `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128` with the header `xi-api-key` and `{ text, model_id, previous_text?, next_text? }`; voices from `GET /v2/voices`. The model is `eleven_v4_turbo`, which ElevenLabs describes as its most expressive real-time model (`ELEVENLABS_MODEL` changes it). If ElevenLabs refuses the model for his account, the request is retried once with `eleven_flash_v2_5` and that is used for ten minutes; the answer's `x-indai-voice-model` header says which model spoke.

Her voice is one row in `public.indai_voice`. The first `status` after the key is saved picks a voice from his account (a woman's voice labelled for conversation if there is one) so she can speak at once; he changes it on `indai/voice.html`, which lists the voices in his ElevenLabs account, says a line in any of them, and stores his choice for every device. `ELEVENLABS_VOICE_ID` is used only when no choice is stored.

Cost and its limit: ElevenLabs' price list showed $0.04 per 1,000 characters for this model on November 20, about a cent for a spoken reply. Every `speak` request first takes its characters from the day's allowance (`indai_voice_take`, table `public.indai_voice_days`, New York day): 60,000 a day unless `INDAI_VOICE_DAILY_CHARS` says otherwise, about $2.40 at that price. Past it the answer is `429 voice_daily_limit` and the apps use the device's own voice. `select day, chars, requests from public.indai_voice_days order by day desc limit 7` shows what she has said.

The website's side (`indai/js/cloud-voice.js`) fetches a reply in pieces, the first sentence alone so that she starts quickly, and hands back to the device's own voice when the hosted one is not set up, takes more than nine seconds, is refused or is out of credit; it then leaves it alone for 2 minutes (a passing fault) or 30 (key, voice or credit), and Settings says why.

Seen working against ElevenLabs from November 20, 9:52 PM New York time, when he saved the key and chose "Lily - Velvety Actress" on the voice page: by 10:40 AM the next day, 45 `speak` requests (about 3,500 characters, roughly 14 cents at the listed price), all answered 200. Not yet known: which model spoke (the `x-indai-voice-model` header is not logged), and how quickly a first sentence starts on his phone. The checks (`supabase/checks/voice_test.ts`; `deno run -A supabase/checks/voice-wiring.ts "$PWD/supabase/indai-voice/index.ts"`; the website's `voice-test.js`) use stand-ins. The first things to look at once the key is in: `status` on the voice page (does it name a voice), the function's log lines for `indai-voice` (a `502` or `409` there is ElevenLabs refusing something: the message returned to the page carries ElevenLabs' own status word), which model the `x-indai-voice-model` header names, and how long a first sentence takes to start on his phone. Not built: her voice for the Siri shortcut (it is read by Siri's voice), and the Quest app's use of this door (Papilo).

## When CBOE refuses the backend

On November 19 from about 17:25 ET, CBOE answered every request from the functions with 403 (quotes, intraday candles and option chains alike). `indai-market` version 10 keeps the apps supplied with prices and candles from the TradingView bridge in that case: when the CBOE request for a ticker fails, `snapshot` and `bars` answer that ticker from `indai_tv_bars` (`indai-market/bridge.ts`), marked `source: "TradingView bridge"`, `delay: 0`. While CBOE answers, nothing changes. During regular trading a bridge quote is only given if the newest stored candle is at most ten minutes old, so an old candle is never shown as the current price; outside regular trading the last stored candle is given with its own timestamp. Tickers the bridge does not send, and all option chains, still fail as before.

**It is a block, not a nightly window.** Checked on November 20 at 9:02 ET: still refused. The last option-chain request CBOE answered was at 17:17 ET on November 19; every one since 17:25 ET has failed, through the night and the pre-market, more than fifteen hours. The night before, the functions' requests were answered between 1:00 and 7:00 ET, and on November 19 chains were answered from 9:05 ET, so the hour of day does not explain it. At 9:02 ET `snapshot` answered SPY, MSFT and IWM from the bridge and gave AAPL and SPX `CBOE 403`; `chain` answered 502, and again at 9:48 ET. It is the functions' addresses that are refused, not an outage at CBOE: at 8:47 ET the same morning the owner's "Morning GEX refresh" task read every chain from CBOE through his own browser. Treat CBOE as gone for the functions until a request succeeds: a replacement option-data source is job 4 in `handoff/PERPLEXITY-BRIEF.md`. We do not change the functions' headers or addresses to get around the refusal.

**GEX levels still arrive while the block lasts, by the other road.** Two of the owner's scheduled tasks sit outside this back end: "Morning GEX refresh" (8:45 ET, his browser) computes the levels, and "INDAI GEX sync" (9:14 ET) copies them into `indai_gex_levels`. On November 20 the back end's own refresh failed on every chain request (29 failed batches from 9:14 to 9:20 ET, and the 9:20 watchdog recorded "112 tickers still lack current levels"), and five seconds later the sync wrote all 224 rows, as of 8:47 ET. So on such a day `kind=health` shows `gex` as failed while the table is complete: `select count(*) from public.indai_gex_missing(current_date)` returning 0 is the truth about coverage. What is missing during the block is the live recalculation from the chain, every option chain, and prices for tickers the bridge does not send. An earlier version of this section said the levels would stay a day old; that was wrong.

**The servers stop asking while they are refused** (`indai-market` version 16, `indai-market/gate.ts`). Until then every request from the apps tried CBOE again: about 16,000 refused requests between the evening of November 19 and the afternoon of November 20. Now the first 403 (or 429) writes a row in `public.indai_feed_gate` (`name = 'cboe'`, with `until`), and until that time no instance sends CBOE anything: quotes and candles go straight to the bridge, and `chain`, `quote` and `daily` fail at once, with the same error text as before. When the pause ends, one request per instance tries the door. An answer deletes the row and everything flows again; another refusal doubles the pause: five minutes, ten, twenty, forty, then an hour at a time. An instance lives about a minute, which is why the memory is a table and not a variable. If the table cannot be read, requests go out as if there were no pause.

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
- A failed research step or second opinion never fails the answer: Claude then searches as before. The answer's `brains` list says who did what, and the function logs one line per answer that involved more than Claude or in which a brain failed (`"brains":[…]`, with the provider's error type in `detail`). When Claude's reply is incomplete the step carries `stop` (why the model stopped; `max_tokens` means it was cut off at the reply limit) and `out` (tokens written). The words of the question and the answer are never logged.
- A researched reply may be 6,000 tokens long (`RESEARCH_REPLY_TOKENS`, version 19, live November 20 at 4:24 PM New York time). At 2,500, every verdict between the afternoons of November 19 and 20 was cut off before its JSON was complete. To see how verdicts are doing: in the function's logs, lines with `"mode":"trade"` give the status and the time taken; a `502` with a `"brains"` line beside it says why.
- A spent daily budget or a refused request is final. ChatGPT stands in for an outage or a cut-off reply, never around the budget.
- Every outside call reserves and settles tokens in the same daily budget as Claude (`INDAI_DAILY_TOKEN_BUDGET`).
- Perplexity is sent the question, the parsed idea, the ticker and the headlines on screen. ChatGPT is sent the context Claude gets. Neither is sent the trader's name.
- Conversation (`talk`) is unchanged: Claude alone, with its own web search.
- Requests to Perplexity are spaced a little over a second apart, because its smallest usage tier takes one request a second.

Checked against Perplexity's documentation on November 20, 2026: the Sonar chat-completions API ended on September 27, 2026 and the Agent API (`POST https://api.perplexity.ai/v1/agent`, the same shape as OpenAI's `POST /v1/responses`) replaces it; its catalog includes OpenAI, Anthropic and Google models; API credits are bought in advance at console.perplexity.ai and are separate from a Pro or Max subscription.

The owner saved `PERPLEXITY_API_KEY` on November 20 between 4:25 and 5:30 PM New York time: `GET indai-brain` showed `perplexity:true, chatgpt:true` at 5:31 PM. Not yet run against the real providers: no researched answer has been asked for since, so the provider calls have run only against stand-ins (`supabase/checks/super_test.ts`, 16 tests). After the owner saves a key, read the first researched answer's `brains`, or the log line, before trusting it. If Perplexity refuses the research request's shape, the function already retries in the plain form (`model: "perplexity/sonar"` with the `web_search` tool).

## Owner-controlled configuration

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Active for talk and trade. |
| `PERPLEXITY_API_KEY` | Optional. Switches on Perplexity's research for `trade` and `chat`, and ChatGPT's second opinion through the same key. Created at console.perplexity.ai; needs API credits, which a Pro or Max subscription does not include. |
| `OPENAI_API_KEY` | Optional. Sends ChatGPT's part straight to OpenAI instead of through Perplexity. A ChatGPT subscription does not include API use. |
| `INDAI_SECOND_OPINION=off` | Optional. Keeps the research and the stand-in but skips the second read of every idea. |
| `INDAI_SECOND_MODEL` | Optional. The model for ChatGPT's part, default `gpt-6.1-sol`. |
| `INDAI_RESEARCH_EFFORT`, `INDAI_RESEARCH_EFFORT_DEEP` | Optional. Perplexity's effort level for a fast idea (default `fast`) and a deep one (default `low`). |
| `ELEVENLABS_API_KEY` | Optional. Switches on INDAI's hosted voice (`indai-voice`). Created at elevenlabs.io on a paid plan; the key needs Text to Speech and read access to Voices. |
| `ELEVENLABS_MODEL`, `ELEVENLABS_VOICE_ID`, `INDAI_VOICE_DAILY_CHARS` | Optional. The voice model (default `eleven_v4_turbo`), a voice to use when none has been chosen on the voice page, and the most characters she may speak in a New York day (default 60,000). |
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
