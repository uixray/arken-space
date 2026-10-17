# UIX-224 checkpoint — 2026-07-24

## Decisions

- Preserve existing selectors and component behavior; do not split the global stylesheet while its regions remain cascade-coupled.
- Expose designer-facing DOM values through documented CSS foundation tokens and retain legacy variables as compatibility aliases.
- Keep React-Konva visuals outside CSS in a typed semantic token map.
- Treat the editing guide as the ownership map for DOM, Gravity UI, and canvas surfaces.

## Revision

- Branch: `codex/uix224-designer-editing`
- Base: `6d0cb28`

## Changed files

- `apps/web/src/styles.css`
- `apps/web/src/ui/gravity-foundation.css`
- `apps/web/src/renderers/Orthographic2DRenderer.tsx`
- `apps/web/src/renderers/canvas-visual-tokens.ts`
- `docs/uix-224-designer-editing-guide.md`

## Verification

- Prettier check: PASS
- Web TypeScript typecheck: PASS
- Frontend Vitest: 22 files / 99 tests PASS
- Production web build: PASS
- `git diff --check`: PASS
- Visual values and selectors remain unchanged; CSS HMR path is unchanged.
- Existing Vite chunk-size warning remains and is not introduced by this pool.

## Blockers

- None for UIX-224.

## Next action

- Commit the isolated branch, close UIX-224, then start UIX-244 inventory notes.
