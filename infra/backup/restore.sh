#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

MEDIA_ROOT="${MEDIA_ROOT:-/srv/arken-space/media}"
SNAPSHOT_ID="${SNAPSHOT_ID:-latest}"
RESTORE_ROOT="$(mktemp -d)"
trap 'rm -rf "$RESTORE_ROOT"' EXIT

restic restore "$SNAPSHOT_ID" --tag arken-space --target "$RESTORE_ROOT"
DUMP_FILE="$(find "$RESTORE_ROOT" -type f -name 'arken-*.dump' | sort | tail -n 1)"
RESTORED_MEDIA="$RESTORE_ROOT$MEDIA_ROOT"

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Database dump was not found in the restored snapshot" >&2
  exit 1
fi
if [ ! -d "$RESTORED_MEDIA" ]; then
  echo "Media directory was not found in the restored snapshot" >&2
  exit 1
fi

pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP_FILE"
mkdir -p "$MEDIA_ROOT"
rsync -a --delete "$RESTORED_MEDIA/" "$MEDIA_ROOT/"

echo "Database and media restored from restic snapshot $SNAPSHOT_ID"
