#!/usr/bin/env sh
set -eu

if [ "${ARKEN_RESTORE_CONFIRM:-}" != "isolated-clean-target" ]; then
  echo "Refusing restore: set ARKEN_RESTORE_CONFIRM=isolated-clean-target" >&2
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"
exec node scripts/run-restore-rehearsal.mjs
