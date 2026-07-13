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

## Backup

`infra/backup/backup.sh` creates a custom-format PostgreSQL dump and sends both the dump and media directory to the configured remote restic repository.

Required environment variables:

- `DATABASE_URL`
- `RESTIC_REPOSITORY`
- `RESTIC_PASSWORD`

Run it daily from systemd timer or cron. Alert when the command exits non-zero or when no `arken-space` snapshot was created in 26 hours.

## Restore rehearsal

Restore only into an isolated clean environment during rehearsal:

```sh
SNAPSHOT_ID=latest ./infra/backup/restore.sh
```

The restore script replaces the target database and synchronizes the media directory to the selected restic snapshot. After restoration:

1. start the application;
2. check `/healthz` and `/api/diagnostics`;
3. open uploaded images and seek through a large audio file;
4. compare campaign, character, chat, token and fog state;
5. record snapshot ID, duration and result.

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
