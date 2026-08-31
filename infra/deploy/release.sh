#!/usr/bin/env sh
# UIX-465 / UIX-574 — evidence-gated production release.
#
# Запускать от uixray на боевом хосте:
#
#     sh infra/deploy/release.sh <40-символьная-ревизия>
#     MEDIA_SMOKE_APPROVAL=non-live-candidate-passed \
#       RELEASE_CONFIRM=deploy-now sh infra/deploy/release.sh <ревизия>
#
# Без RELEASE_CONFIRM скрипт делает настоящий backup и restore rehearsal, но
# не меняет запущенный production stack. Confirmed invocation дополнительно
# сохраняет точные server/web images под immutable-by-policy rollback tags.
set -eu
umask 077

PRODUCTION_APP_ROOT=/home/uixray/apps/arken-space
PRODUCTION_DOMAIN=https://arken-khar.space
PRODUCTION_MEDIA_HOST_PATH=/home/uixray/apps/arken-space-data/media
RELEASE_LOCK_FILE=/home/uixray/apps/.arken-space-release.lock
COMPOSE_PROJECT_NAME=arken-space

APP_ROOT="${APP_ROOT:-$PRODUCTION_APP_ROOT}"
DOMAIN="${DOMAIN:-$PRODUCTION_DOMAIN}"
RESTIC_ENV="${RESTIC_ENV:-/etc/arken-space/restic.env}"
EXPECTED_SCHEMA_VERSION="${EXPECTED_SCHEMA_VERSION:-2}"
TARGET_REVISION="${1:-}"
WORK=""

ROLLBACK_REVISION=""
ROLLBACK_SERVER_TAG=""
ROLLBACK_WEB_TAG=""
ROLLBACK_SERVER_IMAGE_ID=""
ROLLBACK_WEB_IMAGE_ID=""
ROLLBACK_SERVER_VERIFIED=0
ROLLBACK_WEB_VERIFIED=0
DEPLOYED_SERVER_IMAGE_ID=""
DEPLOYED_WEB_IMAGE_ID=""
STEP=0

fail() {
  echo "$1" >&2
  exit 1
}

case "$TARGET_REVISION" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "Укажите ревизию: 40 строчных шестнадцатеричных символов" >&2
    exit 2
    ;;
esac

[ "$APP_ROOT" = "$PRODUCTION_APP_ROOT" ] ||
  fail "APP_ROOT не совпадает с production path"
[ "$DOMAIN" = "$PRODUCTION_DOMAIN" ] ||
  fail "DOMAIN не совпадает с production origin"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/arken-release.XXXXXX")"

step() {
  STEP=$((STEP + 1))
  printf '\n[%02d] %s\n' "$STEP" "$1"
}

# Обязательная команда сначала завершается сама. tail/grep читают её лог уже
# после этого и поэтому не могут подменить настоящий exit code кодом pipeline.
run_logged() {
  run_logged_path=$1
  shift
  if "$@" >"$run_logged_path" 2>&1; then
    return 0
  else
    run_logged_status=$?
    echo "Обязательный gate завершился с кодом $run_logged_status" >&2
    tail -40 "$run_logged_path" >&2 || true
    return "$run_logged_status"
  fi
}

# Точка отката повторяется при любом провале: человек, у которого посреди ночи
# упал гейт, не должен искать её в истории терминала.
on_failure() {
  status=$?
  [ "$status" -eq 0 ] && return 0
  printf '\n!! Выкладка остановлена на шаге %d (код %d).\n' "$STEP" "$status" >&2
  if [ -n "$ROLLBACK_REVISION" ]; then
    printf '!! Точка отката: ревизия %s\n' "$ROLLBACK_REVISION" >&2
    printf '!! Прод не менялся, если шаг был до выкладки.\n' >&2
  fi
  if [ "$ROLLBACK_SERVER_VERIFIED" = 1 ]; then
    printf '!! Rollback server: %s -> %s\n' \
      "$ROLLBACK_SERVER_TAG" "$ROLLBACK_SERVER_IMAGE_ID" >&2
  fi
  if [ "$ROLLBACK_WEB_VERIFIED" = 1 ]; then
    printf '!! Rollback web:    %s -> %s\n' \
      "$ROLLBACK_WEB_TAG" "$ROLLBACK_WEB_IMAGE_ID" >&2
  fi
  [ -z "$WORK" ] || rm -rf "$WORK"
  exit "$status"
}
trap on_failure EXIT

