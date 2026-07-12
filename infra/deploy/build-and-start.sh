#!/usr/bin/env sh
set -eu

cd /home/uixray/apps/arken-space
BUILD_REVISION="$(cat .deployed-commit 2>/dev/null || echo unknown)"
export BUILD_REVISION
sudo -n docker compose config --quiet
sudo -n docker compose up -d --build
sudo -n docker compose ps -a
