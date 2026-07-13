# arken-space delivery roadmap

The project remains a private VTT for one custom system and one regular group. Work is ordered by risk reduction, not by feature count. Multi-level maps, isometric rendering, 3D, a world library and additional music features remain deferred until the first real two-hour game succeeds.

## Current baseline — concept vertical slice

Implemented locally:

- browser application, GM/player sessions and one-time invitations;
- PostgreSQL schema and migrations;
- orthographic scenes, grid, tokens, ownership and rectangular fog;
- character sheets, server-side dice and role-filtered chat;
- image/audio storage constraints, synchronized music contracts;
- Compose/nginx/backup configuration;
- durable command journal with action IDs, atomic state/event transactions, revisions and snapshot versions;
- role-filtered snapshots and realtime authorization regression tests;
- database-aware health, authenticated diagnostics and sanitized browser logs;
- tested HTTP Range parsing and restic restore of both PostgreSQL and media;
- typecheck, lint, build, 25 local tests, migration execution in PGlite and a mocked concept E2E.
- isolated Docker/Playwright multiplayer scenario with one GM and six clean player browser contexts, real PostgreSQL/nginx, adversarial visibility checks, a 20-second network outage and backend restart recovery.

This baseline is not production-ready until the following sessions are completed in order.

## Deferred but mandatory before the first full game

The following production tasks are deliberately deferred while core development continues. They remain release gates and must not disappear from planning:

- configure a remote S3-compatible restic repository (Yandex setup guide, Compose-aware dump runner, manifests, retention and timer templates are now prepared locally; real credentials and initialization are pending);
- restore PostgreSQL and the complete media directory into a clean environment (a guarded, portless arken-restore-* Compose runner is prepared locally; the real remote snapshot rehearsal is still pending);
- run a 30–45 minute human rehearsal with seven independent browser profiles and record concrete defects;
- expand the server disk before restoring the original 5 GiB media allowance;
- perform the pending kernel reboot, confirm arken auto-recovery and verify that deliberately stopped Jellyfin, portfolio, AI Design Ops and Redis services stay in the intended state.

These tasks are postponed, not cancelled. The two-hour session cannot be marked ready until they pass.

## Current stability iteration — playtest findings

The first production walkthrough produced a prioritized backlog in [playtest-feedback-2026-07-13.md](./playtest-feedback-2026-07-13.md).

Work order:

1. P0: reproduce and fix a player moving another player's token.
2. Confirm authoritative rollback, reconnect and production build identity.
3. P1: fog re-covering, token image assignment, character portraits, grouped hover labels and chat quick dice.
4. P2: move music into the sidebar and replace the bottom bar with an agreed token palette.

No P1/P2 item may delay or obscure the P0 authorization investigation.

P0 is complete. The narrow GM + 2 smoke is recorded in [multiplayer-smoke-2026-07-13.md](./multiplayer-smoke-2026-07-13.md). The full isolated GM + 6 security/recovery gate passed in [multiplayer-e2e-2026-07-13.md](./multiplayer-e2e-2026-07-13.md); it does not replace the pending human rehearsal.

## Session 2 — production and observability

Goal: prove that production matches the local architecture and leaves enough evidence to diagnose failures.

- Run the actual Drizzle migration against production PostgreSQL.
- Verify data and media persistence after container restart and host reboot.
- Verify Socket.IO upgrade and fallback through nginx and HTTPS.
- Inspect `Secure`, `HttpOnly` and `SameSite=Strict` cookies in a real browser.
- Verify nginx and Fastify upload limits agree.
- Upload and seek through a near-limit MP3/OGG using HTTP Range (`206`, `Content-Range`, invalid `416`).
- Suspend and restore a browser tab; verify reconnect or explicit full resync.
- Emit structured server logs with request ID, membership ID, action ID, event sequence and rejection reason.
- Accept sanitized client diagnostics and expose build/schema/snapshot versions in the UI.
- Commit and upload the prepared backup/restore harness, run a real restic backup to remote S3-compatible storage, then restore database and media into its clean isolated Compose project.

Exit criterion: `arken.uixray.tech` survives restart, restores from backup and provides actionable logs.

## Session 3 — seven-client game scenario and security

Goal: produce a concrete defect list from a realistic session.

Automated status: passed from commit 1d907b2 with no product realtime/security defect reproduced. Two harness defects were fixed before the successful run; see [multiplayer-e2e-2026-07-13.md](./multiplayer-e2e-2026-07-13.md).

1. GM creates six character-bound invitations.
2. Six independent browser profiles claim them.
3. Several players move different tokens while the GM moves an NPC.
4. GM edits fog and switches the active scene.
5. Players send chat messages and rolls concurrently.
6. One player reloads, one loses connectivity for 20–30 seconds, one joins late.
7. Backend restarts and every client reconciles to the authoritative state.

Security assertions use browser DevTools plus direct API/Socket.IO clients. A player must never receive:

- hidden tokens or inactive scene payloads;
- GM-only messages or rolls;
- another character's private sheet/notes;
- asset records belonging only to hidden scenes;
- unrevealed fog geometry or GM preview state.

Exit criterion: timestamped defect report with reproduction steps, expected/actual state and relevant request/action IDs.

## Session 4 — realtime correction

Goal: fix only reproduced consistency failures.

Foundation present before the test:

- monotonic server event sequence and `snapshotVersion`;
- client-generated `actionId` for durable commands;
- unique action receipt/idempotency guarantee;
- object revision checked on every mutation;
- structured acknowledgement containing accepted/rejected status, sequence and authoritative entity;
- ephemeral drag separate from durable drag completion;
- explicit `game:resync` and full state replacement;
- visible states: online, reconnecting, resyncing and offline.

Likely defects to investigate: stale token snapback, duplicate events after reconnect, stale active scene, conflicting edits, obsolete subscriptions and music drift after sleep.

Exit criterion: every reproduced defect has an automated regression test or a documented reason it cannot be automated.

## Session 5 — minimum GM tools

Only after sessions 2–4 pass:

1. Preview the active scene as a selected player.
2. Undo the latest fog reveal.
3. Ephemeral map ping visible to the current scene.

Distance measurement is added only if the custom rules require exact ranges. Do not add general undo/redo, token marker systems, isometric rendering, multi-level scenes, extended libraries or new music features.

## Session 6 — rehearsal and first game

- Build a real campaign with real maps, audio and six characters.
- Run a 30–45 minute rehearsal with clean browser profiles.
- Verify current Firefox, Chrome and Edge.
- Fix only defects capable of blocking or corrupting the game.
- Run the two-hour session and record preparation time, interruptions, recoveries and every external tool used.

## Acceptable shortcuts before the first game

- modest duplication, temporary limits, rough naming and manual operational steps;
- fixed custom-system fields and simple data models.

## Unacceptable changes before the first game

- framework replacement or speculative realtime rewrite;
- broad refactor without a reproduced failure;
- database change without a tested backup;
- multiple new major features in the same iteration;
- any work on multi-level, isometric or 3D rendering.
