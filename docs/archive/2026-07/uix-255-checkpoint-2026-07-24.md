# UIX-255 checkpoint — 2026-07-24

## Decisions

- Generate an immutable campaign-local TOKEN derivative from an existing IMAGE; never mutate the source asset.
- Use a GM-only `POST /api/assets/:sourceAssetId/token` action with normalized crop center, zoom, and one of four programmatic frame presets.
- Persist only the generated 512×512 WebP TOKEN; no crop recipe or external frame assets are stored in MVP.
- Reuse the existing TokenDefinition asset assignment flow.

## Revision

- Branch: `codex/uix255-token-generator`
- Server implementation: `e85dde2`
- Post-commit media cleanup fix: `7e6de51`
- Base includes UIX-224 `b78c0dc` and UIX-244 `0b3ae69`.

## Changed areas

- Token transform contracts and validation.
- Sharp crop, circular alpha mask, generated frame rings, storage, quota, idempotency, and cleanup.
- GM-only token generation route and TOKEN-kind placement validation.
- Accessible GM editor with exact live crop preview, pointer/keyboard pan, zoom, reset, frame presets, and narrow layout.
- Contract, storage, HTTP, state, crop-preview, and browser coverage.

## Verification

- Full workspace typecheck: PASS.
- Full Vitest: 62 files / 321 tests PASS.
- Full production build: PASS.
- Focused ESLint: PASS.
- Browser QA: Chromium GM generation/assignment and player absence, 2/2 PASS.
- Review: two P1 findings closed:
  - committed media is preserved if post-commit broadcast fails;
  - preview crop now matches server output for aspect ratio, zoom, and edge clamps.
- `git diff --check`: PASS.
- Existing Vite chunk-size and Konva layer warnings remain unrelated.

## Blockers

- None.

## Next action

- Commit UI/browser integration, close UIX-255, then perform the combined UIX-224/UIX-244/UIX-255 release-candidate regression review.
