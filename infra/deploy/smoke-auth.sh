#!/usr/bin/env sh
set -eu

umask 077

PRODUCTION_APP_ROOT=/home/uixray/apps/arken-space
PRODUCTION_DOMAIN=https://arken-khar.space

: "${APP_ROOT:?APP_ROOT обязателен}"
: "${DOMAIN:?DOMAIN обязателен}"
: "${EXPECTED_BUILD_REVISION:?EXPECTED_BUILD_REVISION обязателен}"
: "${EXPECTED_SCHEMA_VERSION:?EXPECTED_SCHEMA_VERSION обязателен}"

[ "$APP_ROOT" = "$PRODUCTION_APP_ROOT" ] || {
  echo 'auth-smoke-error=APP_ROOT не совпадает с production path' >&2
  exit 1
}
[ "$DOMAIN" = "$PRODUCTION_DOMAIN" ] || {
  echo 'auth-smoke-error=DOMAIN не совпадает с production origin' >&2
  exit 1
}

SMOKE_APP_ROOT="$APP_ROOT"
SMOKE_DOMAIN="${DOMAIN%/}"
SMOKE_EXPECTED_BUILD_REVISION="$EXPECTED_BUILD_REVISION"
SMOKE_EXPECTED_SCHEMA_VERSION="$EXPECTED_SCHEMA_VERSION"

# Параметры проверяемой выкладки приходят из release.sh и не должны быть
# незаметно заменены одноимёнными строками из application env.
APP_ROOT="$SMOKE_APP_ROOT"
DOMAIN="$SMOKE_DOMAIN"
EXPECTED_BUILD_REVISION="$SMOKE_EXPECTED_BUILD_REVISION"
EXPECTED_SCHEMA_VERSION="$SMOKE_EXPECTED_SCHEMA_VERSION"
export APP_ROOT DOMAIN EXPECTED_BUILD_REVISION EXPECTED_SCHEMA_VERSION

SESSION_COOKIE_NAME=arken_session
export SESSION_COOKIE_NAME

AUTH_CORE="$APP_ROOT/infra/deploy/auth-smoke-core.mjs"
RELEASE_CORE="$APP_ROOT/infra/deploy/release-core.mjs"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/arken-auth-smoke.XXXXXX")"
HEADERS="$WORK/login-headers"
COOKIE="$WORK/session-cookie"
BODY="$WORK/response-body"
PAYLOAD="$WORK/login-payload"
SESSION_ACTIVE=0

cleanup() {
  status=$1
  trap - EXIT HUP INT TERM
  if [ "$SESSION_ACTIVE" = "1" ] && [ -s "$COOKIE" ]; then
    curl -sS --max-time 10 --cookie "$COOKIE" --request POST \
      --header "Origin: $DOMAIN" \
      "$DOMAIN/api/auth/logout" >/dev/null 2>&1 || :
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap 'cleanup $?' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

node "$RELEASE_CORE" write-auth-payload \
  "$APP_ROOT/.env" "$PAYLOAD" "$APP_ROOT" "$DOMAIN"

STATUS="$(curl -sS \
  --max-time 30 \
  --output "$BODY" \
  --dump-header "$HEADERS" \
  --cookie-jar "$COOKIE" \
  --write-out '%{http_code}' \
  --header "Origin: $DOMAIN" \
  --header 'Content-Type: application/json' \
  --data-binary "@$PAYLOAD" \
  "$DOMAIN/api/auth/gm")"

if [ "$STATUS" = "200" ]; then
  SESSION_ACTIVE=1
fi
printf 'login-status=%s\n' "$STATUS"
if [ "$STATUS" != "200" ]; then
  echo 'auth-smoke-error=login-http-status' >&2
  exit 1
fi
node "$AUTH_CORE" validate-login-headers "$HEADERS"

DIAGNOSTICS_STATUS="$(curl -sS \
  --max-time 30 \
  --output "$BODY" \
  --write-out '%{http_code}' \
  --cookie "$COOKIE" \
  "$DOMAIN/api/diagnostics")"
printf 'diagnostics-http-status=%s\n' "$DIAGNOSTICS_STATUS"
if [ "$DIAGNOSTICS_STATUS" != "200" ]; then
  echo 'auth-smoke-error=diagnostics-http-status' >&2
  exit 1
fi
node "$AUTH_CORE" validate-diagnostics "$BODY"

LOGOUT_STATUS="$(curl -sS \
  --max-time 15 \
  --output "$BODY" \
  --write-out '%{http_code}' \
  --cookie "$COOKIE" \
  --request POST \
  --header "Origin: $DOMAIN" \
  "$DOMAIN/api/auth/logout")"
printf 'logout-status=%s\n' "$LOGOUT_STATUS"
if [ "$LOGOUT_STATUS" != "200" ]; then
  echo 'auth-smoke-error=logout-http-status' >&2
  exit 1
fi
node "$AUTH_CORE" validate-logout "$BODY"

POST_LOGOUT_DIAGNOSTICS_STATUS="$(curl -sS \
  --max-time 15 \
  --output "$BODY" \
  --write-out '%{http_code}' \
  --cookie "$COOKIE" \
  "$DOMAIN/api/diagnostics")"
printf 'post-logout-diagnostics-http-status=%s\n' "$POST_LOGOUT_DIAGNOSTICS_STATUS"
if [ "$POST_LOGOUT_DIAGNOSTICS_STATUS" != "401" ]; then
  echo 'auth-smoke-error=logout-did-not-invalidate-session' >&2
  exit 1
fi
node "$AUTH_CORE" validate-logged-out-diagnostics "$BODY"
SESSION_ACTIVE=0
