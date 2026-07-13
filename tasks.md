# Delivery tasks

Status as of 2026-07-13: production is deployed; the isolated GM + 6 multiplayer, adversarial visibility and backend recovery gate passes. Remote restic backup and clean restore rehearsal pass. Manual rehearsal, disk expansion and host reboot gates remain open.

- [x] [UIX-196 — Workspace, rules contract and architecture](https://linear.app/uixraydesign/issue/UIX-196/arken-space-workspace-rules-contract-and-architecture)
- [x] [UIX-197 — Campaign access and PostgreSQL foundation](https://linear.app/uixraydesign/issue/UIX-197/arken-space-campaign-access-and-postgresql-foundation) — code complete, runtime review pending
- [x] [UIX-198 — Realtime 2D map, tokens and fog](https://linear.app/uixraydesign/issue/UIX-198/arken-space-realtime-2d-map-tokens-and-fog) — concept E2E complete, live multi-client review pending
- [x] [UIX-199 — Character sheets, chat and dice](https://linear.app/uixraydesign/issue/UIX-199/arken-space-character-sheets-chat-and-dice)
- [x] [UIX-200 — Media library and synchronized music](https://linear.app/uixraydesign/issue/UIX-200/arken-space-media-library-and-synchronized-music) — browser/server integration review pending
- [ ] [UIX-201 — Hardening, deployment and game-night verification](https://linear.app/uixraydesign/issue/UIX-201/arken-space-hardening-deployment-and-game-night-verification)

## Deferred production gates

- [x] Configure remote S3/restic backup storage — encrypted Yandex repository initialized; snapshot `07bc8d52` passed retention and `restic check`; daily systemd timer is enabled and active.
- [x] Restore database and media into a clean environment — snapshot `07bc8d52` passed dump/media checksums, exact table counts, authoritative health at commit `5e7a42c`, resource cleanup and post-run production checks.
- [x] Run the full automated seven-client game, adversarial security and backend recovery scenario — [report](./docs/multiplayer-e2e-2026-07-13.md).
- [ ] Run a 30–45 minute human rehearsal with six independent player profiles.
- [ ] Expand the production disk and review media limits.
- [ ] Reboot into the pending kernel update and verify container/service recovery.

## Playtest backlog — 2026-07-13

- [x] **P0:** prevent a player moving another player's token at the API and Socket.IO boundaries.
- [x] Allow one player membership to own multiple tokens; keep ownerless enemy/NPC tokens GM-only.
- [ ] Add rectangular fog re-covering; keep it separate from undo latest reveal.
- [ ] Add token image assignment.
- [ ] Add character portrait assignment.
- [ ] Move token label with its token and show it only on hover/focus.
- [ ] Add chat quick-roll buttons: d2, d4, d8, d12, d20.
- [ ] Move music controls into a sidebar tab.
- [ ] Define and implement the available-token bottom palette.
