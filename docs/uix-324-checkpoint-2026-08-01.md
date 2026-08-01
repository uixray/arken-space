# UIX-324 checkpoint - 2026-08-01

## Decisions
- Opening a character from a map token is an explicit focused mode and replaces unrelated open sheets.
- Deliberate navigation from the character rail preserves the existing multi-card workflow.
- Rail collapse is local UI state and does not alter character access or persistence.

## Revision
- Branch: `codex/manual-production-fixes`
- Base: `51c680b`

## Changed files
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/character-workspace-state.ts`
- `apps/web/src/character-workspace-state.test.ts`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`

## Delivered
- Added reducer-level exclusive character focus for token navigation.
- Repeated clicks on the same token retrigger focused mode.
- Narrowed the expanded character rail and added a compact collapsed state with character initials.
- Reduced card minimum width, spacing and deck padding so two ordinary cards fit more comfortably.
- Kept the three-card bounded multi-card workflow available through deliberate rail selection.

## Verification
- Typecheck - PASS.
- Lint - PASS.
- Source encoding and workspace-state tests - PASS (10/10).
- Focused Chromium multi-card/collapsible-rail QA - PASS (1/1).
- `git diff --check` - PASS.

## Remaining UIX-324 work
- Add explicit server-backed character access assignments and GM controls.
- Verify assigned and unassigned player snapshots/mutations.
- Add discoverable skill/ability management actions.
- Complete 1024 px browser QA.

## Next action
Implement character access grants without reusing token-controller grants as character authorization.
