# Delivery tasks

Status as of 2026-07-14: the deployed foundation, remote backup, clean restore, disk expansion, host reboot recovery and automated GM + 6 security/recovery gates work. The shortened human rehearsal is accepted only for the foundation. Full product acceptance is deferred to UIX-217 after the approved backlog is implemented.

## Planning artifacts

- [Approved implementation plan](./docs/implementation-plan-2026-07-14.md)
- [Accepted architecture decisions](./docs/architecture-decisions-2026-07-14.md)
- [Terra execution log](./docs/terra-execution-log.md)
- [Recorded foundation debt](./.workspace/tech_debt.md)

## Foundation record

- [x] [UIX-196 — Workspace, rules contract and architecture](https://linear.app/uixraydesign/issue/UIX-196/arken-space-workspace-rules-contract-and-architecture)
- [x] [UIX-197 — Campaign access and PostgreSQL foundation](https://linear.app/uixraydesign/issue/UIX-197/arken-space-campaign-access-and-postgresql-foundation)
- [x] [UIX-198 — Realtime 2D map, tokens and fog](https://linear.app/uixraydesign/issue/UIX-198/arken-space-realtime-2d-map-tokens-and-fog)
- [x] [UIX-199 — Character sheets, chat and dice](https://linear.app/uixraydesign/issue/UIX-199/arken-space-character-sheets-chat-and-dice)
- [x] [UIX-200 — Media library and synchronized music](https://linear.app/uixraydesign/issue/UIX-200/arken-space-media-library-and-synchronized-music)
- [ ] [UIX-201 — Hardening, deployment and game-night verification](https://linear.app/uixraydesign/issue/UIX-201/arken-space-hardening-deployment-and-game-night-verification) — in progress; close only as foundation hardening.

The checked foundation rows record repository delivery. This planning pass did not change UIX-196 through UIX-200 states in Linear; each issue still requires explicit acceptance reconciliation before Linear closure.

## Approved product delivery

### Ready

- [ ] [UIX-206 — Close foundation verification and planning baseline](https://linear.app/uixraydesign/issue/UIX-206/arken-space-close-foundation-verification-and-planning-baseline)

### Access and core data

- [ ] [UIX-207 — Persistent player access and safe gameplay reset](https://linear.app/uixraydesign/issue/UIX-207/arken-space-persistent-player-access-and-safe-gameplay-reset) — blocked by UIX-206.
- [ ] [UIX-208 — Token definitions, scene placements and multi-controller permissions](https://linear.app/uixraydesign/issue/UIX-208/arken-space-token-definitions-scene-placements-and-multi-controller) — blocked by UIX-207.
- [ ] [UIX-209 — Character sheet v2 and shared skill/ability catalog](https://linear.app/uixraydesign/issue/UIX-209/arken-space-character-sheet-v2-and-shared-skillability-catalog) — blocked by UIX-207.

### Rules and campaign state

- [ ] [UIX-210 — Generic roll actions and auditable chat results](https://linear.app/uixraydesign/issue/UIX-210/arken-space-generic-roll-actions-and-auditable-chat-results) — blocked by UIX-209.
- [ ] [UIX-211 — Campaign clock, cooldowns, resources and wallet](https://linear.app/uixraydesign/issue/UIX-211/arken-space-campaign-clock-cooldowns-resources-and-wallet) — blocked by UIX-209.

### Canvas authority and tools

- [ ] [UIX-212 — Authoritative canvas undo and redo](https://linear.app/uixraydesign/issue/UIX-212/arken-space-authoritative-canvas-undo-and-redo) — blocked by UIX-208.
- [ ] [UIX-213 — Canvas visibility layers and ordered fog operations](https://linear.app/uixraydesign/issue/UIX-213/arken-space-canvas-visibility-layers-and-ordered-fog-operations) — blocked by UIX-212.
- [ ] [UIX-214 — Persistent drawings, shared ruler and map navigation controls](https://linear.app/uixraydesign/issue/UIX-214/arken-space-persistent-drawings-shared-ruler-and-map-navigation) — blocked by UIX-212 and UIX-213.

### Product workflows

- [ ] [UIX-215 — Token palette, asset assignment and scene token workflows](https://linear.app/uixraydesign/issue/UIX-215/arken-space-token-palette-asset-assignment-and-scene-token-workflows) — blocked by UIX-208 and UIX-213.
- [ ] [UIX-216 — Session shell, membership presence and GM audio controls](https://linear.app/uixraydesign/issue/UIX-216/arken-space-session-shell-membership-presence-and-gm-audio-controls) — blocked by UIX-207 and UIX-210.

### Release gate

- [ ] [UIX-217 — Full product GM + 6 acceptance rehearsal](https://linear.app/uixraydesign/issue/UIX-217/arken-space-full-product-gm-6-acceptance-rehearsal) — blocked by UIX-210, UIX-211, UIX-214, UIX-215 and UIX-216.

## Mandatory production gates

- [x] Encrypted remote restic repository and retention/check.
- [x] Clean restore of PostgreSQL and media with exact checksums/counts.
- [x] Automated GM + 6 adversarial and recovery scenario for the foundation.
- [x] Production disk expansion and host reboot recovery.
- [ ] Fresh verified backup before the approved schema migration/gameplay reset.
- [ ] Isolated upgrade/reset/restore rehearsal for the approved schema.
- [ ] Full automated gates at the final deployed revision.
- [ ] 30–45 minute GM + 6 human product rehearsal in Chrome, Firefox and Edge.

## Deferred

- SP upgrade requests and GM approval workflow.
- Collaborative soundpad.
- Mobile canvas, offline mode, public registration and commerce.
- Multi-level, isometric and 3D rendering.
