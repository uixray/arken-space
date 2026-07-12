#!/usr/bin/env sh
set -eu

APP=/home/uixray/apps/arken-space
DOMAIN=https://arken.uixray.tech
HEADERS=/tmp/arken-login-headers
COOKIE=/tmp/arken-cookie
BODY=/tmp/arken-login-body

cd "$APP"
set -a
. ./.env
set +a

PAYLOAD="$(printf '{\"token\":\"%s\"}' "$GM_ACCESS_TOKEN")"
STATUS="$(curl -sS \
  --output "$BODY" \
  --dump-header "$HEADERS" \
  --cookie-jar "$COOKIE" \
  --write-out '%{http_code}' \
  --header "Origin: $DOMAIN" \
  --header 'Content-Type: application/json' \
  --data "$PAYLOAD" \
  "$DOMAIN/api/auth/gm")"

echo "login-status=$STATUS"
test "$STATUS" = "200"
grep -qi 'HttpOnly' "$HEADERS" && echo 'cookie-http-only=yes'
grep -qi 'Secure' "$HEADERS" && echo 'cookie-secure=yes'
grep -qi 'SameSite=Strict' "$HEADERS" && echo 'cookie-samesite-strict=yes'
curl -fsS --cookie "$COOKIE" "$DOMAIN/api/diagnostics"
echo

rm -f "$BODY" "$HEADERS" "$COOKIE"
