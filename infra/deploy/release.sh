#!/usr/bin/env sh
# UIX-465 — выкладка одной командой, с теми же гейтами.
#
# Запускать от uixray на боевом хосте:
#
#     sh infra/deploy/release.sh <40-символьная-ревизия>
#     RELEASE_CONFIRM=deploy-now sh infra/deploy/release.sh <ревизия>
#
# Без `RELEASE_CONFIRM` скрипт проходит все гейты и останавливается перед
# выкладкой. Это не «сухой прогон»: бэкап делается настоящий, репетиция
# восстановления настоящая — не делается только то, что меняет прод.
#
# Скрипт НЕ превращает выкладку в автоматическую. Гейты чеклиста остаются все
# до единого; исчезает ручная переписка сорокасимвольных значений между
# пятнадцатью командами, где я в выкладке 16.08.2026 ошибся четыре раза.
set -eu

APP_ROOT="${APP_ROOT:-/home/uixray/apps/arken-space}"
DOMAIN="${DOMAIN:-https://arken-khar.space}"
RESTIC_ENV="${RESTIC_ENV:-/etc/arken-space/restic.env}"
EXPECTED_SCHEMA_VERSION="${EXPECTED_SCHEMA_VERSION:-2}"
MIN_FREE_GIB="${MIN_FREE_GIB:-5}"
WORK="${TMPDIR:-/tmp}/arken-release-$$"

TARGET_REVISION="${1:-}"
case "$TARGET_REVISION" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *)
    echo "Укажите ревизию: 40 строчных шестнадцатеричных символов" >&2
    exit 2
    ;;
esac

ROLLBACK_REVISION=""
STEP=0

step() {
  STEP=$((STEP + 1))
  printf '\n[%02d] %s\n' "$STEP" "$1"
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
  rm -rf "$WORK"
  exit "$status"
}
trap on_failure EXIT

mkdir -p "$WORK"
cd "$APP_ROOT"

step "Предполётные проверки"
sudo -n nginx -t
CERT_END="$(echo | openssl s_client -servername "${DOMAIN#https://}" \
  -connect "${DOMAIN#https://}:443" 2>/dev/null |
  openssl x509 -noout -enddate | cut -d= -f2)"
echo "сертификат до: $CERT_END"
FREE_GIB="$(df -Pk / | awk 'NR==2 {printf "%d", $4 / 1024 / 1024}')"
echo "свободно: ${FREE_GIB} ГиБ"
if [ "$FREE_GIB" -lt "$MIN_FREE_GIB" ]; then
  echo "Меньше ${MIN_FREE_GIB} ГиБ свободно — выкладка остановлена" >&2
  exit 1
fi

step "Точка отката"
HEALTH="$(curl -fsS -m 20 "$DOMAIN/healthz")"
ROLLBACK_REVISION="$(printf '%s' "$HEALTH" | sed -n 's/.*"buildRevision":"\([0-9a-f]*\)".*/\1/p')"
if [ -z "$ROLLBACK_REVISION" ]; then
  echo "Не удалось прочитать текущую ревизию прода" >&2
  exit 1
fi
echo "сейчас на проде: $ROLLBACK_REVISION"
if [ "$ROLLBACK_REVISION" = "$TARGET_REVISION" ]; then
  echo "Целевая ревизия уже выложена — выкладывать нечего" >&2
  exit 1
fi

step "Проверка репозитория резервных копий"
sudo -n sh -c "set -a; . '$RESTIC_ENV'; set +a; restic check" | tail -2

step "Свежая резервная копия"
# Идентификатор снапшота читается из файла, который пишет сам `backup.sh`.
# Разбирать его вывод глазами — ровно тот шаг, ради которого всё затевалось.
SNAPSHOT_ARTIFACT="$WORK/snapshot-id"
sudo -n env BACKUP_SNAPSHOT_ARTIFACT="$SNAPSHOT_ARTIFACT" \
  sh -c "set -a; . '$RESTIC_ENV'; set +a; sh '$APP_ROOT/infra/backup/backup.sh'" |
  tail -1
