# UIX-321 checkpoint — 2026-07-31

## Linear

- UIX-321 remains In Progress.

## Decisions

- Preserve the existing participant-only DIRECT thread and attachment ACL.
- Add `directChatContacts` as a safe bootstrap projection instead of widening general `members` for players.
- Exclude a sender's own messages from unread counts after reload.
- Use one accessible peer selector; selecting a peer resolves the existing canonical thread or creates it.
- Persist the selected peer/thread per campaign and membership, then validate it against the authorized snapshot.

## Revision

- Base: `2c1a4977854ccdfa0aafa9193f35708bd12b4759` (`origin/main`).
- Branch: `codex/manual-production-fixes`.

## Changed files

- `packages/contracts/src/index.ts`
- `apps/server/src/snapshot.ts`
- `apps/web/src/direct-chat-state.ts`
- `apps/web/src/direct-chat-state.test.ts`
- `apps/web/src/Sidebar.tsx`
- `tests/chat-direct-acl.test.ts`

## Verification

- PASS: scoped DIRECT unit/integration tests — 4 files, 22 tests.
- PASS: full workspace typecheck.
- PASS: full lint.
- PASS: production build.
- PASS: `git diff --check`.
- Browser QA: attempted with a new mocked UIX-321 spec; the fixture/harness was not reliable enough and was removed rather than committed. Existing UIX-267 Playwright coverage still needs adaptation to the unified selector before this pool can close.

## Blockers

- Browser acceptance remains open: unified selector, selected-peer reload, realtime unread and unauthorized third-player UI must pass in a stable browser fixture or multiplayer environment.
- No production deployment was performed.

## Next action

- Adapt the established UIX-267 Playwright story to `directChatContacts` and the unified peer selector, then run the browser/privacy gate before marking UIX-321 Done or starting UIX-320/UIX-322 implementation.
