# UIX-267 checkpoint ? 2026-07-22

## Decisions

- DIRECT threads have exactly two canonical participants; GM has no implicit access.
- Thread ACL protects metadata, history, realtime, unread cursors, attachment metadata and bytes.
- Legacy `GM_ONLY` remains separate and is never used as DIRECT.
- Direct privacy is the thread boundary; direct messages are server-forced PUBLIC inside that boundary.
- Private images use staged uploads and atomic message claims; generic campaign assets do not expose them.

## Revision

- Base: `c59f801` (UIX-266).
- Branch: `codex/uix266-uix267-chat-threads`.

## Changed areas

- Migration/schema: DIRECT thread shape, canonical participant pair, tenant-safe constraints, staged/final attachment tables.
- Contracts: direct create/send/thread DTOs, authorized attachment metadata and `chat:thread_created`.
- Server: centralized participant ACL, race-safe pair creation, idempotent replay DTOs, member-room realtime, attachment quota/cleanup/claim/content authorization.
- Snapshot: SQL-filtered direct threads/messages and reconnect-safe attachment metadata.
- Web: Personal tab, recipient chooser, direct history/unread/realtime, upload preview and protected attachment rendering.
- Tests: migration/contracts, adversarial sender/recipient/C/GM/cross-campaign ACL, attachments, snapshot/reconnect and Playwright privacy flow.

## Verification

- PASS: lint.
- PASS: full workspace typecheck.
- PASS: production build.
- PASS: full low-contention Vitest ? 44 files / 243 tests.
- PASS: combined UIX-266/UIX-267 Playwright ? 4/4.
- PASS: `git diff --check`.

## Review fixes

- Bounded multipart buffering and aggregate media quota with expired staging cleanup.
- Attachment metadata persists across reconnect without entering generic assets.
- Concurrent action/claim conflicts replay safely only for the same actor/type/thread.
- Brand-new threads reach both participants through member-only events.
- HTTP response/replay reconciles messages when socket delivery is lost.
- DIRECT messages are explicitly excluded from TABLE despite nullable stream.
- Routes UTF-8 corruption/BOM regression was removed.

## Blockers

- None for UIX-267.
- Production deployment requires a separate migration/release gate.

## Next action

Publish UIX-267 and move to UIX-268 stickers on the stabilized stream/direct contracts.
