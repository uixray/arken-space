# UIX-324 checkpoint: assignment UI pool (2026-08-01)

## Decisions

- Character access is edited inside each GM character card, so multi-card work retains local drafts.
- The primary owner is always checked and disabled; only additional grants are revocable during beta.
- Save is explicit and revision-aware. On failure the client reloads the canonical snapshot before showing retry guidance.
- Player character cards never render access controls.

## Revision

- Branch: `codex/manual-production-fixes`
- Server access checkpoint: `ef42f44`

## Changed files

- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/character-controller-access-state.ts`
- `apps/web/src/Sidebar.test.ts`
- `apps/web/src/character-mutation.test.ts`

## Verification

- Web typecheck: PASS
- Scoped ESLint: PASS
- Character mutation, sidebar, and source encoding tests: PASS (11/11)
- `git diff --check`: PASS
- Focused Chromium acceptance: PASS (3/3) for GM assign/revoke, additionally assigned player, and unassigned player.

## Blockers

- None for UIX-324 acceptance. Production deployment remains a separate explicit release gate.

## Next action

- Close UIX-324 and select the next backlog pool.
