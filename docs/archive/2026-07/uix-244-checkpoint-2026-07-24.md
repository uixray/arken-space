# UIX-244 checkpoint — 2026-07-24

## Decisions

- Reuse the existing server-authoritative `characters.inventory` string list; do not add a parallel notes table or premature item/economy model.
- Keep the MVP as one trimmed inventory entry per line.
- Remount the inventory textarea on canonical character revision changes so conflict recovery and remote updates cannot leave stale visible text.

## Revision

- Branch: `codex/uix244-inventory-notes`
- Base: `b78c0dc`

## Changed files

- `apps/web/src/Sidebar.tsx`
- `tests/pool-b-http.test.ts`

## Verification

- Workspace typecheck: PASS
- Workspace production build: PASS
- Target HTTP suite: 1 file / 33 tests PASS
- Inventory coverage confirms owner and GM updates, other-player denial, stale-revision conflict, owner snapshot privacy, and GM visibility.
- `git diff --check`: PASS
- Existing Vite chunk-size warning remains and is unrelated.

## Blockers

- None.

## Next action

- Commit and close UIX-244, then select the next non-deferred product pool.
