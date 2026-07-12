#!/usr/bin/env sh
set -eu

cd /home/uixray/apps/arken-space
BUILD_REVISION="$(cat .deployed-commit 2>/dev/null || echo unknown)"
export BUILD_REVISION
sudo -n env BUILD_REVISION="$BUILD_REVISION" docker compose config --quiet
sudo -n env BUILD_REVISION="$BUILD_REVISION" docker compose up -d --build
sudo -n env BUILD_REVISION="$BUILD_REVISION" docker compose ps -a
