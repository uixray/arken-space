#!/usr/bin/env sh
set -eu

cd /home/uixray/apps/arken-space
sudo -n docker compose config --quiet
sudo -n docker compose up -d --build
sudo -n docker compose ps -a
