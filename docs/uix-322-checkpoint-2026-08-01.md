# UIX-322 checkpoint ? 2026-08-01

## Decisions
- Player handoff and ordinary logout now use `location.replace("/")`.
- The legacy `?switch-player=1` personal-link form was removed; the unauthenticated root always shows the beta player chooser.
- Shared-browser invite tests navigate to the next invite explicitly after the chooser, preserving exact server-session isolation.

## Revision
- Branch: `codex/manual-production-fixes`
- Base before this pool: `22e4d84`

## Changed files
- `apps/web/src/App.tsx`
- `apps/web/src/AuthGate.tsx`
- `tests/e2e/playtest-feedback.spec.ts`
- `tests/multiplayer/game-session.spec.ts`

## Verification
- `pnpm typecheck` ? PASS.
- `vitest run tests/auth-logout.test.ts` ? PASS (3/3).
- Playwright scoped handoff/GM-entry gate ? PASS (3/3).
- `git diff --check` ? PASS.
- Docker multiplayer gate ? BLOCKED before startup: Docker Desktop Linux engine pipe is unavailable.

## Blockers
- Full `pnpm test:multiplayer` must be rerun when Docker Desktop is running.

## Next action
1. Start Docker Desktop.
2. Run isolated multiplayer gate.
3. If green, move UIX-322 from In Review to Done and run the combined release regression.