sudo -n chmod a+r "$SNAPSHOT_ARTIFACT"
SNAPSHOT_ID="$(cat "$SNAPSHOT_ARTIFACT")"
case "$SNAPSHOT_ID" in
  latest | "")
    echo "Снапшот не опознан: '$SNAPSHOT_ID'" >&2
    exit 1
    ;;
esac
echo "снапшот: $SNAPSHOT_ID"

step "Переключение чекаута на выкладываемую ревизию"
test -z "$(git status --porcelain --untracked-files=normal)" || {
  echo "Боевой чекаут не чист — выкладка остановлена" >&2
  exit 1
}
git fetch --quiet origin
git checkout --quiet "$TARGET_REVISION"
test "$(git rev-parse HEAD)" = "$TARGET_REVISION"

step "Репетиция восстановления на изолированном контуре"
sudo -n env \
  ARKEN_RESTORE_CONFIRM=isolated-clean-target \
  RESTORE_BUILD_REVISION="$TARGET_REVISION" \
  SNAPSHOT_ID="$SNAPSHOT_ID" \
  ARKEN_PRODUCTION_HEALTH_URL="$DOMAIN/healthz" \
  sh -c "set -a; . '$RESTIC_ENV'; set +a; cd '$APP_ROOT' && corepack pnpm restore:rehearse" |
  grep -E '^\[restore\]'

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

if [ "${RELEASE_CONFIRM:-}" != "deploy-now" ]; then
  printf '\n== Гейты пройдены. Прод не тронут. ==\n'
  printf 'Ревизия:  %s\n' "$TARGET_REVISION"
  printf 'Снапшот:  %s\n' "$SNAPSHOT_ID"
  printf 'Откат на: %s\n' "$ROLLBACK_REVISION"
  printf '\nВыложить:\n  RELEASE_CONFIRM=deploy-now sh infra/deploy/release.sh %s\n' \
    "$TARGET_REVISION"
  rm -rf "$WORK"
  trap - EXIT
  exit 0
fi

step "Выкладка"
# Значения приходят из шагов выше. `build-and-start.sh` сверяет их сам и
# откажется собирать ревизию, отличную от отрепетированной.
sudo -n env \
  EXPECTED_BUILD_REVISION="$TARGET_REVISION" \
  VERIFIED_BACKUP_SNAPSHOT_ID="$SNAPSHOT_ID" \
  RESTORE_REHEARSAL_REVISION="$TARGET_REVISION" \
  EXPECTED_SCHEMA_VERSION="$EXPECTED_SCHEMA_VERSION" \
  sh "$APP_ROOT/infra/deploy/build-and-start.sh" | tail -5

step "Проверки после выкладки"
DEPLOYED="$(curl -fsS -m 30 "$DOMAIN/healthz")"
echo "$DEPLOYED"
printf '%s' "$DEPLOYED" | grep -q "\"buildRevision\":\"$TARGET_REVISION\"" || {
  echo "На проде не выкладываемая ревизия" >&2
  exit 1
}
printf '%s' "$DEPLOYED" | grep -q "\"schemaVersion\":$EXPECTED_SCHEMA_VERSION" || {
  echo "Схема на проде не $EXPECTED_SCHEMA_VERSION" >&2
  exit 1
}
sudo -n sh "$APP_ROOT/infra/deploy/smoke-auth.sh" | tail -5

# Апгрейд WebSocket проверяется отдельно от здоровья: realtime ходит через
# nginx другим путём, и сломанный `proxy_set_header Upgrade` не заметен по
# `/healthz`.
UPGRADE="$(curl -sS -i -m 8 --http1.1 \
  -H "Origin: $DOMAIN" -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "$DOMAIN/socket.io/?EIO=4&transport=websocket" 2>/dev/null | head -1 || true)"
echo "websocket: $UPGRADE"
case "$UPGRADE" in
  *101*) ;;
  *)
    echo "WebSocket не поднялся" >&2
    exit 1
    ;;
esac

printf '\n== Выложено ==\n'
printf 'Ревизия:  %s\n' "$TARGET_REVISION"
printf 'Снапшот:  %s\n' "$SNAPSHOT_ID"
printf 'Откат на: %s\n' "$ROLLBACK_REVISION"
rm -rf "$WORK"
trap - EXIT