mkdir -p "$WORK"
cd "$APP_ROOT"

acquire_release_lock() {
  command -v flock >/dev/null 2>&1 || fail "На production host отсутствует flock"
  [ ! -L "$RELEASE_LOCK_FILE" ] || fail "Release lock не должен быть symlink"
  exec 9>"$RELEASE_LOCK_FILE"
  flock -n 9 || fail "Другой release уже выполняется"
}

compose_with_revision() {
  compose_revision=$1
  shift
  sudo -n env BUILD_REVISION="$compose_revision" docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --project-directory "$APP_ROOT" \
    --file "$APP_ROOT/docker-compose.yml" \
    "$@"
}

running_image_id() (
  running_service=$1
  running_revision=$2
  running_containers="$(compose_with_revision "$running_revision" ps -q "$running_service")"
  set -- $running_containers
  [ "$#" -eq 1 ] || {
    echo "Для $running_service ожидался ровно один запущенный контейнер" >&2
    exit 1
  }
  running_raw_image="$(sudo -n docker inspect --format '{{.Image}}' "$1")"
  node "$APP_ROOT/infra/deploy/release-core.mjs" image-id "$running_raw_image"
)

preserve_rollback_tag() {
  preserve_service=$1
  preserve_tag=$2
  preserve_image_id=$3
  preserve_existing="$(
    sudo -n docker image ls --quiet --no-trunc \
      --filter "reference=$preserve_tag"
  )"
  if [ -n "$preserve_existing" ]; then
    preserve_existing="$(
      node "$APP_ROOT/infra/deploy/release-core.mjs" image-id "$preserve_existing"
    )"
    node "$APP_ROOT/infra/deploy/release-core.mjs" rollback-tag-intent \
      "$preserve_service" "$preserve_tag" "$preserve_image_id" "$preserve_existing" \
      >/dev/null
  else
    node "$APP_ROOT/infra/deploy/release-core.mjs" rollback-tag-intent \
      "$preserve_service" "$preserve_tag" "$preserve_image_id" - >/dev/null
    sudo -n docker image tag "$preserve_image_id" "$preserve_tag"
  fi
}

verify_rollback_tag() {
  verify_service=$1
  verify_tag=$2
  verify_expected=$3
  verify_actual="$(
    sudo -n docker image inspect --format '{{.Id}}' "$verify_tag"
  )"
  node "$APP_ROOT/infra/deploy/release-core.mjs" assert-rollback-tag \
    "$verify_service" "$verify_tag" "$verify_expected" "$verify_actual"
}

check_operator_env_file() {
  [ -f "$APP_ROOT/.env" ] || fail "Production .env отсутствует"
  [ ! -L "$APP_ROOT/.env" ] || fail "Production .env не должен быть symlink"
  env_mode="$(stat -c '%a' "$APP_ROOT/.env")"
  env_owner="$(stat -c '%u' "$APP_ROOT/.env")"
  [ "$env_mode" = 600 ] || fail "Production .env должен иметь mode 600"
  [ "$env_owner" = "$(id -u)" ] ||
    fail "Production .env должен принадлежать оператору release"
  if git ls-files --error-unmatch -- .env >/dev/null 2>&1; then
    fail "Production .env не должен быть tracked в Git"
  fi
  git check-ignore -q -- .env || fail "Production .env должен оставаться ignored"
}

