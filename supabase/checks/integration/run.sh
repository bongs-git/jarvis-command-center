#!/usr/bin/env bash
set -eu
set -o pipefail
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/../../.."
pgbin=${PGBIN:-$(pg_config --bindir)}
rest=${POSTGREST_BIN:-postgrest}
auth=${GOTRUE_BIN:-auth}
deno=${DENO_BIN:-deno}
: "${GOTRUE_DB_MIGRATIONS_PATH:?Set this to the Supabase Auth binary release migrations directory}"
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1
export GOTRUE_SMTP_MAX_FREQUENCY=1s GOTRUE_RATE_LIMIT_EMAIL_SENT=50
umask 077
tmp=$(mktemp -d)
export LAB_DIR="$tmp"
# Refuse to start when another local service holds one of the five test ports.
node --input-type=module - <<'NODE'
import {createServer} from "node:net";
const servers=[];
try {
  for(let port=55432;port<=55436;port++){
    const server=createServer();await new Promise((ok,fail)=>server.once("error",fail).listen(port,"127.0.0.1",ok));servers.push(server);
  }
} finally {for(const server of servers)server.close();}
NODE
"$pgbin/initdb" -D "$tmp/db" -U postgres -A trust --no-locale --encoding UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$tmp/db" -l "$tmp/pg.log" -o "-h 127.0.0.1 -p 55432 -k ''" -w start >/dev/null
finish() {
  status=$?
  for pid in ${restpid:-} ${authpid:-} ${fnspid:-} ${smtppid:-}; do kill "$pid" 2>/dev/null || true; done
  "$pgbin/pg_ctl" -D "$tmp/db" -m fast -w stop >/dev/null || true
  echo "Local fixture results and logs: $tmp"
  exit "$status"
}
trap finish EXIT
node "$here/migrate.mjs"
export LOCAL_JWT_SECRET="indai-local-integration-fixture-only-three-roles"
export PGRST_DB_URI='postgresql://authenticator:local-dev-only@127.0.0.1:55432/indai' PGRST_DB_ANON_ROLE=anon PGRST_DB_SCHEMAS=public PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT=55433 PGRST_JWT_SECRET="$LOCAL_JWT_SECRET"
"$rest" +RTS -N1 -RTS >"$tmp/rest.log" 2>&1 &
restpid=$!
export API_EXTERNAL_URL=http://127.0.0.1:55435/auth/v1 GOTRUE_API_HOST=127.0.0.1 GOTRUE_API_PORT=55434 GOTRUE_SITE_URL=http://localhost:55435 GOTRUE_DB_DRIVER=postgres GOTRUE_DB_DATABASE_URL='postgresql://postgres:local-dev-only@127.0.0.1:55432/indai?search_path=auth' GOTRUE_DB_NAMESPACE=auth
export GOTRUE_JWT_SECRET="$LOCAL_JWT_SECRET" GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false
export GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=55436 GOTRUE_SMTP_ADMIN_EMAIL=indai@local.test GOTRUE_SMTP_SENDER_NAME=INDAI
export GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify GOTRUE_MAILER_URLPATHS_MAGIC_LINK=/auth/v1/verify GOTRUE_DISABLE_SIGNUP=false
"$auth" migrate >"$tmp/auth-migration.log" 2>&1 || { tail -c 1000 "$tmp/auth-migration.log"; exit 1; }
"$auth" serve >"$tmp/auth.log" 2>&1 &
authpid=$!
export LAB_DIR="$tmp"
node "$here/tokens.mjs"
set -a
source "$tmp/credentials"
set +a
export SUPABASE_URL=http://127.0.0.1:55435 ANTHROPIC_API_KEY=fixture-only DEEPGRAM_API_KEY=fixture-only MASSIVE_API_KEY=fixture-only INDAI_STT_PROVIDER=deepgram INDAI_MARKET_PROVIDER=massive INDAI_PASSCODE=fixture-only
export VAPID_SUBJECT=mailto:indai@local.test
node "$here/smtp.mjs" >"$tmp/smtp.log" 2>&1 &
smtppid=$!
"$deno" run -A --node-modules-dir="${DENO_NODE_MODULES_MODE:-auto}" --no-lock "$here/edge.ts" >"$tmp/edge.log" 2>&1 &
fnspid=$!
for i in $(seq 1 35); do
 if curl --noproxy '*' -sSf http://127.0.0.1:55435/functions/v1/indai-brain >/dev/null 2>&1 && curl --noproxy '*' -sSf http://127.0.0.1:55434/health >/dev/null 2>&1; then break; fi
 sleep .25
done
if ! curl --noproxy '*' -sSf http://127.0.0.1:55434/health >/dev/null; then tail -c 1200 "$tmp/auth.log"; exit 1; fi
node "$here/signal-golden.mjs"
node "$here/integration.mjs"
if [[ -n ${SPLINTER_SQL:-} ]]; then node "$here/advisors.mjs"; fi
