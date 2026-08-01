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

## Blockers
- Browser acceptance still needs a running migrated stack and two player sessions to verify GM assignment, assigned access, and revoked access end to end.

## Next action
- Add/run focused browser QA for GM, assigned player, and unassigned player; then complete UIX-324 acceptance review.
