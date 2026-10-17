# UIX-266 checkpoint ? 2026-07-22

## Decisions

- Chat uses durable `chat_threads`; every campaign owns fixed STREAM threads `TABLE`, `STORY`, and `ROLLS`.
- `DICE` is server-routed to ROLLS; ordinary/system messages use TABLE; only GM posts to STORY while all campaign members may read PUBLIC story posts.
- Legacy `GM_ONLY` remains an orthogonal audience and is not broadened or converted to DIRECT.
- Read cursors are durable per membership/thread, monotonic and clamped to the latest visible message.
- UIX-246 will extend STORY with media/lifecycle/import; UIX-267 will add DIRECT threads without reusing GM_ONLY.

## Revision

- Base: `f9fa636` (`origin/main`).
- Branch: `codex/uix266-uix267-chat-threads`.

## Changed areas

- Migration/schema: `0017_chat_threads.sql`, fixed-stream provisioning, tenant-safe composite FKs, cursor table and legacy-writer trigger.
- Contracts: thread/stream/message/state/read schemas and snapshot fields.
- Server: centralized chat policy/DTO module, per-stream snapshot windows, unread SQL counts, seven writer routes, read cursor endpoint and realtime audience policy.
- Web: accessible stream tabs, role-specific composer, per-thread realtime window, unread reconciliation and durable read cursor.
- Tests: migration, contracts, server policy, visibility, web state and Playwright stream flows.

## Verification

- PASS: lint.
- PASS: full workspace typecheck.
- PASS: production build.
- PASS: full low-contention Vitest ? 39 files / 223 tests.
- PASS: focused Playwright UIX-266 ? 3/3.
- PASS: `git diff --check`.

## Review fixes

- Added tenant-safe composite foreign keys and automatic fixed streams for new campaigns.
- Added rolling compatibility for legacy writers.
- Removed ambiguous thread/stream create contract.
- Made PUBLIC STORY readable but GM-only to publish.
- Replaced unbounded unread row loading with SQL `count(*)`.
- Fixed realtime/read badge reconciliation, corrupted labels and ARIA tab keyboard navigation.

## Blockers

- None for UIX-266.
- Production deployment requires a separate release gate.

## Next action

Publish UIX-266, then implement UIX-267 DIRECT participants and centralized attachment-safe ACL on this thread foundation.
