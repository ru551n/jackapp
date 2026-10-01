#!/usr/bin/env bash
# Docker smoke test: builds the image, starts db/migrate/app/worker plus a mock OpenAI-compatible AI
# (compose.smoke.yaml), then drives the API with curl: PIN, learner, image upload, strict practice
# test, approval, a learner run answer, and worker health. Always tears down with `down -v`.
#   npm run smoke:docker        (SMOKE_PORT=3399 by default)
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=jackapp-smoke-test
PORT=${SMOKE_PORT:-3399}
BASE="http://localhost:$PORT"
API="$BASE/api/v1"
TMP=$(mktemp -d)
export SMOKE_ENV_FILE="$TMP/.env" SMOKE_PORT=$PORT
DC=(docker compose -p "$PROJECT" -f compose.yaml -f compose.smoke.yaml --env-file "$SMOKE_ENV_FILE")
JAR="$TMP/cookies"

cleanup() {
  local status=$?
  if [ $status -ne 0 ]; then
    echo "smoke: FAILED (exit $status); service logs:" >&2
    "${DC[@]}" ps -a >&2 || true
    "${DC[@]}" logs --no-color --tail 200 >&2 || true
  fi
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TMP"
  exit $status
}
trap cleanup EXIT

cat >"$SMOKE_ENV_FILE" <<EOF
PUBLIC_URL=$BASE
APP_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
LOG_LEVEL=warn
JACKAPP_SKIP_SPEECH=1
ALLOW_LOCAL_AI=true
AI_TEXT_PROVIDER=openai-compatible
AI_TEXT_BASE_URL=http://mockai:8080/v1
AI_TEXT_MODEL=mock
AI_VISION_PROVIDER=openai-compatible
AI_VISION_BASE_URL=http://mockai:8080/v1
AI_VISION_MODEL=mock
EOF

step() { echo "smoke: $*"; }
fail() {
  echo "smoke: $*" >&2
  exit 1
}
# curl as the browser would: same Origin, cookie jar (adult gate), JSON in and out.
api() {
  local method=$1 path=$2
  shift 2
  curl -sS --fail-with-body -X "$method" -b "$JAR" -c "$JAR" -H "Origin: $BASE" "$@" "$API$path"
}
json() { api "$1" "$2" -H 'content-type: application/json' --data "$3"; }
# Polls a job until it ends; prints the final status, fails unless completed.
wait_job() {
  local s state
  for _ in $(seq 1 120); do
    s=$(api GET "/jobs/$1")
    state=$(jq -r .state <<<"$s")
    case $state in
      completed) echo "$s" && return 0 ;;
      failed | cancelled) fail "job $1 $state: $s" ;;
    esac
    sleep 1
  done
  fail "job $1 timed out: $s"
}

step "building and starting (project $PROJECT)"
"${DC[@]}" up -d --build --wait --wait-timeout 300

step "ready: $(curl -sS "$BASE/ready" | jq -c '{ready, checks: [.checks[] | {name, ok}]}')"
curl -sS --fail "$BASE/" | grep -q 'id="root"' || fail 'web app not served at /'

step '1. PIN and learner'
json POST /gate/pin '{"pin":"2468"}' | jq -e '.pinSet and .adult' >/dev/null
LEARNER=$(json POST /learners '{"displayName":"Smoke","school":{"stage":"grundskola","year":5},"interests":["tåg"]}' | jq -r .id)
step "   learner $LEARNER"

step '2. upload an image and process it'
node -e "require('sharp')({create:{width:320,height:240,channels:3,background:'#cfe8ff'}}).png().toFile('$TMP/page.png')"
UP=$(api POST "/learners/$LEARNER/study-sets" -F title=Smoke -F "files=@$TMP/page.png;type=image/png")
SET=$(jq -r .set.id <<<"$UP")
wait_job "$(jq -r .jobId <<<"$UP")" >/dev/null
api GET "/learners/$LEARNER/study-sets/$SET" | jq -e '.set.status == "ready"' >/dev/null ||
  fail "study set $SET not ready"

step '3. strict practice test'
GEN=$(json POST "/learners/$LEARNER/generate" \
  "{\"type\":\"practiceTest\",\"studySetId\":\"$SET\",\"sourceMode\":\"strict\",\"questionCount\":3}")
ARTIFACT=$(wait_job "$(jq -r .jobId <<<"$GEN")" | jq -r .resultId)
APPROVAL=$(api GET "/artifacts/$ARTIFACT" | jq -r .artifact.approval)
step "   artifact $ARTIFACT ($APPROVAL)"

step '4. approve if pending'
if [ "$APPROVAL" = pendingApproval ]; then json POST "/artifacts/$ARTIFACT/approve" '{}' >/dev/null; fi
api GET "/artifacts/$ARTIFACT" | jq -e '.artifact.approval == "approved"' >/dev/null || fail 'not approved'

step '5. learner run (no adult cookie) and one answer'
rm -f "$JAR"
RUN=$(json POST "/learners/$LEARNER/runs" "{\"artifactId\":\"$ARTIFACT\"}")
RUN_ID=$(jq -r .id <<<"$RUN")
ITEM=$(jq -c '.items[0]' <<<"$RUN")
ANSWER=$(jq -c 'if .kind == "trueFalse" then true elif .choices then .choices[0].id
  elif .kind == "numeric" then 1 else "svar" end' <<<"$ITEM")
json POST "/learners/$LEARNER/runs/$RUN_ID/answers" \
  "{\"itemId\":$(jq -c .id <<<"$ITEM"),\"attempt\":1,\"answer\":$ANSWER}" | jq -e 'has("correct")' >/dev/null
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH -H "Origin: $BASE" -H 'content-type: application/json' \
  --data '{}' "$API/learners/$LEARNER")
[ "$CODE" = 403 ] || fail "adult route without the gate answered $CODE"

step '6. worker healthy'
WORKER=$("${DC[@]}" ps -q worker)
[ "$(docker inspect -f '{{.State.Health.Status}}' "$WORKER")" = healthy ] || fail 'worker not healthy'

step 'OK'