operator_env_digest() {
  command -v sha256sum >/dev/null 2>&1 || fail "На production host отсутствует sha256sum"
  env_digest_line="$(sha256sum "$APP_ROOT/.env")"
  env_digest="${env_digest_line%% *}"
  case "$env_digest" in
    *[!0-9a-f]* | '') fail "Не удалось вычислить digest production .env" ;;
  esac
  [ "${#env_digest}" -eq 64 ] || fail "Digest production .env имеет неверную длину"
  printf '%s' "$env_digest"
}

production_revision() {
  revision_label=$1
  revision_file="$WORK/health-$revision_label.json"
  curl -fsS -m 20 "$DOMAIN/healthz" >"$revision_file"
  node "$APP_ROOT/infra/deploy/release-core.mjs" health-revision "$revision_file"
}

assert_production_revision() {
  revision_label=$1
  revision_expected=$2
  revision_file="$WORK/health-$revision_label.json"
  curl -fsS -m 20 "$DOMAIN/healthz" >"$revision_file"
  node "$APP_ROOT/infra/deploy/release-core.mjs" assert-health-revision \
    "$revision_file" "$revision_expected" "$revision_label"
}

check_root_private_file() {
  private_label=$1
  private_path=$2
  sudo -n test -f "$private_path" || fail "$private_label отсутствует"
  if sudo -n test -L "$private_path"; then
    fail "$private_label не должен быть symlink"
  fi
  private_mode="$(sudo -n stat -c '%a' "$private_path")"
  private_owner="$(sudo -n stat -c '%u' "$private_path")"
  [ "$private_mode" = 600 ] || fail "$private_label должен иметь mode 600"
  [ "$private_owner" = 0 ] || fail "$private_label должен принадлежать root"
}

check_disk_reserve() {
  disk_label=$1
  disk_available_kib="$(df -Pk "$MEDIA_HOST_PATH" | awk 'NR == 2 {print $4}')"
  case "$disk_available_kib" in
    '' | *[!0-9]*) fail "Не удалось прочитать свободное место: $disk_label" ;;
  esac
  node "$APP_ROOT/infra/deploy/release-core.mjs" check-disk-kib \
    "$disk_available_kib" "$MIN_FREE_DISK_BYTES" "$disk_label"
}

step "Release lock и production env до checkout"
acquire_release_lock
START_REVISION="$(git rev-parse HEAD)"
if [ "${RELEASE_CONFIRM:-}" = deploy-now ] && [ "$START_REVISION" != "$TARGET_REVISION" ]; then
  fail "Confirmed release должен начинаться из целевой ревизии; сначала выполните unconfirmed pass"
fi
check_operator_env_file
OPERATOR_ENV_DIGEST_BEFORE="$(operator_env_digest)"
PRECHECK_ENV_LOG="$WORK/production-env-before-checkout.log"
run_logged "$PRECHECK_ENV_LOG" node "$APP_ROOT/infra/deploy/release-core.mjs" \
  validate-env "$APP_ROOT/.env" "$APP_ROOT" "$DOMAIN"
cat "$PRECHECK_ENV_LOG"

step "Предполётные проверки"
sudo -n nginx -t
CERT_PEM="$WORK/certificate.pem"
echo | openssl s_client -servername "${DOMAIN#https://}" \
  -connect "${DOMAIN#https://}:443" >"$CERT_PEM" 2>/dev/null
CERT_LINE="$(openssl x509 -in "$CERT_PEM" -noout -enddate)"
case "$CERT_LINE" in
  notAfter=*) CERT_END=${CERT_LINE#notAfter=} ;;
  *) fail "Не удалось прочитать срок production-сертификата" ;;
esac
echo "сертификат до: $CERT_END"

step "Точка отката"
ROLLBACK_REVISION="$(production_revision rollback)"
echo "сейчас на проде: $ROLLBACK_REVISION"
[ "$ROLLBACK_REVISION" != "$TARGET_REVISION" ] ||
  fail "Целевая ревизия уже выложена — выкладывать нечего"

step "Переключение чекаута на выкладываемую ревизию"
test -z "$(git status --porcelain --untracked-files=normal)" ||
  fail "Боевой чекаут не чист — выкладка остановлена"
