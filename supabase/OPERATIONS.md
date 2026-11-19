# INDAI backend release

This release targets the existing INDAI project `zptjziewsfuvfcogrikz`. Its SQL upgrades the deployed TradingView, GEX and memory tables. A new empty database needs the original TradingView tables first. Apply the ticket migrations in filename order and deploy the six functions from the same reviewed revision.

## Hosted state recorded November 19

The public brain status returned `configured:true`, `passcode:false` and `memory:true`. A live no-search request returned spoken text in 6.26 seconds. A separate live trade request returned all eleven verdict fields. The hosted streaming probe still returned a regular JSON reply. The public GEX table had 224 rows covering both scopes for 112 tickers, all dated November 16. The hosted job health route had yet to deploy.

## Deploy to the project

Use an authenticated Supabase CLI 3.x session from the repository root. In the dashboard, review the active database backup, migration history and existing GEX jobs. If a previous refresh still writes the same rows, coordinate its retirement when the new job has completed its first full run. The dry run below lists exactly which migrations the CLI would apply.

```bash
project=zptjziewsfuvfcogrikz
supabase migration list --remote="$project"
supabase db push --remote="$project" --dry-run
```

In **Edge Functions → Secrets**, configure the values required for the features being enabled. Keep provider credentials, VAPID material and the owner passcode outside source control.

| Setting | When it is needed |
|---|---|
| `ANTHROPIC_API_KEY` | Talk, researched trade and semantic memory consolidation. The most recent hosted check found the key configured. |
| `INDAI_PASSCODE` | Continuity for the original signed-out headset. Before deploying accounts, set a strong owner passcode and enter it in the existing headset settings while private history and memory are in use. An authenticated user uses their own data regardless of this setting. |
| `INDAI_DAILY_TOKEN_BUDGET` | Optional daily model allowance. The default is 250,000 tokens per New York calendar day. Conservative in-flight reservations can cause an earlier 429. |
| `INDAI_STT_PROVIDER=deepgram`, `DEEPGRAM_API_KEY` | Enable only with the owner's selected speech account. Without these, the optional transcription route returns 503. |
| `INDAI_MARKET_PROVIDER=massive`, `MASSIVE_API_KEY` | Enable after the owner selects and licenses the relevant real-time equities and options data. The owner account is eligible by default. `INDAI_MARKET_LICENSED_USERS` accepts additional licensed user UUIDs separated by commas. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push. Use a stable P-256 VAPID pair and a valid contact URI. Only the public key is exposed to subscribing clients. |

The magic-link redirect must be registered under **Authentication → URL Configuration** for the actual website or app landing page. Email confirmations should be enabled. Confirm that the owner receives a real email before directing other users to sign in.

```bash
supabase db push --remote="$project" --yes
set -e
for name in indai-jobs indai-brain indai-market indai-tv indai-ears indai-push; do
  supabase functions deploy "$name" --remote="$project" --yes
done
```

Confirm every function deployed successfully. Then enable the scheduler destination. Vault already holds the generated job token. Adding the optional `indai_alert_url` HTTPS secret in Vault connects failed jobs to the owner's operations endpoint. PostgreSQL also emits a warning and notifies the `indai_job_failures` channel.

```bash
supabase db query --remote="$project" --file supabase/checks/schedule-target.sql
supabase db advisors --remote="$project" --type all --level warn --fail-on error
```

After the owner has completed the email magic link, use **Authentication → Users** to identify the verified owner UUID. In the SQL Editor run `select public.indai_link_owner('<verified-owner-uuid>'::uuid)`. This transfers the original saved rows and subscriptions to that account. The first person to sign up receives an ordinary empty account. Confirm the owner's saved memory from a signed-in client and a passcode-enabled headset.

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

For recovery, keep the previous function revisions available in the dashboard. Restore a compatible function set alongside its database permissions. Reverting to an unscoped legacy brain after accounts have saved private data would expose those accounts. The migrations include owner linkage, retention and compaction. An operations rollback that needs removed records requires a database backup.
