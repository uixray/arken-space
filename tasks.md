# Delivery tasks

Local implementation status as of 2026-07-12: core code is ready for review; production deployment and the real multi-client game-night test still require server access.

- [x] [UIX-196 — Workspace, rules contract and architecture](https://linear.app/uixraydesign/issue/UIX-196/arken-space-workspace-rules-contract-and-architecture)
- [x] [UIX-197 — Campaign access and PostgreSQL foundation](https://linear.app/uixraydesign/issue/UIX-197/arken-space-campaign-access-and-postgresql-foundation) — code complete, runtime review pending
- [x] [UIX-198 — Realtime 2D map, tokens and fog](https://linear.app/uixraydesign/issue/UIX-198/arken-space-realtime-2d-map-tokens-and-fog) — concept E2E complete, live multi-client review pending
- [x] [UIX-199 — Character sheets, chat and dice](https://linear.app/uixraydesign/issue/UIX-199/arken-space-character-sheets-chat-and-dice)
- [x] [UIX-200 — Media library and synchronized music](https://linear.app/uixraydesign/issue/UIX-200/arken-space-media-library-and-synchronized-music) — browser/server integration review pending
- [ ] [UIX-201 — Hardening, deployment and game-night verification](https://linear.app/uixraydesign/issue/UIX-201/arken-space-hardening-deployment-and-game-night-verification)

## Deferred production gates

- [ ] Configure remote S3/restic backup storage.
- [ ] Restore database and media into a clean environment.
- [ ] Run the full seven-client game and adversarial security scenario.
- [ ] Expand the production disk and review media limits.
- [ ] Reboot into the pending kernel update and verify container/service recovery.

## Playtest backlog — 2026-07-13

- [ ] **P0:** reproduce and prevent a player moving another player's token.
- [ ] Allow one player membership to own multiple tokens; keep ownerless enemy/NPC tokens GM-only.
- [ ] Add rectangular fog re-covering; keep it separate from undo latest reveal.
- [ ] Add token image assignment.
- [ ] Add character portrait assignment.
- [ ] Move token label with its token and show it only on hover/focus.
- [ ] Add chat quick-roll buttons: d2, d4, d8, d12, d20.
- [ ] Move music controls into a sidebar tab.
- [ ] Define and implement the available-token bottom palette.
