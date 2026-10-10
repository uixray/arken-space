#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SCRIPT="$ROOT/infra/backup/capture-service-snapshot.sh"
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/app/infra/backup" "$TMP/repo"
REAL_NODE=$(command -v node)
cat > "$TMP/bin/node" <<'NODE_WRAPPER'
#!/usr/bin/env bash
set -eu
args=()
for arg in "$@"; do
  if [[ $arg == /tmp/* ]]; then arg=$(cygpath -m "$arg"); fi
  args+=("$arg")
done
exec "$TEST_REAL_NODE" "${args[@]}"
NODE_WRAPPER
cp "$ROOT/infra/backup/database-counts.sql" "$TMP/app/infra/backup/"
printf 'synthetic compose\n' > "$TMP/app/compose.template.yml"
printf 'PRIVATE_TEST_SENTINEL=do-not-print\n' > "$TMP/app/runtime.env"
chmod 600 "$TMP/app/runtime.env"
printf 'SERVER_SECRET_SENTINEL=must-stay-encrypted\n' > "$TMP/app/server-runtime.env"
chmod 600 "$TMP/app/server-runtime.env"
printf 'synthetic config\n' > "$TMP/app/compose.activation.override.yml"
printf 'synthetic extra config' > "$TMP/app/extra.conf"
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "docker $*" >> "$TEST_LOG"
if [[ ${1:-} == inspect && ${2:-} != --format ]]; then
if [[ ${ARKEN_CAPTURE_MODE:-compose} == compose ]]; then
cat <<JSON
[
 {"Id":"server-id","Image":"sha256:server","State":{"Status":"running"},"Name":"/server","Config":{"Env":["DATABASE_URL=$TEST_COMPOSE_API_DB_URL"]},"NetworkSettings":{"Networks":{"app":{"NetworkID":"$TEST_COMPOSE_NETWORK","Aliases":["server"]}}},"Mounts":[]},
 {"Id":"pg-id","Image":"sha256:postgres","State":{"Status":"running"},"Name":"/postgres","Config":{"Env":["POSTGRES_DB=$TEST_COMPOSE_PG_DB","POSTGRES_USER=postgres"]},"NetworkSettings":{"Networks":{"app":{"NetworkID":"$TEST_COMPOSE_NETWORK","Aliases":["postgres","pg"]}}},"Mounts":[]}
]
JSON
else
cat <<JSON
[
 {"Id":"$TEST_REVIEW_API_ID","Image":"$TEST_REVIEW_API_IMAGE","State":{"Status":"running"},"Name":"/review-api","Config":{"Env":["DATABASE_URL=postgres://review_user:REVIEW_SECRET_SENTINEL@pg-review/reviewdb"]},"NetworkSettings":{"Networks":{"review":{"NetworkID":"$TEST_REVIEW_NETWORK","Aliases":["review-api"]}}},"Mounts":[{"Type":"bind","Source":"$TEST_REVIEW_MEDIA_SOURCE","Destination":"/app/media"}]},
 {"Id":"$TEST_REVIEW_PG_ID","Image":"$TEST_REVIEW_PG_IMAGE","State":{"Status":"running"},"Name":"/pg-review","Config":{"Env":["POSTGRES_DB=reviewdb","POSTGRES_USER=postgres"]},"NetworkSettings":{"Networks":{"review":{"NetworkID":"$TEST_REVIEW_NETWORK","Aliases":["pg-review"]}}},"Mounts":[]},
 {"Id":"$TEST_REVIEW_WEB_ID","Image":"$TEST_REVIEW_WEB_IMAGE","State":{"Status":"running"},"Name":"/review-web","Config":{"Env":[]},"NetworkSettings":{"Networks":{"review":{"NetworkID":"$TEST_REVIEW_NETWORK","Aliases":["review-web"]}}},"Mounts":[]},
 {"Id":"$TEST_REVIEW_EDGE_ID","Image":"$TEST_REVIEW_EDGE_IMAGE","State":{"Status":"running"},"Name":"/review-edge","Config":{"Env":[]},"NetworkSettings":{"Networks":{"review":{"NetworkID":"$TEST_REVIEW_NETWORK","Aliases":["review-edge"]},"loopback":{"NetworkID":"$TEST_REVIEW_EDGE_EXTRA_NETWORK","Aliases":["review-loopback"]}}},"Mounts":[{"Type":"bind","Source":"$TEST_REVIEW_EDGE_SOURCE","Destination":"/etc/nginx/conf.d/default.conf"}]}
]
JSON
fi
exit 0
fi
case "$*" in
  *' ps -q server'*) printf 'server-id\n' ;;
  *' ps -q postgres'*) printf 'pg-id\n' ;;
  *' ps -q web'*) printf 'web-id\n' ;;
  *' config --format json --no-env-resolution'*) printf '{"services":{"server":{"env_file":[{"path":"%s"}]}}}\n' "$TEST_RUNTIME_ENV" ;;
  *'inspect --format'*) [[ $* == *server-id* ]] && printf 'sha256:server\n' || { [[ $* == *pg-id* ]] && printf 'sha256:postgres\n' || printf 'sha256:web\n'; } ;;
  *' node -e '*healthz*) printf '{"buildRevision":"synthetic-rev","schemaVersion":"schema-test"}\n' ;;
  *'save --output '* ) [[ ${FAKE_FAIL_SAVE:-0} != 1 ]] || exit 7; out=${*: -2:1}; : > "$out" ;;
  *' pg_dump '* ) printf 'synthetic-db-dump' ;;
  *' SHOW server_version'*) printf '16.4\n' ;;
  *' SELECT id::bigint, hash, created_at::bigint'*) printf '1|synthetic-migration-hash|12345\n' ;;
  *' psql '* ) cat >/dev/null; printf 'assets|1\n' ;;
  'cp '* ) dest=${*: -1}; mkdir -p "$dest"; printf 'synthetic-media' > "$dest/file.bin" ;;
  *' stop server'*)
    work=$(find "$TEST_CAPTURE_TMPDIR" -maxdepth 1 -type d -name 'arken-service-capture.*' | head -n1)
    test -f "$work/config/runtime.env" && test -f "$work/config/server-runtime.env" && test -f "$work/config/compose.yml" && test -f "$work/config/compose-rendered.private.json" && test -f "$work/config/extra-extra.conf"
    ;;
  *' start server'*) ;;
  stop\ *) ;;
  start\ *) ;;
  *) printf 'unexpected synthetic docker argv: %s\n' "$*" >&2; exit 9 ;;
esac
DOCKER
cat > "$TMP/bin/restic" <<'RESTIC'
#!/usr/bin/env bash
set -eu
printf '%s\n' "restic $*" >> "$TEST_LOG"
case "$1" in
 snapshots) if [[ -f $TEST_LOG.snapshot ]]; then printf '[{"id":"snapshot-test"}]\n'; else printf '[]\n'; fi;;
 backup)
   root=$2
   test -f "$root/config/runtime.env"
   test "$(stat -c '%a' "$root")" = 700
   test -f "$root/database.dump" && test -f "$root/database-counts.txt" && test -f "$root/postgres-version.txt" && test -f "$root/migration-ledger.txt" && test -f "$root/media/file.bin" && test -f "$root/images/server.tar"
   if [[ ${ARKEN_CAPTURE_MODE:-compose} == cloned-review ]]; then
     test -f "$root/images/postgres.tar" && test -f "$root/images/web.tar" && test -f "$root/images/edge.tar" && test -f "$root/config/edge-nginx.conf"
     grep -q 'REVIEW_SECRET_SENTINEL' "$root/config/runtime.env"
     node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(m.captureMode!=="cloned-review"||m.target.databaseName!=="reviewdb"||m.images.edge!==process.argv[2]||!m.files.some(f=>f.path==="images/edge.tar"))process.exit(1)' "$root/capture-manifest.json" "$TEST_REVIEW_EDGE_IMAGE"
   else
     grep -q 'PRIVATE_TEST_SENTINEL=do-not-print' "$root/config/runtime.env"
     grep -q 'SERVER_SECRET_SENTINEL=must-stay-encrypted' "$root/config/server-runtime.env"
     test -f "$root/config/compose-rendered.private.json"
   fi
   : > "$TEST_LOG.snapshot"
   ;;
 *) echo 'unexpected fake restic invocation' >&2; exit 8;;
esac
RESTIC
chmod +x "$TMP/bin/docker" "$TMP/bin/restic" "$TMP/bin/node"
export PATH="$TMP/bin:$PATH" TEST_REAL_NODE="$REAL_NODE" TEST_LOG="$TMP/commands.log" RESTIC_REPOSITORY="$TMP/repo" TEST_RUNTIME_ENV="$TMP/app/server-runtime.env"
export ARKEN_APP_ROOT="$TMP/app" ARKEN_COMPOSE_FILE="$TMP/app/compose.template.yml"
export ARKEN_RUNTIME_ENV_FILE="$TMP/app/runtime.env" ARKEN_BACKUP_ROOT="$TMP/out"
export TEST_COMPOSE_API_DB_URL=postgres://api_user:PRIVATE@postgres/arken_db TEST_COMPOSE_PG_DB=arken_db TEST_COMPOSE_NETWORK=compose-network
export ARKEN_CAPTURE_TMPDIR="$TMP" TEST_CAPTURE_TMPDIR="$TMP" ARKEN_CAPTURE_CONFIG_FILES="$TMP/app/extra.conf" ARKEN_CAPTURE_RECEIPT="$TMP/out/receipt.json"
export ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server
# A compose API URL pointing at a different database is refused before downtime.
export TEST_LOG="$TMP/compose-db-mismatch.log" ARKEN_CAPTURE_RECEIPT="$TMP/out/db-mismatch.json" TEST_COMPOSE_API_DB_URL=postgres://api_user:PRIVATE@postgres/wrong_db
if bash "$SCRIPT" > "$TMP/compose-db-mismatch-output.log" 2>&1; then echo 'expected compose database mismatch refusal' >&2; exit 1; fi
! grep -q 'stop server' "$TMP/compose-db-mismatch.log"
test ! -e "$TMP/out/db-mismatch.json"
! grep -q 'PRIVATE\|api_user' "$TMP/compose-db-mismatch-output.log"
# A URL whose host is not a PG alias on a shared network is also refused before downtime.
export TEST_LOG="$TMP/compose-host-mismatch.log" ARKEN_CAPTURE_RECEIPT="$TMP/out/host-mismatch.json" TEST_COMPOSE_API_DB_URL=postgres://api_user:PRIVATE@wrong-host/arken_db
if bash "$SCRIPT" > "$TMP/compose-host-mismatch-output.log" 2>&1; then echo 'expected compose host mismatch refusal' >&2; exit 1; fi
! grep -q 'stop server' "$TMP/compose-host-mismatch.log"
test ! -e "$TMP/out/host-mismatch.json"
! grep -q 'PRIVATE\|api_user' "$TMP/compose-host-mismatch-output.log"
export TEST_LOG="$TMP/commands.log" ARKEN_CAPTURE_RECEIPT="$TMP/out/receipt.json" TEST_COMPOSE_API_DB_URL=postgres://api_user:PRIVATE@postgres/arken_db
bash "$SCRIPT" > "$TMP/output.log"
test -s "$TMP/out/receipt.json"
! grep -q 'PRIVATE_TEST_SENTINEL' "$TMP/output.log"
! grep -Eiq 'forget|prune|rm -rf|delete' "$TMP/commands.log"
! find "$TMP" -maxdepth 1 -type d -name 'arken-service-capture.*' | grep -q .
grep -q 'stop server' "$TMP/commands.log"
grep -q 'pg_dump.*arken_db' "$TMP/commands.log"
grep -q 'psql.*arken_db' "$TMP/commands.log"
grep -q 'SHOW server_version.*arken_db' "$TMP/commands.log"
grep -q 'start server' "$TMP/commands.log"
start_line=$(grep -n 'docker .* start server' "$TMP/commands.log" | head -n1 | cut -d: -f1)
backup_line=$(grep -n '^restic backup ' "$TMP/commands.log" | head -n1 | cut -d: -f1)
test "$start_line" -lt "$backup_line"
node -e 'const r=require(process.argv[1]); if(r.schemaVersion!=="schema-test" || r.buildRevision!=="synthetic-rev" || !r.snapshotId) process.exit(1)' "$TMP/out/receipt.json"

# Fail after API stop, before staging completes: trap must restart, remove private
# stage, preserve failure and never emit a receipt.
export TEST_LOG="$TMP/failure.log" ARKEN_CAPTURE_RECEIPT="$TMP/out/failure.json" FAKE_FAIL_SAVE=1
if bash "$SCRIPT" > "$TMP/failure-output.log" 2>&1; then
  echo 'expected injected capture failure' >&2
  exit 1
fi
grep -q 'stop server' "$TMP/failure.log"
grep -q 'start server' "$TMP/failure.log"
test ! -e "$TMP/out/failure.json"
! find "$TMP" -maxdepth 1 -type d -name 'arken-service-capture.*' | grep -q .
! grep -q 'PRIVATE_TEST_SENTINEL\|SERVER_SECRET_SENTINEL' "$TMP/failure-output.log"

# Missing interlock must stop before invoking any command or creating a stage.
export TEST_LOG="$TMP/refusal.log" ARKEN_CAPTURE_RECEIPT="$TMP/out/refused.json"
unset ARKEN_CAPTURE_QUIESCE_CONFIRM FAKE_FAIL_SAVE
if bash "$SCRIPT" > "$TMP/refusal-output.log" 2>&1; then
  echo 'expected interlock refusal' >&2
  exit 1
fi
test ! -s "$TMP/refusal.log"
test ! -e "$TMP/out/refused.json"
printf 'PASS: synthetic capture flow, encrypted-backup input staging, cleanup, and no-retention invariant\n'

# Explicit cloned-review capture validates exact IDs/image IDs/network/database
# host/media+edge binds before stopping; its restart trap targets only the API ID.
mkdir -p "$TMP/review-media" "$TMP/review-private" "$TMP/review-out"
printf '# synthetic private runtime\nDATABASE_URL=postgres://review_user:REVIEW_SECRET_SENTINEL@pg-review/reviewdb\n' > "$TMP/review-private/runtime.env"
printf 'synthetic edge config\n' > "$TMP/review-private/default.conf"
chmod 600 "$TMP/review-private/runtime.env" "$TMP/review-private/default.conf"
export TEST_REVIEW_API_ID=$(printf 'a%.0s' {1..64}) TEST_REVIEW_PG_ID=$(printf 'b%.0s' {1..64}) TEST_REVIEW_WEB_ID=$(printf 'c%.0s' {1..64}) TEST_REVIEW_EDGE_ID=$(printf 'd%.0s' {1..64})
export TEST_REVIEW_API_IMAGE=sha256:$(printf '1%.0s' {1..64}) TEST_REVIEW_PG_IMAGE=sha256:$(printf '2%.0s' {1..64}) TEST_REVIEW_WEB_IMAGE=sha256:$(printf '3%.0s' {1..64}) TEST_REVIEW_EDGE_IMAGE=sha256:$(printf '4%.0s' {1..64}) TEST_REVIEW_NETWORK=$(printf 'e%.0s' {1..64}) TEST_REVIEW_EDGE_EXTRA_NETWORK=$(printf 'f%.0s' {1..64})
export TEST_REVIEW_MEDIA_SOURCE="$(cygpath -m "$TMP/review-media")" TEST_REVIEW_EDGE_SOURCE="$(cygpath -m "$TMP/review-private/default.conf")"
export MSYS_NO_PATHCONV=1
export ARKEN_CAPTURE_MODE=cloned-review ARKEN_REVIEW_API_CONTAINER_ID="$TEST_REVIEW_API_ID" ARKEN_REVIEW_PG_CONTAINER_ID="$TEST_REVIEW_PG_ID" ARKEN_REVIEW_WEB_CONTAINER_ID="$TEST_REVIEW_WEB_ID" ARKEN_REVIEW_EDGE_CONTAINER_ID="$TEST_REVIEW_EDGE_ID"
export ARKEN_REVIEW_API_IMAGE_ID="$TEST_REVIEW_API_IMAGE" ARKEN_REVIEW_PG_IMAGE_ID="$TEST_REVIEW_PG_IMAGE" ARKEN_REVIEW_WEB_IMAGE_ID="$TEST_REVIEW_WEB_IMAGE" ARKEN_REVIEW_EDGE_IMAGE_ID="$TEST_REVIEW_EDGE_IMAGE" ARKEN_REVIEW_NETWORK_ID="$TEST_REVIEW_NETWORK"
export ARKEN_REVIEW_EDGE_EXTRA_NETWORK_IDS="$TEST_REVIEW_EDGE_EXTRA_NETWORK" ARKEN_REVIEW_MEDIA_SOURCE="$TEST_REVIEW_MEDIA_SOURCE" ARKEN_REVIEW_MEDIA_CONTAINER_PATH=/app/media ARKEN_REVIEW_EDGE_CONFIG_SOURCE="$TEST_REVIEW_EDGE_SOURCE" ARKEN_REVIEW_EDGE_CONFIG_CONTAINER_PATH=/etc/nginx/conf.d/default.conf ARKEN_REVIEW_RUNTIME_ENV_FILE="$(cygpath -m "$TMP/review-private/runtime.env")" ARKEN_REVIEW_EXPECTED_DATABASE_HOST=pg-review
export TEST_LOG="$TMP/review-success.log" ARKEN_BACKUP_ROOT="$TMP/review-out" ARKEN_CAPTURE_TMPDIR="$TMP" ARKEN_CAPTURE_RECEIPT="$TMP/review-out/success.json" FAKE_FAIL_SAVE=0 ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server
if bash "$SCRIPT" > "$TMP/review-output.log" 2>&1; then
  :
else
  status=$?
  echo 'synthetic cloned-review capture failed' >&2
  printf 'synthetic exit status: %s; last fake operation classes: ' "$status" >&2
  sed -E 's/^docker ([^ ]+).*/docker \1/;s/^restic ([^ ]+).*/restic \1/' "$TEST_LOG" | tail -n 8 | tr '\n' ' ' >&2
  printf '\n' >&2
  sed -E 's/REVIEW_SECRET_SENTINEL/[redacted]/g' "$TMP/review-output.log" >&2
  exit 1
fi
test -s "$TMP/review-out/success.json"
printf 'PASS: fake cloned-review capture completed\n'
grep -q "stop $TEST_REVIEW_API_ID" "$TMP/review-success.log"
grep -q "start $TEST_REVIEW_API_ID" "$TMP/review-success.log"
! grep -E "(stop|start) ($TEST_REVIEW_PG_ID|$TEST_REVIEW_WEB_ID|$TEST_REVIEW_EDGE_ID)" "$TMP/review-success.log"
! grep -q 'REVIEW_SECRET_SENTINEL' "$TMP/review-output.log"
grep -q 'edge.tar' "$TMP/review-success.log"
printf 'PASS: cloned-review success assertions\n'

# A mismatched reviewed image is refused before any API stop.
export TEST_LOG="$TMP/review-mismatch.log" ARKEN_CAPTURE_RECEIPT="$TMP/review-out/mismatch.json" ARKEN_REVIEW_API_IMAGE_ID=sha256:$(printf '9%.0s' {1..64})
if bash "$SCRIPT" > "$TMP/review-mismatch-output.log" 2>&1; then echo 'expected cloned identity mismatch refusal' >&2; exit 1; fi
printf 'PASS: cloned-review mismatch stopped before API stop\n'
! grep -q "stop $TEST_REVIEW_API_ID" "$TMP/review-mismatch.log"
test ! -e "$TMP/review-out/mismatch.json"
! grep -q 'REVIEW_SECRET_SENTINEL' "$TMP/review-mismatch-output.log"

# An injected post-stop archive error restarts exactly the API and no peers.
export TEST_LOG="$TMP/review-failure.log" ARKEN_CAPTURE_RECEIPT="$TMP/review-out/failure.json" ARKEN_REVIEW_API_IMAGE_ID="$TEST_REVIEW_API_IMAGE" FAKE_FAIL_SAVE=1
if bash "$SCRIPT" > "$TMP/review-failure-output.log" 2>&1; then echo 'expected cloned archive failure' >&2; exit 1; fi
printf 'PASS: cloned-review injected failure returned from API-only restart trap\n'
test "$(grep -c "stop $TEST_REVIEW_API_ID" "$TMP/review-failure.log")" -eq 1
test "$(grep -c "start $TEST_REVIEW_API_ID" "$TMP/review-failure.log")" -eq 1
! grep -E "(stop|start) ($TEST_REVIEW_PG_ID|$TEST_REVIEW_WEB_ID|$TEST_REVIEW_EDGE_ID)" "$TMP/review-failure.log"
test ! -e "$TMP/review-out/failure.json"
! grep -q 'REVIEW_SECRET_SENTINEL' "$TMP/review-failure-output.log"
printf 'PASS: cloned-review exact-identity refusal, API-only restart, four-image/config staging, and secret-output guard\n'

# Explicit missing proof input must never stop the API or silently fall back.
export TEST_LOG="$TMP/review-counts-refusal.log" ARKEN_CAPTURE_RECEIPT="$TMP/review-out/counts-refusal.json" FAKE_FAIL_SAVE=0 ARKEN_DATABASE_COUNTS_SQL="$TMP/missing-counts.sql"
if bash "$SCRIPT" > "$TMP/review-counts-output.log" 2>&1; then echo 'expected missing counts refusal' >&2; exit 1; fi
! grep -q "stop $TEST_REVIEW_API_ID" "$TMP/review-counts-refusal.log"
test ! -e "$TMP/review-out/counts-refusal.json"
unset ARKEN_DATABASE_COUNTS_SQL
printf 'PASS: explicit missing counts SQL refused before API downtime\n'