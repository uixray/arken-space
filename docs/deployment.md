# Deployment runbook

## Prerequisites

- DNS `arken.uixray.tech` points to the existing server.
- Docker Compose, nginx and a TLS certificate are available.
- At least 5 GB remains free after reserving application media.
- A private S3-compatible restic repository exists outside this host.

Use the fail-closed [production release checklist](./production-release-checklist.md)
for every release. The commands below are an overview, not substitute evidence.

## First deployment

1. Clone/copy the repository to `/opt/arken-space`.
2. Create `.env` from `.env.example`; generate strong `POSTGRES_PASSWORD`, `GM_ACCESS_TOKEN` and restic credentials.
3. Set `MEDIA_HOST_PATH=/srv/arken-space/media` and create the directory with ownership for the Docker runtime.
4. Create a fresh restic snapshot and pass an isolated restore rehearsal for the
   exact committed revision.
5. Export the exact revision, snapshot and schema evidence variables documented
   in the release checklist, then run `infra/deploy/build-and-start.sh`.
6. Install `infra/nginx/arken.uixray.tech.conf`, validate with `sudo nginx -t`, then reload nginx.
7. Open `https://arken.uixray.tech/gm/<GM_ACCESS_TOKEN>`. Store the master URL in a password manager.
8. Verify `/healthz`, authenticated diagnostics, WebSocket connection, upload and database persistence.

## Backup

Run `infra/backup/backup.sh` nightly with a systemd timer or cron. Recovery target: RPO 24 hours, RTO 30 minutes. Run a restore drill before the first real game.

## Rollback

Keep the previous image tags and database dump. Stop the new Compose stack, restore the last compatible dump if a migration changed data, then start the previous images.
