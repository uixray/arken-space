# Production operations

This runbook is intentionally small. Every operation below must be rehearsed on a clean host before the first real game.

Current production host paths:

- application: `/home/uixray/apps/arken-space`;
- media: `/home/uixray/apps/arken-space-data/media`;
- local backups: `/home/uixray/apps/arken-space-data/backups`.

## Deploy and migrate

1. Set production values from `.env.example`; never use the development GM or PostgreSQL secrets.
2. Build and start with `docker compose up -d --build`.
3. The server container runs all pending PostgreSQL migrations before starting Fastify.
4. Check `https://arken.uixray.tech/healthz`. A healthy response includes database, build and schema versions.
5. Log in and compare `/api/diagnostics` with the expected release.

Do not change the database schema unless a current restic snapshot exists.

## Restart persistence check

1. Create a scene, token, chat message and character edit; note their values.
2. Run `docker compose restart postgres server web`.
3. Wait for the server healthcheck.
4. Reload a clean browser session and verify all noted state and uploaded media.

Verified 2026-07-13 after the production disk expansion: the host booted kernel `6.8.0-134-generic`; PostgreSQL and the Arken Space server returned healthy at build `d6a224b`, schema 2; the web container and portfolio returned; the PM2 Figma/Linear integrations and backup timer returned; Jellyfin, AI Design Ops and Redis remained deliberately disabled. The root filesystem reported 39 GiB total, 27 GiB available and 31% usage. See [host-reboot-2026-07-13.md](./host-reboot-2026-07-13.md).

## Backup

`infra/backup/backup.sh` reads PostgreSQL through the exact production Compose project, creates a custom-format dump, records its SHA-256 checksum, captures per-table row counts and records checksums for every media file. It sends the dump, manifests and media directory to the configured encrypted restic repository.

Required environment variables:

- `RESTIC_REPOSITORY`
- `RESTIC_PASSWORD_FILE` or `RESTIC_PASSWORD`
- S3 authentication variables required by the selected provider

Production uses the root-owned `/etc/arken-space/restic.env` and `/etc/arken-space/restic-password`, both mode `600`. Backup credentials must not be stored in the application `.env`. Start from `infra/backup/restic.env.example`.

Initialize a new repository once:

```sh
sudo sh -c 'set -a; . /etc/arken-space/restic.env; set +a; restic init'
```

Install the timer only after the first manual backup and restore rehearsal pass:

```sh
sudo install -m 644 infra/backup/arken-space-backup.service /etc/systemd/system/
sudo install -m 644 infra/backup/arken-space-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now arken-space-backup.timer
```

The timer runs daily at 03:15 server time with up to 15 minutes randomized delay. The retention policy keeps 7 daily, 4 weekly and 6 monthly snapshots and prunes unreferenced data.

Verified 2026-07-13: Yandex repository `e5eb7068a7` was initialized, snapshot `07bc8d52` stored 6.192 MiB, retention and `restic check` passed, and `arken-space-backup.timer` is enabled and active.

Run it daily from systemd timer or cron. Alert when the command exits non-zero or when no `arken-space` snapshot was created in 26 hours.

The exact Yandex bucket, IAM and current cost setup is documented in [yandex-object-storage-backup-2026-07-13.md](./yandex-object-storage-backup-2026-07-13.md).

## Restore rehearsal

Restore only from a committed Git archive and only into the dedicated clean Compose environment:

```sh
set -a
. /etc/arken-space/restic.env
set +a
export ARKEN_RESTORE_CONFIRM=isolated-clean-target
export RESTORE_BUILD_REVISION=<exact-committed-sha>
SNAPSHOT_ID=latest sh infra/backup/restore.sh
```

The runner rejects any Compose project name outside the `arken-restore-*` namespace. Its Compose file:

- publishes no host ports;
- creates a project-scoped PostgreSQL volume;
- mounts only media restored under a new temporary directory;
- never mounts production PostgreSQL, media or the Docker socket.

The runner:

1. checks production health and available disk;
2. validates the remote restic repository and selects one exact snapshot;
3. verifies dump and media SHA-256 manifests;
4. restores PostgreSQL into the clean volume;
5. compares all application table counts with the backup manifest;
6. starts the isolated server and verifies health, schema and exact build revision;
7. removes the Compose project, volume, local image and temporary restored data;
8. verifies no project resources remain, then rechecks production health and disk;
9. writes a JSON report to `test-results/restore/runner.json`.

Verified 2026-07-13: snapshot `07bc8d52` restored 8 media files and PostgreSQL into a clean isolated project. Dump/media checksums, all 12 table counts, application health at exact revision `5e7a42c`, resource cleanup, production health and disk checks passed.

Do not run `pg_restore` manually against production during a rehearsal.

## Logs needed for an incident

- nginx access and error logs;
- `docker compose logs server postgres web`;
- browser-generated `client.event` records from `/api/client-logs`;
- affected membership ID, action ID, snapshot version and approximate time.

Server logs must never contain session cookies, invitation tokens or uploaded file contents.

## Isolated multiplayer test

corepack pnpm test:multiplayer must never point at the production campaign. It creates a unique arken-e2e-* Compose project on localhost port 14180, uses isolated database/media volumes and removes containers and volumes in a finally cleanup step. Run it from a committed Git archive and pass that SHA as E2E_BUILD_REVISION so isolated health proves the tested build identity.

The runner rejects missing Docker access, less than 6 GiB free, a busy edge port, a non-healthy production endpoint or any WEB_ORIGIN/E2E_BASE_URL other than http://edge. It records JSON/JUnit plus retained failure traces under test-results/multiplayer, preserves the heavyweight Playwright image after an overall failure, removes local project images after success, verifies that no Compose containers/volumes remain, then checks production health and disk again.

The browser story covers one GM and six independent player contexts, late join, simultaneous token movement, foreign/enemy authorization, fog and scene visibility, concurrent chat/dice, reload, a 20-second browser network outage, backend restart and authoritative resync without duplicate entities. The Vitest realtime story separately covers all seven simultaneous Socket.IO clients and full resync.