git fetch --quiet origin
git cat-file -e "${TARGET_REVISION}^{commit}"
git merge-base --is-ancestor "$TARGET_REVISION" origin/main ||
  fail "Целевая ревизия не входит в историю origin/main"
TARGET_ENV_ENTRY="$(git ls-tree --name-only "$TARGET_REVISION" -- .env)"
[ -z "$TARGET_ENV_ENTRY" ] ||
  fail "Целевая ревизия не должна содержать tracked .env"
git checkout --quiet "$TARGET_REVISION"
test "$(git rev-parse HEAD)" = "$TARGET_REVISION"
check_operator_env_file
OPERATOR_ENV_DIGEST_AFTER="$(operator_env_digest)"
[ "$OPERATOR_ENV_DIGEST_AFTER" = "$OPERATOR_ENV_DIGEST_BEFORE" ] ||
  fail "Production .env изменился во время checkout"

step "Production env и права доступа"
ENV_LOG="$WORK/production-env.log"
run_logged "$ENV_LOG" node "$APP_ROOT/infra/deploy/release-core.mjs" \
  validate-env "$APP_ROOT/.env" "$APP_ROOT" "$DOMAIN"
cat "$ENV_LOG"
MEDIA_HOST_PATH="$(node "$APP_ROOT/infra/deploy/release-core.mjs" \
  env-value "$APP_ROOT/.env" MEDIA_HOST_PATH "$APP_ROOT" "$DOMAIN")"
MIN_FREE_DISK_BYTES="$(node "$APP_ROOT/infra/deploy/release-core.mjs" \
  env-value "$APP_ROOT/.env" MIN_FREE_DISK_BYTES "$APP_ROOT" "$DOMAIN")"
[ "$MEDIA_HOST_PATH" = "$PRODUCTION_MEDIA_HOST_PATH" ] ||
  fail "MEDIA_HOST_PATH не совпадает с production path"
[ -d "$MEDIA_HOST_PATH" ] || fail "Production media directory отсутствует"

