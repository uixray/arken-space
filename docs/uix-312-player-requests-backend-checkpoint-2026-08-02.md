# UIX-312 player requests backend checkpoint — 2026-08-02

## Decisions

- Requests are durable campaign entities, independent of the recent chat window.
- MVP audience is immutable after submission: `PUBLIC` or `GM_ONLY`.
- Attachments and linked chat cards are deferred.
- Only PLAYER sessions create requests; optional characters must be owned or controlled in the same campaign.
- Authors edit only `SUBMITTED` requests and may cancel `SUBMITTED` or `ACKNOWLEDGED` requests.
- Campaign GMs acknowledge, resolve or decline; terminal states are immutable.
- `GM_ONLY` visibility is restricted to the author and every GM in the campaign across HTTP and snapshot projection.
- CAS revisions and actor/type/entity/payload-bound action IDs protect concurrent and duplicate actions.
- Audit event payloads contain only a command hash, never request content.

## Revision

Base: `20efcc4`.

## Changed files

- `packages/db/src/schema.ts`
- `packages/db/drizzle/0025_player_requests.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/contracts/src/index.ts`
- `apps/server/src/player-requests.ts`
- `apps/server/src/player-requests.test.ts`
- `apps/server/src/player-requests.integration.test.ts`
- `apps/server/src/routes.ts`
- `apps/server/src/snapshot.ts`
- `tests/migration.test.ts`
- `docs/uix-312-player-requests-backend-checkpoint-2026-08-02.md`

## Verification

- player-request unit, route integration and migration tests: 20/20 PASS
- contracts typecheck: PASS
- database typecheck: PASS
- server typecheck: PASS
- `git diff --check`: PASS

Broad regression, lint, production build, Docker multiplayer and browser QA remain deferred by user request.

## Blockers

- Realtime recipient-scoped delivery and counters are not implemented.
- Player/GM request UI and browser QA are not implemented.
- Attachments and linked chat cards require later product scope decisions.

## Next action

Commit the backend/domain pool, keep UIX-312 In Progress, then implement recipient-safe realtime delivery before the UI.
---

## Recipient-safe realtime pool

### Decisions

- `PUBLIC` changes are emitted to the campaign room.
- `GM_ONLY` changes use one Socket.IO union target for the campaign GM room and author member room; the campaign room never receives private DTOs.
- Events are emitted only after a successful committed mutation and canonical DTO projection; replay, validation and CAS failures emit nothing.
- The client silently upserts only newer revisions and shows no notification preview.
- Snapshot reconciliation preserves newer realtime revisions and request entries absent from an older incoming snapshot; requests have no delete operation in this MVP.

### Revision

Base: `3498930`.

### Changed files

- `packages/contracts/src/index.ts`
- `apps/server/src/player-requests.ts`
- `apps/server/src/player-requests.integration.test.ts`
- `apps/server/src/routes.ts`
- `apps/web/src/player-request-realtime.ts`
- `apps/web/src/player-request-realtime.test.ts`
- `apps/web/src/character-mutation.ts`
- `apps/web/src/App.tsx`
- `docs/uix-312-player-requests-backend-checkpoint-2026-08-02.md`

### Verification

- realtime, reconciliation and source-encoding tests: 17/17 PASS
- contracts/server/web typecheck: PASS
- `git diff --check`: PASS

### Blockers

- The request composer and GM/player request workspace are not implemented.
- Browser and real multiplayer QA remain deferred.

### Next action

Commit the realtime pool, then build the minimal request UI without attachments or linked chat cards.