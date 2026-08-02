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