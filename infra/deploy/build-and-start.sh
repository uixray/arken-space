#!/usr/bin/env sh
set -eu

cd /home/uixray/apps/arken-space
BUILD_REVISION="${EXPECTED_BUILD_REVISION:?Set EXPECTED_BUILD_REVISION to the reviewed 40-character commit SHA}"
case "$BUILD_REVISION" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
  *) echo "EXPECTED_BUILD_REVISION must be a lowercase 40-character commit SHA" >&2; exit 1 ;;
esac
test "$(git rev-parse HEAD)" = "$BUILD_REVISION" || {
  echo "Checkout does not match EXPECTED_BUILD_REVISION" >&2
  exit 1
}
test -z "$(git status --porcelain --untracked-files=normal)" || {
  echo "Production checkout is not clean" >&2
  exit 1
}
test "${VERIFIED_BACKUP_SNAPSHOT_ID:?Set the exact fresh verified restic snapshot ID}" != latest
test "${RESTORE_REHEARSAL_REVISION:?Set the exact revision from the passing restore rehearsal}" = "$BUILD_REVISION"
test "${EXPECTED_SCHEMA_VERSION:?Set EXPECTED_SCHEMA_VERSION}" = 2
export BUILD_REVISION
sudo -n env BUILD_REVISION="$BUILD_REVISION" docker compose config --quiet
sudo -n env BUILD_REVISION="$BUILD_REVISION" docker compose up -d --build
sudo -n env BUILD_REVISION="$BUILD_REVISION" docker compose ps -a
