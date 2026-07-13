#!/usr/bin/env sh
set -eu

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"

if [ -z "${RESTIC_PASSWORD:-}" ] && [ -z "${RESTIC_PASSWORD_FILE:-}" ]; then
  echo "RESTIC_PASSWORD or RESTIC_PASSWORD_FILE is required" >&2
  exit 1
fi

APP_ROOT="${APP_ROOT:-/home/uixray/apps/arken-space}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/uixray/apps/arken-space-data/backups}"
MEDIA_ROOT="${MEDIA_ROOT:-/home/uixray/apps/arken-space-data/media}"
PRODUCTION_COMPOSE_PROJECT="${PRODUCTION_COMPOSE_PROJECT:-arken-space}"
BACKUP_HOST="${BACKUP_HOST:-arken-production}"
BACKUP_TAG="${BACKUP_TAG:-arken-space}"
RESTIC_CHECK="${RESTIC_CHECK:-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREFIX="arken-$STAMP"
DUMP_FILE="$BACKUP_ROOT/$PREFIX.dump"
DUMP_CHECKSUM="$DUMP_FILE.sha256"
DATABASE_COUNTS="$BACKUP_ROOT/$PREFIX.database-counts.txt"
MEDIA_CHECKSUMS="$BACKUP_ROOT/$PREFIX.media-sha256.txt"
COUNTS_SQL="$APP_ROOT/infra/backup/database-counts.sql"
PARTIAL_DUMP="$DUMP_FILE.partial"
DOCKER_MODE=""

cleanup_partial() {
  rm -f "$PARTIAL_DUMP"
}
trap cleanup_partial EXIT HUP INT TERM

if [ ! -f "$APP_ROOT/docker-compose.yml" ]; then
  echo "Production Compose file was not found at $APP_ROOT/docker-compose.yml" >&2
  exit 1
fi
if [ ! -f "$COUNTS_SQL" ]; then
  echo "Database count query was not found at $COUNTS_SQL" >&2
  exit 1
fi
if [ ! -d "$MEDIA_ROOT" ]; then
  echo "Production media directory was not found at $MEDIA_ROOT" >&2
  exit 1
fi
case "$PRODUCTION_COMPOSE_PROJECT" in
  arken-space) ;;
  *)
    echo "PRODUCTION_COMPOSE_PROJECT must be exactly arken-space" >&2
    exit 1
    ;;
esac

if docker info >/dev/null 2>&1; then
  DOCKER_MODE=direct
elif command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  DOCKER_MODE=sudo
else
  echo "Docker is unavailable without an interactive privilege prompt" >&2
  exit 1
fi

run_docker() {
  if [ "$DOCKER_MODE" = sudo ]; then
    sudo -n docker "$@"
  else
    docker "$@"
  fi
}

compose() {
  run_docker compose \
    --project-name "$PRODUCTION_COMPOSE_PROJECT" \
    --project-directory "$APP_ROOT" \
    --file "$APP_ROOT/docker-compose.yml" \
    "$@"
}

if [ -z "$(compose ps --status running --quiet postgres)" ]; then
  echo "Production PostgreSQL service is not running" >&2
  exit 1
fi

restic cat config >/dev/null

umask 077
mkdir -p "$BACKUP_ROOT"

compose exec -T postgres \
  pg_dump --username arken --dbname arken --format=custom > "$PARTIAL_DUMP"
if [ ! -s "$PARTIAL_DUMP" ]; then
  echo "PostgreSQL dump is empty" >&2
  exit 1
fi
mv "$PARTIAL_DUMP" "$DUMP_FILE"

compose exec -T postgres \
  psql --username arken --dbname arken --no-align --tuples-only \
  --field-separator='|' < "$COUNTS_SQL" > "$DATABASE_COUNTS"

(
  cd "$BACKUP_ROOT"
  sha256sum "$(basename "$DUMP_FILE")" > "$(basename "$DUMP_CHECKSUM")"
)

if find "$MEDIA_ROOT" -type f -print -quit | grep -q .; then
  (
    cd "$MEDIA_ROOT"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum
  ) > "$MEDIA_CHECKSUMS"
else
  : > "$MEDIA_CHECKSUMS"
fi

restic backup \
  "$DUMP_FILE" \
  "$DUMP_CHECKSUM" \
  "$DATABASE_COUNTS" \
  "$MEDIA_CHECKSUMS" \
  "$MEDIA_ROOT" \
  --host "$BACKUP_HOST" \
  --tag "$BACKUP_TAG"

restic forget \
  --host "$BACKUP_HOST" \
  --tag "$BACKUP_TAG" \
  --keep-daily 7 \
  --keep-weekly 4 \
  --keep-monthly 6 \
  --prune

if [ "$RESTIC_CHECK" = 1 ]; then
  restic check
fi

find "$BACKUP_ROOT" -type f -name 'arken-*' -mtime +2 -delete
restic snapshots --host "$BACKUP_HOST" --tag "$BACKUP_TAG" --latest 1

echo "Arken Space PostgreSQL and media backup completed at $STAMP"
