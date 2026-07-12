#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

BACKUP_ROOT="${BACKUP_ROOT:-/srv/arken-space/backups}"
MEDIA_ROOT="${MEDIA_ROOT:-/srv/arken-space/media}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_ROOT"

pg_dump "$DATABASE_URL" --format=custom --file="$BACKUP_ROOT/arken-$STAMP.dump"
restic backup "$BACKUP_ROOT/arken-$STAMP.dump" "$MEDIA_ROOT" --tag arken-space
restic forget --tag arken-space --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
find "$BACKUP_ROOT" -name 'arken-*.dump' -mtime +2 -delete
