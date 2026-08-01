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
- Docker multiplayer gate ? PASS (2/2, including authoritative recovery and shared-browser handoff).

## Blockers
- None for UIX-322.

## Next action
- Close UIX-322 and continue the combined release regression.
