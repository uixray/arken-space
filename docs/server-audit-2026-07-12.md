# Server audit — 2026-07-12

Host: `51.250.26.16` (`uixray`)

This document records the read-only pre-deployment audit for `arken-space`. It intentionally contains no passwords, tokens, private keys or environment values.

## Verdict

The server can run the first `arken-space` test for one GM and 5–6 players. Production deployment should wait until DNS/TLS, storage limits and backup tooling are addressed.

## Current capacity

- Ubuntu 24.04.4 LTS, kernel 6.8.
- 2 vCPU.
- 1.9 GiB RAM; about 1 GiB available during the audit.
- 2 GiB swap.
- 19 GiB root filesystem; 8.9 GiB available.
- Docker 29.2.1 and Docker Compose 5.1.0 installed; daemon active.
- nginx 1.24 active.
- Certbot 2.9 installed.
- Ports `4100`, `4180` and `5432` were free.
- User `uixray` has non-interactive sudo, but does not have direct access to the Docker socket. Deployment commands must use `sudo docker ...`.

## Blocking issues before production

### Storage

Only 8.9 GiB was free. The original application policy reserves 5 GiB of free space and permits a 5 GiB media library, which cannot work safely on the current disk.

Preferred fix: expand the disk to at least 30 GiB; 40–50 GiB is a safer target.

Temporary first-test limits if the disk is not expanded:

```env
MEDIA_QUOTA_BYTES=2147483648
MIN_FREE_DISK_BYTES=2147483648
```

### Memory

Two GiB RAM is acceptable for a small test, but leaves little headroom alongside Jellyfin, Next.js, Uvicorn and other Node services. Four GiB is recommended for stable operation. Jellyfin transcoding must not run during a game on the current machine.

### DNS and TLS

- `arken.uixray.tech` had no resolvable DNS A record during the audit.
- No Let's Encrypt certificate existed for `arken.uixray.tech`.
- Create `A arken.uixray.tech -> 51.250.26.16`, obtain a certificate and enable the project nginx virtual host.
- The existing nginx architecture uses public `443` with internal TLS virtual hosts on `127.0.0.1:4430`; the supplied arken configuration is compatible with that pattern.

### Backup and restore tooling

- `restic` was not installed.
- `pg_dump` was not installed on the host.
- `rsync` 3.2.7 was installed.

Install restic and the PostgreSQL client, or run backup from a dedicated container. A remote backup is not considered ready until database and media have both been restored into a clean environment.

### Existing service issue

The Docker container `amnezia-awg` was continuously restarting with exit code 1. It appears VPN-related and was not modified during the audit, but its failure should be diagnosed separately because it can create log churn and unexpected resource use.

## Existing services observed

- nginx on ports 80/443 and internal 4430.
- Jellyfin on 8096.
- portfolio/Next.js on 3000.
- proxy-related Node services on 3001, 3002 and 3003.
- Uvicorn service on 8001 for `ai.uixray.tech`.
- Redis on localhost 6379.
- VPN-related listeners on UDP 51820 and localhost 8443.
- Existing nginx hosts: `uixray.tech`, `media.uixray.tech`, `proxy.uixray.tech`, `ai.uixray.tech`.

## Service cleanup performed

At the user's request, non-VPN and non-proxy application processes were stopped after their ownership was verified.

Stopped:

- `jellyfin.service`;
- `ai-design-ops.service`;
- `redis-server.service` — no active clients or required dependants were present;
- PM2 process `uixray-portfolio`.

Kept running:

- nginx;
- Docker/containerd;
- UDP VPN listener on `51820` and the Amnezia-related container;
- `mtg.service` Telegram proxy;
- PM2 proxy processes `figma-ai-proxy`, `linear-webhook` and `figma-linear-mcp`;
- SSH and normal system services.

After cleanup, available memory increased from approximately 1.0 GiB to 1.4 GiB and swap usage dropped from 166 MiB to 58 MiB. Ports `3000`, `6379`, `8001` and `8096` stopped listening; proxy ports `3001–3003` and public nginx ports `80/443` remained active.

The stopped systemd units were not disabled, and the PM2 saved startup list was not modified. They may return after a host reboot. Permanent autostart changes should be made separately after confirming that the services are no longer needed.

## Recommended production order

1. Expand disk and preferably RAM.
2. Repair or deliberately retire the restarting VPN container.
3. Create DNS record and TLS certificate.
4. Configure production secrets and reduced media limits if necessary.
5. Deploy with `sudo docker compose up -d --build`.
6. Verify migrations, `/healthz`, `/api/diagnostics`, Socket.IO and Range responses.
7. Restart containers and verify persistence.
8. Configure remote restic backup and rehearse full restore.
9. Run the seven-client scenario before adding optional GM tools.

## Deployment status — 2026-07-12

`arken-space` was deployed after the initial audit.

- DNS `arken.uixray.tech` resolves to `51.250.26.16`.
- Application directory: `/home/uixray/apps/arken-space`.
- Persistent data directory: `/home/uixray/apps/arken-space-data`.
- Production secrets were generated on the host and stored in `.env` with mode `600`.
- Temporary media quota and free-space floor are both 2 GiB.
- PostgreSQL 17, Fastify server and nginx web containers are running with `unless-stopped` restart policy.
- Drizzle migrations completed against real PostgreSQL.
- Public `/healthz` reports database `ok`, build `0.2.0` and schema `2`.
- HTTP redirects to HTTPS; the TLS certificate is valid through 2026-10-10 and Certbot renewal is scheduled.
- Certbot simulated renewal completed successfully with `--dry-run --no-random-sleep-on-renew`.
- Public frontend, Socket.IO polling/upgrade advertisement and authenticated diagnostics passed smoke checks.
- Production cookies were verified as `HttpOnly`, `Secure` and `SameSite=Strict`.
- PostgreSQL, server and web survived a Compose restart; campaign, membership and scene counts were preserved.
- `restic` and PostgreSQL client tools were installed.
- Initial local database dump: `/home/uixray/apps/arken-space-data/backups/initial-production.dump`, mode `600`.

Still pending:

- configure an external restic/S3-compatible repository and perform a clean restore rehearsal;
- expand the disk before using the original 5 GiB media allowance;
- run the seven-client game/security scenario;
- reboot into the pending Ubuntu kernel update and re-check services. The deliberately stopped Jellyfin, AI Design Ops, Redis and portfolio units may return after reboot because their autostart was not disabled.
