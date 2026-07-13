# Production host reboot verification — 2026-07-13

## Result

Passed after expanding the production disk and changing the intended service set.

- Kernel: `6.8.0-134-generic`.
- Memory: 3.8 GiB total, 3.1 GiB available immediately after verification.
- Swap: 2 GiB total, unused.
- Root filesystem: 39 GiB total, 12 GiB used, 27 GiB available (31%).
- Arken Space health: application and database `ok`, build `0.2.0`, revision `d6a224b`, schema 2.
- PostgreSQL and server containers returned healthy; the web container returned running.
- `https://uixray.tech` returned HTTP 200.
- Figma AI proxy and Figma/Linear MCP health returned HTTP 200; `linear-webhook` returned under PM2.
- `arken-space-backup.timer` returned enabled and active.
- Jellyfin, AI Design Ops and Redis returned disabled and inactive as intended.

## Observed only

`amnezia-awg` remained in its pre-existing restart loop. It was not modified.

## Remaining foundation gate

Run a 30–45 minute human rehearsal with one GM and six independent player profiles, then record only reproducible blocking, consistency, security or data-loss defects before starting the UX backlog.
