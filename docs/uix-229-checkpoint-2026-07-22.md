# UIX-229 checkpoint — 2026-07-22

## Decisions

- Characters is an in-place workspace, not a floating dialog.
- The map renderer stays mounted to preserve the viewed scene and canvas state, but becomes hidden and non-interactive while Characters is open.
- The GM can keep up to three distinct sheets open in a horizontally scrollable deck and focus, collapse, restore, or close each sheet independently.
- Collapsing keeps the sheet mounted so local drafts, roll mode, pending state, and nested editor state are preserved.
- Player visibility continues to rely on the server-filtered snapshot; the client additionally limits the rail to the owned/current character.
- Existing character mutations, rolls, catalog entries, inventory, resources, wallet, notes, and permissions remain unchanged.

## Revision

- Base: `8b2ce55` from GitHub `main`.
- Branch: `codex/uix229-character-workspace`.

## Changed files

- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/character-workspace-state.ts`
- `apps/web/src/character-workspace-state.test.ts`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`

## Verification

- PASS: `pnpm test` — 30 files, 172 tests.
- PASS: `pnpm typecheck`.
- PASS: `pnpm lint`.
- PASS: `git diff --check`.
- PASS: `pnpm exec playwright test tests/e2e/concept.spec.ts` — 17/17.
- PASS: focused GM multi-sheet and player-permission scenarios.
- PASS: visual inspection at the concept-test desktop viewport.

## Blockers

- None.

## Next action

1. Integrate the verified revision into GitHub `main`.
2. Update Linear UIX-229 at the verification-complete stage gate.
3. Release to production only after a separate explicit request and release gate.
