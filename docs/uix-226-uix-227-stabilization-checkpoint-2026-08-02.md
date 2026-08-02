# UIX-226 / UIX-227 stabilization checkpoint — 2026-08-02

## Decisions

- Use the clean `codex/uix226-uix227-followup` worktree based on integrated revision `3274566`; do not modify the dirty root checkout.
- Do not cherry-pick `5470897`: its UIX-257/UIX-258 behavior is already integrated as `9ac29dd` and has since evolved.
- Close the confirmed UIX-226 custom-formula overlay gap first. Keep UIX-227 as a separate implementation commit because its renderer defects and browser acceptance require a larger isolated scope.

## Revision

- Base: `327456608e004586e0546b9094fd3e2406e22537`
- Working tree: uncommitted UIX-226 implementation and this checkpoint.

## Changed files

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`
- `docs/uix-226-uix-227-stabilization-checkpoint-2026-08-02.md`

## Verification

- Connected chat/roll/canvas smoke: 10 files, 43 tests passed.
- UIX-226 targeted Playwright: 2 passed, including custom GM-only advantage request and 390x844 reachability.
- Web tests: passed.
- Workspace typecheck: passed.
- Workspace lint: passed.
- Production build: passed; existing large-chunk warning remains.
- UIX-227 baseline: 6 files passed; `tests/pool-b-http.test.ts` had 2 assertion failures caused by mojibake expectations, matching known repository test debt rather than the UIX-226 diff.
- `git diff --check`: passed.

## Blockers

- UIX-226 still needs exact-scope review and commit approval gate; no commit or push yet.
- UIX-227 still has confirmed gaps: same-frame drawing termination, representative-only stack labels, Esc-to-PAN, and missing cold-load/portrait/undo browser coverage.
- Full Docker multiplayer and production smoke were not run. Production deployment is out of scope.

## Next action

Review and commit only the four files above for UIX-226, then start a separate UIX-227 renderer/browser pool.

## UIX-227 pool

### Decisions

- Hide and detach the active drawing draft synchronously on pointer-up, then persist the immutable completed stroke in the background.
- Resolve token stacks from current drag positions and choose the lexicographically smallest token ID as the single stable representative.
- Escape clears selection/menu and returns the active canvas tool to PAN.
- Revalidate token selectability at click time so a player-visible foreign token cannot enter a transient selected state.
- Keep browser coverage isolated in `tests/e2e/canvas-token-regressions.spec.ts` rather than widening the stale broad concept suite.

### Revision

- UIX-226 committed as `8238f32`.
- UIX-227 is implemented on top and remains uncommitted.

### Changed files

- `apps/web/src/renderers/Orthographic2DRenderer.tsx`
- `apps/web/src/renderers/drawing-draft.ts`
- `apps/web/src/renderers/drawing-draft.test.ts`
- `apps/web/src/renderers/map-objects.ts`
- `apps/web/src/renderers/map-objects.test.ts`
- `tests/e2e/canvas-token-regressions.spec.ts`
- this checkpoint

### Verification

- Focused renderer unit pool: 5 files, 32 tests passed.
- Isolated Chromium browser regression: 2 tests passed.
- Workspace typecheck: passed.
- Workspace lint: passed.
- Production build: passed; existing large-chunk warning remains.
- `git diff --check`: passed.

### Remaining gates

- Cold-load first resize and actionable conflict correlation IDs still need a stable browser gesture/observability test.
- Portrait continuity during drag remains a real-browser visual gate.
- Stack update after realtime move/delete is unit-covered at the resolver level but not yet browser-observable.
- Docker multiplayer and production smoke were not run.

### Next action

Commit the seven-file UIX-227 scope separately, keep UIX-227 In Progress, then implement the remaining cold-load/portrait browser gate before review.
## UIX-227 resize correlation subpool

- Token resize now uses one canonical UUID in both the request body and `x-action-id`, aligning route idempotency, request logs, telemetry and user correlation.
- API failures surface only bounded safe `requestId` / `actionId` values; response bodies, URLs and stacks are not included.
- Changed files: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/web/src/api.test.ts`, and this checkpoint.
- Verification: API unit tests 10/10, web typecheck, workspace lint and diff check passed.
- Browser cold-resize gesture remains open: Konva resize-handle coordinate automation was flaky and the incorrect world-resize test was removed rather than accepted.
- Next action: commit this correlation scope separately; then add deterministic portrait/asset observability before the remaining real-browser gate.