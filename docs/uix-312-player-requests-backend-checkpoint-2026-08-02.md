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
---

## Minimal request workspace UI pool

### Decisions

- All authenticated users receive a request workspace; the GM sees `Открытые заявки`, a player sees `Мои заявки`.
- The PLAYER chat composer includes a `Заявка` action that opens the workspace form; no chat card is created.
- Client mutations always use fresh action IDs and canonical server DTO responses; no optimistic request object is synthesized.
- Player views remain author-only even though authorized PUBLIC requests may exist in the snapshot.
- Audience labels are explicit: `Всем участникам` and `Автору и всем мастерам`.
- Drafts and selection remain component-local and reset on close or identity/campaign change; nothing is persisted locally.
- Character choice is limited to the active or owned characters currently exposed by the snapshot. Delegated-controller enumeration is deferred because the client contract does not expose it.
- Styles are isolated; shared `styles.css` and `WorldMapsWorkspace.tsx` remain untouched.

### Revision

Base: `07507a5`.

### Changed files

- `apps/web/src/PlayerRequestsWorkspace.tsx`
- `apps/web/src/PlayerRequestsWorkspace.css`
- `apps/web/src/player-request-ui.ts`
- `apps/web/src/player-request-ui.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `docs/uix-312-player-requests-backend-checkpoint-2026-08-02.md`

### Verification

- player request UI/realtime/source-encoding tests: 9/9 PASS
- web typecheck: PASS
- `git diff --check`: PASS

### Blockers

- Browser and real multiplayer QA remain deferred.
- Linked chat cards, attachments and delegated-controller character enumeration remain open scope.

### Next action

Commit the UI pool. UIX-312 remains In Progress until deferred acceptance and verification gates are resolved.
---

## Delegated-controller character picker follow-up

### Decisions

- The request character picker includes characters owned by the current membership, delegated to it through `controllerMembershipIds`, or selected as the active-character fallback.
- Each snapshot character is emitted at most once even when several eligibility rules match; unrelated characters remain excluded.
- Request attachments remain out of scope.

### Revision

Base: `c95cd3c`.

### Changed files

- `apps/web/src/player-request-ui.ts`
- `apps/web/src/player-request-ui.test.ts`
- `apps/web/src/PlayerRequestsWorkspace.tsx`
- `docs/uix-312-player-requests-backend-checkpoint-2026-08-02.md`

### Verification

- player request UI and source-encoding tests: 8/8 PASS
- web typecheck: PASS
- `git diff --check`: PASS

### Blockers

- None for this follow-up.

### Next action

Run the pool verification and integrate it with the linked chat-card work.

---

## Linked TABLE chat-card pool

### Decisions

- Each durable player request creates exactly one reference-only `SYSTEM` message in the `TABLE` stream in the same transaction. The chat row stores no request title, body, status, or copied request metadata.
- `chat_messages.player_request_id` is nullable, campaign-scoped by a composite foreign key, unique per request, constrained to the empty SYSTEM shape, and guarded by a migration trigger to the TABLE stream.
- Realtime creation emits `player-request:changed` before `chat:created` to the same safe audience: campaign for PUBLIC, GM room plus author room for GM_ONLY. Replay, edit, and transitions create no cards.
- Snapshot history drops linked messages unless the viewer can resolve the canonical request projection. The client resolves current card fields from `snapshot.playerRequests`; missing canonical data renders only a generic unavailable state.
- Request attachments remain out of scope.

### Revision

Base: `fc8d057`. Working tree, not committed by this pool.

### Changed files

- `packages/db/src/schema.ts`
- `packages/db/drizzle/0026_player_request_chat_cards.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/contracts/src/index.ts`
- `apps/server/src/player-requests.ts`
- `apps/server/src/snapshot.ts`
- `apps/server/src/player-requests.integration.test.ts`
- `apps/web/src/player-request-chat.tsx`
- `apps/web/src/player-request-chat.css`
- `apps/web/src/player-request-chat.test.ts`
- `apps/web/src/Sidebar.tsx`

### Verification

- contracts/db/server/web typecheck: PASS
- focused player-request integration + chat-card resolver: 11/11 PASS
- DB and contracts package build: PASS
- migration executed by PGlite integration suite: PASS
- `git diff --check`: PASS

### Blockers

- Browser and real multiplayer QA remain deferred at the existing project gate.

### Next action

Integrate/review the pool, then run the broader deferred browser/Docker/regression gates before closing UIX-312.

### Release-blocking integration correction

- Restored the chat-card Russian labels as BOM-free UTF-8 and added a source regression test for the six required labels plus placeholder rejection.
- Wired canonical `snapshot.playerRequests` and the request-workspace opener into the unified ACTIVITY feed; direct chat remains unchanged because the database trigger restricts request cards to TABLE.
- Added repository-standard migration statement breakpoints to `0026_player_request_chat_cards.sql`.
- Verification: focused migration/request/card/UI tests 17/17 PASS; contracts/db/server/web typecheck PASS; 10-file owned-scope UTF-8/BOM/placeholder scan PASS; `git diff --check` PASS.
