# Server route/domain extraction proposal — 2026-10-08

## Scope and decision

Recommend the **character archive lifecycle** as the next bounded server extraction: `GET /api/characters/archived`, `POST /api/characters/:id/archive`, and `POST /api/characters/:id/restore` (currently `apps/server/src/routes.ts`, approximately lines 1715–1988 at review time).

This is an architecture proposal only. No source edits, Linear mutations, server start, deployment, or performance claims. `routes.ts` is 8,732 lines / 334,849 bytes at the reviewed checkout (`2989381e7d6bd2d60094766cd039edc97fc0e6a5`).

## Why this family

- Three adjacent endpoints form a complete lifecycle: GM-only archived roster, archive transition, restore transition.
- Existing behavior and invariants are unusually well bounded and already documented at the route declarations; the focused `apps/server/src/character-archive.integration.test.ts` exercises full HTTP registration against migrated PGlite.
- Route families are already modularized through `register*Routes` in `routes.ts` (for example `world-map-routes.ts`, `story.ts`, `character-media.ts`, and `sticker-pack-admin.ts`). This can follow the established composition seam.
- It trims a meaningful coherent unit without reopening the recently changed story/chat locking domains or touching the active frontend/App.tsx pool.
- The completed Linear item UIX-393 is the lifecycle feature's source context, not permission to update it. UIX-398 is specifically client App decomposition, not a backend decomposition task. Linear search found no clearly scoped existing server-decomposition issue; do not create/update one as part of this proposal.

## Suggested file and dependency boundary

1. `apps/server/src/character-archive-service.ts` — domain operations only. Expose narrow methods over a single `Database` dependency and typed command inputs (`campaignId`, `membershipId`, character ID, revision, action ID). Return a small discriminated outcome (`duplicate`, `not-found`, `conflict`, `updated`) rather than Fastify replies. Keep the transaction and all archive/restore side effects here. Implement its action replay lookup locally against `gameEvents`; do not import private helpers from `routes.ts` or pass an arbitrary helper bag.
2. `apps/server/src/character-archive-routes.ts` — register the three HTTP endpoints. Parse current contract schemas and IDs, resolve auth using the existing `requireAuth(request, reply, db)` policy, enforce GM before calling the service, map outcomes to the same HTTP codes/bodies, build DTOs with `characterDto`, and broadcast only after successful state transitions. Dependencies should be just `FastifyInstance`, `Database`, and a narrow `(campaignId) => Promise<void>` broadcaster; auth can use the repository's existing direct `requireAuth` pattern rather than injectable plumbing.
3. `apps/server/src/routes.ts` — import/register the new module beside the other `register*Routes`; remove only the extracted three handlers and now-unused lifecycle-only imports/schemas. Keep unrelated character create/update/counter/catalog routes in place.

This division gives the archive transaction/replay policy a real domain owner and leaves transport/auth/DTO concerns at the HTTP edge. It is not a pasted route block hidden behind an oversized dependency object. Service methods should not import Fastify, realtime, snapshots, or `routes.ts`.

## Invariants to freeze before extraction

### Authorization and information boundaries

- All three endpoints require a valid session and GM role; a player/owner remains forbidden.
- All reads and transitions are campaign-scoped. An absent, foreign-campaign, or lifecycle-ineligible record returns the existing non-enumerating 404 where applicable.
- Archive event attribution uses the authenticated GM membership ID. Keep the exact `GM_REQUIRED`, `CHARACTER_NOT_FOUND`, and `CHARACTER_CONFLICT` response contracts.

### Transaction, replay, and revision behavior

- Archive and restore remain revision-checked compare-and-set transitions inside a DB transaction; transaction loser remains 409.
- Preserve action-ID replay behavior and the existing duplicate response `{ duplicate: true }` with HTTP 200. Preserve check placement/semantics during the extraction; do not silently redesign idempotency/concurrency while moving code.
- Persist the game event atomically with the lifecycle write and dependents. Broadcast only after successful commit, never on conflict/duplicate.
- Archive effects are atomic: delete character controllers; materialize token-definition display names before detaching; detach token definitions and tokens; expire only unclaimed campaign-scoped invites; retain media, catalog entries, chat attribution, and game/audit history.
- Restore clears archive metadata and increments revision, but does not reinstate controllers, token links, or expired invitations. Return catalog entries/controllers in the restore DTO as current code does.
- Archived roster remains GM-only, campaign scoped, ordered newest archive first, excludes active rows, and projects entries/controller IDs through `characterDto`.

### DTO and snapshot behavior

- Preserve `characterDto` normalization and current list/restore payload shape.
- The active gameplay snapshot continues excluding archived characters; broadcast after archive/restore so connected clients converge. Do not broadcast for rejected writes or replay.

## Verification plan (focused pool, not micro-change testing)

1. Run `character-archive.integration.test.ts` against the new `registerCharacterArchiveRoutes` composition (prefer keep or adapt the existing full-`registerRoutes` harness so the actual application registration is covered). It already covers: archive and restore success, bootstrap hide/reappear, GM-only auth, cross-campaign 404, stale revisions, duplicate action IDs, detach/history-preservation policy, archived roster scope/order, and no accidental link restoration.
2. Add one service-level transaction rollback test only if needed to make the extracted domain API's atomicity explicit; avoid duplicating every HTTP assertion in a mock-only test.
3. Run server typecheck and relevant integration suite together at the stage gate. Record exact revision and real command outcomes. No server startup/production/browser/E2E claim is implied by the proposal.

## Risks / open design notes

- `findAction` is currently a private general helper in `routes.ts`; the extraction should use a small local equivalent/query, not import back from the composition root. Do not opportunistically change replay race behavior.
- `broadcastSnapshots(io, db, campaignId)` is currently a routes-local implementation; inject only the campaign-scoped broadcast callback, keeping socket implementation out of the domain service.
- Route module imports `characterDto`; DTO mapping stays at the edge. If DTO assembly for archived rows is considered service behavior, decide this explicitly rather than leaking raw query internals across the route boundary.
- No schema migrations or API changes are required or proposed.

## Checkpoint

- Decision: propose character archive lifecycle route/service extraction as one bounded server pool.
- Revision reviewed: `2989381e7d6bd2d60094766cd039edc97fc0e6a5`.
- Files inspected: `apps/server/src/routes.ts`, existing `register*Routes` modules, `apps/server/src/character-archive.integration.test.ts`, `apps/server/src/character-dto.ts`.
- Verification: read-only inventory and Linear reads only; no server/test/typecheck gates run by this reviewer.
- Blocker: owner approval of the proposed next domain and its focused stage gate.
- Next action: if approved, assign the extraction to one owner and preserve this transaction/auth/DTO invariant checklist as the acceptance gate.
