# UIX-256 checkpoint ? 2026-07-22

## Decisions

- PR1 keeps the single `Orthographic2DRenderer`; mouse/Konva and pointer drafts remain unchanged.
- Keyboard commands are pure reducer intents and execute only while the labelled map root owns focus.
- Object discovery uses one role/layer/fog/world-bounds selector; stale refs are reconciled before actions.
- Token and drawing deletion from keyboard and pointer paths share one confirmation flow.

## Revision

- Base: `9ac29dd` (`origin/main`).
- Branch: `codex/uix256-map-command-core`.
- Pool changes are ready to commit; UIX-256 remains in progress.

## Changed files

- `apps/web/src/renderers/map-interaction.ts`
- `apps/web/src/renderers/map-interaction.test.ts`
- `apps/web/src/renderers/map-objects.ts`
- `apps/web/src/renderers/map-objects.test.ts`
- `apps/web/src/renderers/Orthographic2DRenderer.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`

## Verification

- PASS: lint.
- PASS: web typecheck.
- PASS: focused reducer/selector tests ? 18/18.
- PASS: production build.
- PASS: focused browser regressions ? 6/6, including two new keyboard/object-list scenarios.
- Full Vitest attempt: 30 files / 195 tests passed; six unrelated PGlite-heavy suites timed out concurrently during setup. No UIX-256 focused failure.
- PASS: `git diff --check`.

## Review fixes

- Restored valid UTF-8 user-facing strings.
- Unified mouse/keyboard selection state.
- Routed pointer deletion through confirmation.
- Revalidated stale refs against canonical candidates.
- Replaced incomplete listbox semantics with native list/buttons.
- Added typed object refs with revisions and bounded viewport inputs.

## Blockers / remaining

- Add serialized keyboard movement for selected token(s) across revision acknowledgements.
- Define/test tool-selection shortcuts if retained in PR1 acceptance criteria.
- Repeat full Vitest gate in a lower-contention environment before marking Done.
- No production deployment without a separate gate.

## Next action

Implement the revision-aware selected-token movement queue, then run the final full gate and combined review.
