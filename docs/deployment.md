# Deployment runbook

## Prerequisites

- DNS `arken-khar.space` points to the existing server.
- Docker Compose, nginx and a TLS certificate are available.
- At least 5 GB remains free after reserving application media.
- A private S3-compatible restic repository exists outside this host.

Use the fail-closed [production release checklist](./production-release-checklist.md)
for every release. The commands below are an overview, not substitute evidence.

## First deployment

1. Clone/copy the repository to `/home/uixray/apps/arken-space`.
2. Create `.env` from `.env.example`; generate strong `POSTGRES_PASSWORD`, `GM_ACCESS_TOKEN` and restic credentials.
3. Set `MEDIA_HOST_PATH=/home/uixray/apps/arken-space-data/media` and create that
   host directory with ownership for the Docker runtime. `/srv/arken-space/media`
   is the container mount target from `docker-compose.yml`, not a host path.
4. Create a fresh restic snapshot and pass an isolated restore rehearsal for the
   exact committed revision.
5. Export the exact revision, snapshot and schema evidence variables documented
   in the release checklist, then run `infra/deploy/build-and-start.sh`.
6. Install `infra/nginx/arken-khar.space.conf`, validate with `sudo nginx -t`, then reload nginx.
7. Open `https://arken-khar.space/gm/<GM_ACCESS_TOKEN>`. Store the master URL in a password manager.
8. Verify `/healthz`, authenticated diagnostics, WebSocket connection, upload and database persistence.

After the first deployment, use `infra/deploy/release.sh` as the routine path;
direct `build-and-start.sh` remains the evidence-gated first-deploy/fallback
procedure. The exact split between code, host and manual post-deploy gates is in
the release checklist.

## Backup

`infra/backup/backup.sh` запускается ночью через systemd timer. Обычный интервал
составляет около 24 часов и может достигать 24 часов 15 минут из-за случайной
задержки timer; незамеченная ошибка делает его неограниченным. Владелец ещё не
принимал этот риск как гарантированный RPO. До отдельного решения перед
**каждой реальной игровой сессией** обязательно запустите
`arken-space-backup.service` вручную и запишите snapshot ID из успешного лога.
Строгий постоянный RPO и мониторинг свежести бэкапа требуют отдельного
эксплуатационного гейта. Целевой RTO остаётся 30 минут. До первой настоящей игры
проведите репетицию восстановления.

## Rollback

Keep the previous image tags and database dump. Stop the new Compose stack, restore the last compatible dump if a migration changed data, then start the previous images.
