#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SCRIPT="$ROOT/infra/backup/capture-service-snapshot.sh"
TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/app/infra/backup" "$TMP/repo"
cp "$ROOT/infra/backup/database-counts.sql" "$TMP/app/infra/backup/"
printf 'synthetic compose\n' > "$TMP/app/compose.template.yml"
printf 'PRIVATE_TEST_SENTINEL=do-not-print\n' > "$TMP/app/runtime.env"
chmod 600 "$TMP/app/runtime.env"
printf 'SERVER_SECRET_SENTINEL=must-stay-encrypted\n' > "$TMP/app/server-runtime.env"
chmod 600 "$TMP/app/server-runtime.env"
printf 'synthetic config\n' > "$TMP/app/compose.activation.override.yml"
cat > "$TMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -eu
printf '%s\n' "docker $*" >> "$TEST_LOG"
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
  *' stop server'*) ;;
  *' start server'*) ;;
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
   grep -q 'PRIVATE_TEST_SENTINEL=do-not-print' "$root/config/runtime.env"
   grep -q 'SERVER_SECRET_SENTINEL=must-stay-encrypted' "$root/config/server-runtime.env"
   test -f "$root/config/compose-rendered.private.json"
   test -f "$root/database.dump" && test -f "$root/database-counts.txt" && test -f "$root/postgres-version.txt" && test -f "$root/migration-ledger.txt" && test -f "$root/media/file.bin" && test -f "$root/images/server.tar"
   : > "$TEST_LOG.snapshot"
   ;;
 *) echo 'unexpected fake restic invocation' >&2; exit 8;;
esac
RESTIC
chmod +x "$TMP/bin/docker" "$TMP/bin/restic"
export PATH="$TMP/bin:$PATH" TEST_LOG="$TMP/commands.log" RESTIC_REPOSITORY="$TMP/repo" TEST_RUNTIME_ENV="$TMP/app/server-runtime.env"
export ARKEN_APP_ROOT="$TMP/app" ARKEN_COMPOSE_FILE="$TMP/app/compose.template.yml"
export ARKEN_RUNTIME_ENV_FILE="$TMP/app/runtime.env" ARKEN_BACKUP_ROOT="$TMP/out"
export ARKEN_CAPTURE_TMPDIR="$TMP" ARKEN_CAPTURE_RECEIPT="$TMP/out/receipt.json"
export ARKEN_CAPTURE_QUIESCE_CONFIRM=stop-and-restart-arken-server
bash "$SCRIPT" > "$TMP/output.log"
test -s "$TMP/out/receipt.json"
! grep -q 'PRIVATE_TEST_SENTINEL' "$TMP/output.log"
! grep -Eiq 'forget|prune|rm -rf|delete' "$TMP/commands.log"
! find "$TMP" -maxdepth 1 -type d -name 'arken-service-capture.*' | grep -q .
grep -q 'stop server' "$TMP/commands.log"
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