check_root_private_file "Restic env" "$RESTIC_ENV"
RESTIC_CONTRACT_LOG="$WORK/restic-contract.log"
run_logged "$RESTIC_CONTRACT_LOG" sudo -n sh -c '
set -eu
set -a
. "$1"
set +a
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
case "$RESTIC_PASSWORD_FILE" in /*) ;; *) exit 1 ;; esac
printf "%s" "$RESTIC_PASSWORD_FILE"
' sh "$RESTIC_ENV"
RESTIC_PASSWORD_FILE="$(cat "$RESTIC_CONTRACT_LOG")"
check_root_private_file "Restic password file" "$RESTIC_PASSWORD_FILE"
check_disk_reserve preflight

step "Проверка репозитория резервных копий"
RESTIC_CHECK_LOG="$WORK/restic-check.log"
run_logged "$RESTIC_CHECK_LOG" sudo -n sh -c \
  'set -a; . "$1"; set +a; restic check' sh "$RESTIC_ENV"
tail -2 "$RESTIC_CHECK_LOG"

step "Свежая резервная копия"
# Идентификатор снапшота читается из файла, который пишет сам `backup.sh`.
# Разбирать его вывод глазами — ровно тот шаг, ради которого всё затевалось.
SNAPSHOT_ARTIFACT="$WORK/snapshot-id"
BACKUP_LOG="$WORK/backup.log"
run_logged "$BACKUP_LOG" sudo -n env \
  BACKUP_SNAPSHOT_ARTIFACT="$SNAPSHOT_ARTIFACT" \
  sh -c 'set -a; . "$1"; set +a; sh "$2/infra/backup/backup.sh"' \
  sh "$RESTIC_ENV" "$APP_ROOT"
tail -1 "$BACKUP_LOG"
sudo -n chmod a+r "$SNAPSHOT_ARTIFACT"
SNAPSHOT_ID="$(cat "$SNAPSHOT_ARTIFACT")"
case "$SNAPSHOT_ID" in
  latest | '') fail "Снапшот не опознан: '$SNAPSHOT_ID'" ;;
esac
echo "снапшот: $SNAPSHOT_ID"

step "Репетиция восстановления на изолированном контуре"
RESTORE_LOG="$WORK/restore.log"
run_logged "$RESTORE_LOG" sudo -n env \
  ARKEN_RESTORE_CONFIRM=isolated-clean-target \
  RESTORE_BUILD_REVISION="$TARGET_REVISION" \
  SNAPSHOT_ID="$SNAPSHOT_ID" \
  ARKEN_PRODUCTION_HEALTH_URL="$DOMAIN/healthz" \
  sh -c 'set -a; . "$1"; set +a; cd "$2" && corepack pnpm restore:rehearse' \
  sh "$RESTIC_ENV" "$APP_ROOT"
grep -E '^\[restore\]' "$RESTORE_LOG"

step "Разбор отчёта репетиции"
# Отчёт разбирается программой, а не глазами: «22 шага, все зелёные» человек
# подтверждает кивком, а несовпадение ревизии в одном из них — не заметит.
node -e '
const report = require(process.argv[1]);
const [snapshot, revision, schema] = process.argv.slice(2);
const fail = (message) => { console.error("Отчёт репетиции: " + message); process.exit(1); };
if (report.runSucceeded !== true) fail("runSucceeded не true");
const bad = (report.steps ?? []).filter((step) => step.status !== "passed");
if (bad.length) fail("провалены шаги: " + bad.map((step) => step.name).join(", "));
if (report.snapshot?.id !== snapshot) fail("снапшот в отчёте не тот, что делали");
const restored = (report.steps ?? []).find((step) => step.name === "restored-application-health");
if (restored?.buildRevision !== revision) fail("поднялась не выкладываемая ревизия");
if (String(restored?.schemaVersion) !== schema) fail("схема не " + schema);
const leftovers = report.leftovers ?? {};
if ((leftovers.containers ?? []).length || (leftovers.volumes ?? []).length)
  fail("после репетиции остался мусор");
console.log("отчёт чист: " + (report.steps ?? []).length + " шагов, снапшот " + report.snapshot.shortId);
' "$APP_ROOT/test-results/restore/runner.json" "$SNAPSHOT_ID" "$TARGET_REVISION" "$EXPECTED_SCHEMA_VERSION"

if [ "${RELEASE_CONFIRM:-}" != deploy-now ]; then
  printf '\n== Host gates пройдены. Production stack не менялся. ==\n'
  printf 'Ревизия:  %s\n' "$TARGET_REVISION"
  printf 'Снапшот:  %s\n' "$SNAPSHOT_ID"
  printf 'Откат на: %s\n' "$ROLLBACK_REVISION"
  printf '\nПосле ручного media smoke на disposable non-live candidate выложить:\n'
  printf '  MEDIA_SMOKE_APPROVAL=non-live-candidate-passed RELEASE_CONFIRM=deploy-now sh infra/deploy/release.sh %s\n' \
    "$TARGET_REVISION"
  rm -rf "$WORK"
  trap - EXIT
  exit 0
fi

[ "${MEDIA_SMOKE_APPROVAL:-}" = non-live-candidate-passed ] ||
  fail "Подтвердите media gate: MEDIA_SMOKE_APPROVAL=non-live-candidate-passed"

step "Сохранение образов отката"
ROLLBACK_SERVER_TAG="$(node "$APP_ROOT/infra/deploy/release-core.mjs" \
  rollback-tag server "$ROLLBACK_REVISION")"
ROLLBACK_WEB_TAG="$(node "$APP_ROOT/infra/deploy/release-core.mjs" \
  rollback-tag web "$ROLLBACK_REVISION")"
assert_production_revision before-image-capture "$ROLLBACK_REVISION"
CAPTURED_SERVER_IMAGE_ID="$(running_image_id server "$ROLLBACK_REVISION")"
CAPTURED_WEB_IMAGE_ID="$(running_image_id web "$ROLLBACK_REVISION")"
assert_production_revision after-image-capture "$ROLLBACK_REVISION"
preserve_rollback_tag server "$ROLLBACK_SERVER_TAG" "$CAPTURED_SERVER_IMAGE_ID"
verify_rollback_tag server "$ROLLBACK_SERVER_TAG" "$CAPTURED_SERVER_IMAGE_ID"
ROLLBACK_SERVER_IMAGE_ID="$CAPTURED_SERVER_IMAGE_ID"
ROLLBACK_SERVER_VERIFIED=1
preserve_rollback_tag web "$ROLLBACK_WEB_TAG" "$CAPTURED_WEB_IMAGE_ID"
verify_rollback_tag web "$ROLLBACK_WEB_TAG" "$CAPTURED_WEB_IMAGE_ID"
ROLLBACK_WEB_IMAGE_ID="$CAPTURED_WEB_IMAGE_ID"
ROLLBACK_WEB_VERIFIED=1
assert_production_revision after-rollback-preserve "$ROLLBACK_REVISION"
printf 'rollback server: %s -> %s\n' "$ROLLBACK_SERVER_TAG" "$ROLLBACK_SERVER_IMAGE_ID"
printf 'rollback web:    %s -> %s\n' "$ROLLBACK_WEB_TAG" "$ROLLBACK_WEB_IMAGE_ID"

step "Disk gate перед сборкой"
DISK_BEFORE_LOG="$WORK/disk-before-build.log"
check_disk_reserve before-build >"$DISK_BEFORE_LOG"
cat "$DISK_BEFORE_LOG"

step "Выкладка"
# Значения приходят из шагов выше. `build-and-start.sh` сверяет их сам и
# откажется собирать ревизию, отличную от отрепетированной.
BUILD_LOG="$WORK/build-and-start.log"
run_logged "$BUILD_LOG" env \
  APP_ROOT="$APP_ROOT" \
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
  EXPECTED_BUILD_REVISION="$TARGET_REVISION" \
  VERIFIED_BACKUP_SNAPSHOT_ID="$SNAPSHOT_ID" \
  RESTORE_REHEARSAL_REVISION="$TARGET_REVISION" \
  EXPECTED_SCHEMA_VERSION="$EXPECTED_SCHEMA_VERSION" \
  sh "$APP_ROOT/infra/deploy/build-and-start.sh"
tail -5 "$BUILD_LOG"

step "Проверка rollback tags после build"
ROLLBACK_SERVER_VERIFIED=0
ROLLBACK_WEB_VERIFIED=0
verify_rollback_tag server "$ROLLBACK_SERVER_TAG" "$ROLLBACK_SERVER_IMAGE_ID"
ROLLBACK_SERVER_VERIFIED=1
verify_rollback_tag web "$ROLLBACK_WEB_TAG" "$ROLLBACK_WEB_IMAGE_ID"
ROLLBACK_WEB_VERIFIED=1

step "Disk gate после сборки"
DISK_AFTER_LOG="$WORK/disk-after-build.log"
check_disk_reserve after-build >"$DISK_AFTER_LOG"
cat "$DISK_AFTER_LOG"

step "Проверки после выкладки"
DEPLOYED_HEALTH="$WORK/deployed-health.json"
curl -fsS -m 30 "$DOMAIN/healthz" >"$DEPLOYED_HEALTH"
node -e '
const fs = require("node:fs");
const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const [revision, schema] = process.argv.slice(2);
if (body.status !== "ok" || body.database !== "ok")
  throw new Error("Production health is not authoritative");
if (body.buildRevision !== revision)
  throw new Error("На проде не выкладываемая ревизия");
if (String(body.schemaVersion) !== schema)
  throw new Error("Схема на проде не " + schema);
console.log("health revision=" + body.buildRevision + " schema=" + body.schemaVersion);
' "$DEPLOYED_HEALTH" "$TARGET_REVISION" "$EXPECTED_SCHEMA_VERSION"

AUTH_LOG="$WORK/auth-smoke.log"
run_logged "$AUTH_LOG" env \
  APP_ROOT="$APP_ROOT" \
  DOMAIN="$DOMAIN" \
  EXPECTED_BUILD_REVISION="$TARGET_REVISION" \
  EXPECTED_SCHEMA_VERSION="$EXPECTED_SCHEMA_VERSION" \
  sh "$APP_ROOT/infra/deploy/smoke-auth.sh"
cat "$AUTH_LOG"

# Апгрейд WebSocket проверяется отдельно от здоровья: realtime ходит через
# nginx другим путём, и сломанный `proxy_set_header Upgrade` не заметен по
# `/healthz`.
WS_LOG="$WORK/websocket.headers"
curl -sS -i -m 8 --http1.1 \
  -H "Origin: $DOMAIN" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$DOMAIN/socket.io/?EIO=4&transport=websocket" >"$WS_LOG" 2>/dev/null || true
UPGRADE="$(sed -n '1p' "$WS_LOG")"
echo "websocket: $UPGRADE"
case "$UPGRADE" in
  *101*) ;;
  *) fail "WebSocket не поднялся" ;;
esac

step "Проверка rollback evidence"
ROLLBACK_SERVER_VERIFIED=0
ROLLBACK_WEB_VERIFIED=0
verify_rollback_tag server "$ROLLBACK_SERVER_TAG" "$ROLLBACK_SERVER_IMAGE_ID"
ROLLBACK_SERVER_VERIFIED=1
verify_rollback_tag web "$ROLLBACK_WEB_TAG" "$ROLLBACK_WEB_IMAGE_ID"
ROLLBACK_WEB_VERIFIED=1
DEPLOYED_SERVER_IMAGE_ID="$(running_image_id server "$TARGET_REVISION")"
DEPLOYED_WEB_IMAGE_ID="$(running_image_id web "$TARGET_REVISION")"
SERVER_IMAGE_EVIDENCE="$(node "$APP_ROOT/infra/deploy/release-core.mjs" \
  image-evidence server "$ROLLBACK_SERVER_TAG" \
  "$ROLLBACK_SERVER_IMAGE_ID" "$DEPLOYED_SERVER_IMAGE_ID")"
WEB_IMAGE_EVIDENCE="$(node "$APP_ROOT/infra/deploy/release-core.mjs" \
  image-evidence web "$ROLLBACK_WEB_TAG" \
  "$ROLLBACK_WEB_IMAGE_ID" "$DEPLOYED_WEB_IMAGE_ID")"

printf '\n== Выложено: автоматические production gates пройдены ==\n'
printf 'Ревизия:             %s\n' "$TARGET_REVISION"
printf 'Снапшот:             %s\n' "$SNAPSHOT_ID"
printf 'Откат на:            %s\n' "$ROLLBACK_REVISION"
printf 'Rollback server:     %s -> %s\n' "$ROLLBACK_SERVER_TAG" "$ROLLBACK_SERVER_IMAGE_ID"
printf 'Rollback web:        %s -> %s\n' "$ROLLBACK_WEB_TAG" "$ROLLBACK_WEB_IMAGE_ID"
printf 'Deployed server ID:  %s\n' "$DEPLOYED_SERVER_IMAGE_ID"
printf 'Deployed web ID:     %s\n' "$DEPLOYED_WEB_IMAGE_ID"
printf 'Image evidence:      %s\n' "$SERVER_IMAGE_EVIDENCE"
printf 'Image evidence:      %s\n' "$WEB_IMAGE_EVIDENCE"
printf 'Media smoke:         non-live candidate approved\n'
cat "$DISK_BEFORE_LOG"
cat "$DISK_AFTER_LOG"
printf 'Ручная production acceptance всё ещё выполняется отдельно.\n'
rm -rf "$WORK"
trap - EXIT
