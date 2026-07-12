#!/usr/bin/env sh
set -eu

APP=/home/uixray/apps/arken-space
DATA=/home/uixray/apps/arken-space-data
ARCHIVE=/home/uixray/arken-space-deploy.tar.gz

mkdir -p "$APP" "$DATA/media"
tar -xzf "$ARCHIVE" -C "$APP"

if [ ! -f "$APP/.env" ]; then
  umask 077
  DB_SECRET="$(openssl rand -hex 32)"
  GM_SECRET="$(openssl rand -hex 32)"
  printf '%s\n' \
    'COMPOSE_PROJECT_NAME=arken-space' \
    'APP_VERSION=0.2.0' \
    'WEB_ORIGIN=https://arken.uixray.tech' \
    'PUBLIC_URL=https://arken.uixray.tech' \
    "POSTGRES_PASSWORD=$DB_SECRET" \
    "GM_ACCESS_TOKEN=$GM_SECRET" \
    'MEDIA_HOST_PATH=/home/uixray/apps/arken-space-data/media' \
    'MEDIA_QUOTA_BYTES=2147483648' \
    'MIN_FREE_DISK_BYTES=2147483648' \
    > "$APP/.env"
fi

chmod 600 "$APP/.env"
rm -f "$ARCHIVE"

echo bundle-ready
grep -E '^(APP_VERSION|WEB_ORIGIN|PUBLIC_URL|MEDIA_HOST_PATH|MEDIA_QUOTA_BYTES|MIN_FREE_DISK_BYTES)=' "$APP/.env"
