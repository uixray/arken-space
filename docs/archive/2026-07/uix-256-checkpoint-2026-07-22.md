# UIX-256 checkpoint ? 2026-07-22

## Decisions

- PR1 keeps the single `Orthographic2DRenderer`; mouse/Konva and pointer drafts remain unchanged.
- Keyboard commands are pure reducer intents and execute only while the labelled map root owns focus.
- Object discovery uses one role/layer/fog/world-bounds selector; stale refs are reconciled before actions.
- Token and drawing deletion from keyboard and pointer paths share one confirmation flow.

## Revision

- Base: `9ac29dd` (`origin/main`).
- Branch: `codex/uix256-map-command-core`.
- Core pool commit: `0b722af`; final movement/tool pool pending commit.

## Changed files

- `apps/web/src/renderers/map-interaction.ts`
- `apps/web/src/renderers/map-interaction.test.ts`
- `apps/web/src/renderers/map-objects.ts`
- `apps/web/src/renderers/map-objects.test.ts`
- `apps/web/src/renderers/Orthographic2DRenderer.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`
- `apps/web/src/renderers/map-move-queue.ts`
- `apps/web/src/renderers/map-move-queue.test.ts`
- `apps/web/src/renderers/SceneRenderer.ts`
- `apps/web/src/App.tsx`

## Verification

- PASS: lint.
- PASS: full workspace typecheck.
- PASS: production build.
- PASS: full low-contention Vitest ? 37 files / 209 tests.
- PASS: focused reducer/selector/movement tests ? 25/25.
- PASS: focused browser regressions ? 4/4 (keyboard core, PLAYER permission gate, object dialog/delete, delayed movement revisions).
- PASS: `git diff --check`.

## Review fixes

- Restored valid UTF-8 user-facing strings.
- Unified mouse/keyboard selection state.
- Routed pointer deletion through confirmation.
- Revalidated stale refs against canonical candidates.
- Replaced incomplete listbox semantics with native list/buttons.
- Added typed object refs with revisions and bounded viewport inputs.

## Blockers / remaining

- No implementation blocker remains for PR1.
- Production deployment still requires a separate release gate.

## Next action

Commit and publish the final pool, merge to `main`, then close UIX-256 after GitHub/Linear stage gates.
