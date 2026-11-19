# INDAI backend release

This release targets the existing INDAI project `zptjziewsfuvfcogrikz`. Its SQL upgrades the deployed TradingView, GEX and memory tables. A new empty database needs the original TradingView tables first. Apply the ticket migrations in filename order and deploy the six functions from the same reviewed revision.

## Hosted rollout on November 19, 2026

All six functions are deployed to `zptjziewsfuvfcogrikz`. The public headset key receives stateless talk and streamed speech. A signed-out request for saved history requires the existing owner passcode or a verified account. The live no-search probe returned spoken text in 1.47 seconds, and the live trade returned all eleven verdict fields. The hosted isolation, profile-merge and rate-limit checks used synthetic data inside a rolled-back transaction.

The GEX table contains both scopes for 112 tickers. The 09:20 watchdog recorded 110 tickers still missing current levels. All 224 rows were current at 09:20:45 ET. After correcting the CBOE envelope's UTC timestamp, the worker verified 14 batches covering all 112 tickers. `kind=health` distinguishes the deadline result (`gex`) from the later completeness check (`gex-coverage`).

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

## Owner-controlled configuration

| Setting | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Active for talk and trade. |
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

For recovery, keep the previous function revisions available in the dashboard. Restore a compatible function set alongside its database permissions. Reverting to an unscoped legacy brain after accounts have saved private data would expose those accounts. The migrations include owner linkage, retention and compaction. An operations rollback that needs removed records requires a database backup.
