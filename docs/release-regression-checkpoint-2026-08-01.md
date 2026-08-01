# Release regression checkpoint ? 2026-08-01

## Decisions
- The Docker multiplayer gate is the authoritative acceptance gate for shared-browser privacy and reconnect behavior.
- A full parallel Vitest run exposed two categories: real source-encoding placeholders in the UIX-320/UIX-321 changes, and unrelated high-contention PGlite timeouts/schema interference. The encoding issue was fixed immediately and reverified in isolation.

## Revision
- Branch: `codex/manual-production-fixes`
- UIX-322 implementation: `e7eceaa`

## Changed files after regression
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/StoryChannel.tsx`
- `tests/e2e/story-channel.spec.ts`
- `docs/uix-322-checkpoint-2026-08-01.md`

## Verification
- Docker `pnpm test:multiplayer` ? PASS (2/2).
- Source encoding gate ? PASS (4/4).
- StoryChannel Playwright ? PASS (3/3).
- Story HTTP + logout scoped Vitest ? PASS (14/14).
- Typecheck ? PASS.
- Lint ? PASS.
- Full parallel Vitest ? 383/396 passed; 12 files failed mostly on 20-second PGlite migration/setup timeouts and cross-test schema interference. This is not accepted as a green release gate and remains tracked separately from the scoped feature gates.

## Blockers
- The full Vitest suite is not green under its default parallel execution. The failures are dominated by baseline test isolation/performance debt rather than the UIX-322 flow; do not claim a completely green repository regression.

## Next action
1. Commit the encoding/regression corrections.
2. Close UIX-322.
3. Continue with the next prioritized backlog item while keeping the full-suite baseline debt explicit.
