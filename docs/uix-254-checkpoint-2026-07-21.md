# UIX-254 checkpoint — 2026-07-21

## Decisions

- Shared-PC MVP uses sequential hot-seat handoff: one active player identity at a time.
- True simultaneous multi-principal control in one browser is explicitly deferred; it requires a separate capability/audit/privacy design.
- Player handoff disconnects realtime before logout and never persists invite/session secrets client-side.
- Logout invalidates only sockets for the exact server session; other devices for the same membership remain connected.
- Realtime joins the exact-session room before asynchronous setup, revalidates before the first snapshot, and checks session activity before every client event.
- If logout completed but its response was lost, the client verifies the session and never restores the previous player's UI. If verification itself is unavailable, private state is hidden.

## Revision

- Base: `990c00f` (`main`, synchronized with `origin/main` when implementation started).
- Worktree implementation is uncommitted.

## Changed files

- `apps/server/src/auth.ts`
- `apps/server/src/realtime.ts`
- `apps/server/src/routes.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/AuthGate.tsx`
- `apps/web/src/styles.css`
- `tests/auth-logout.test.ts`
- `tests/e2e/playtest-feedback.spec.ts`
- `tests/multiplayer/game-session.spec.ts`

## Verification

- PASS: `pnpm vitest run tests/auth-logout.test.ts tests/realtime.test.ts` — 19 tests.
- PASS after rebase: `pnpm test` — 29 files, 168 tests.
- PASS: `pnpm typecheck`.
- PASS: `pnpm lint`.
- PASS: `git diff --check`.
- PASS: isolated `tests/e2e/playtest-feedback.spec.ts` — 9/9.
- PASS after rebase: Docker-backed `pnpm test:multiplayer`, including both the GM + 6 scenario and the real shared-browser A → B regression. Isolation, cleanup, resource-leak checks, and production health before/after all passed.

## Linear/GitHub state

- Linear: UIX-254 is ready for the verification-complete stage gate and closure.
- GitHub: public-safe issue should contain UX/outcome only; session-room/auth implementation details remain private.

## Blockers

- No blockers.

## Next action

1. Push and integrate the verified revision into GitHub `main`.
2. Close UIX-254 and its public-safe GitHub issue.
3. Prepare a production release separately; do not deploy without explicit approval.
