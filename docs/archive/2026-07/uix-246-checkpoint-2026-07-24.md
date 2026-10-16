# UIX-246 checkpoint — 2026-07-24

## Stage

Implementation and verification complete; awaiting commit/publication decision.

## Decisions

- Keep the existing `STORY` chat stream for navigation, but use dedicated `story_posts` storage as the canonical source for narrative posts.
- Separate player-safe and GM-admin projections. Draft notes, import provenance and rights metadata never enter player DTOs.
- Use explicit `DRAFT → PUBLISHED/CORRECTED → ARCHIVED` lifecycle with revision CAS.
- Story media reuses validated staged uploads, but is served through `/api/story/media/:contentId` after post-level authorization.
- Telegram import accepts only a small user-approved local export. The server does not fetch or scrape Telegram.
- Full Telegram import remains gated by a permitted sample export and review of the dry run.

## Revision

- Base: `3756c4ab36397520fb8f8c4e379fe430136c4f62`
- Branch: `codex/uix246-story-channel`
- Worktree: `.worktrees/uix246`
- Not committed yet.

## Changed files

- `packages/contracts/src/index.ts`
- `packages/db/src/schema.ts`
- `packages/db/drizzle/0021_story_posts.sql`
- `packages/db/drizzle/meta/_journal.json`
- `apps/server/src/story.ts`
- `apps/server/src/story.test.ts`
- `apps/server/src/routes.ts`
- `apps/web/src/StoryChannel.tsx`
- `apps/web/src/StoryChannel.test.ts`
- `apps/web/src/story-channel-helpers.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/styles.css`
- `tests/story-post-contract.test.ts`
- `tests/story-http.integration.test.ts`
- `tests/e2e/story-channel.spec.ts`
- `tests/visibility.test.ts`

## Verification

- Lint: PASS with zero warnings.
- Full typecheck: PASS.
- Production build: PASS (existing bundle-size warning only).
- Full Vitest: 57 files / 296 tests PASS.
- STORY contract/server integration subset: 17/17 PASS.
- Chromium STORY QA: 3/3 PASS at 960 px (lifecycle, player safety, pagination/read cursor/ARIA).
- Final review P1 fixes: load-more pagination, legacy STORY read cursor and tabpanel ARIA.
- Sequential affected Vitest rerun: 4 files / 25 tests PASS.
- `git diff --check`: PASS.
- No `ts-nocheck` suppression remains.

## Review findings / blockers

- The initial realtime admin-payload leak was removed: clients receive only a typed safe invalidation event and refetch their role-filtered projection.
- Action replay now verifies author, event type and canonical command hash.
- Media claiming is atomic inside the transaction.
- Pagination uses an opaque composite `{updatedAt,id}` cursor.
- Telegram dry-run is persisted, GM-owned, TTL-bound and fingerprint-bound to commit.
- Legacy STORY text messages remain visible during the transition to canonical story posts.
- A race between two different import actions for the same previously unseen source currently resolves as a database conflict rather than returning the winner's post; no duplication or privacy leak occurs.
- Entity-link resolvers remain future scope because current UI does not create entity links yet.
- No approved Telegram export has been supplied, so no external material has been imported.

## Next action

Commit the verified branch and publish to GitHub when approved. Production deployment remains a separate explicit gate.
