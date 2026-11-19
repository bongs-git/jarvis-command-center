#!/usr/bin/env bash
# Uses only the public project key and, if configured, the owner's app passcode.
set -euo pipefail
: "${BASE:?Set BASE to the Supabase project URL}"
: "${ANON_KEY:?Set ANON_KEY to the public project key}"
headers=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer ${USER_JWT:-$ANON_KEY}")
if [[ -n ${INDAI_PASSCODE:-} ]]; then headers+=(-H "x-indai-pass: $INDAI_PASSCODE"); fi
url="${BASE%/}/functions/v1/indai-brain"
status=$(curl -fsS --max-time 10 "${headers[@]}" "$url")
jq -ce '{configured,passcode,memory}' <<<"$status"
jq -e '.configured == true' <<<"$status" >/dev/null || { echo 'Brain key is missing.' >&2; exit 1; }
reply=$(mktemp)
trap 'rm -f "$reply"' EXIT
elapsed=$(curl -fsS --max-time 20 "${headers[@]}" -H 'content-type: application/json' -o "$reply" -w '%{time_total}' \
  --data '{"mode":"talk","name":"Bongs","question":"Say good morning in one short sentence.","history":[],"context":{},"search":false,"session":"acceptance"}' "$url")
jq -e '(.result.spoken | type == "string" and length > 0) and (.sources | length == 0)' "$reply" >/dev/null
echo "Talk returned spoken text in ${elapsed}s."
awk -v t="$elapsed" 'BEGIN {exit !(t < 3)}'
