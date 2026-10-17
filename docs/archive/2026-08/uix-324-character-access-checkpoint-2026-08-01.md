# UIX-324 checkpoint: character access pool (2026-08-01)

## Decisions

- Character-sheet access is stored in `character_controllers`; token control and login grants remain separate.
- `ownerMembershipId` remains an implicit non-revocable primary grant because beta player links still resolve through it.
- GM assignment validates PLAYER memberships inside the same campaign and always retains the primary owner.
- Additional character access does not grant token movement.

## Revision

- Branch: `codex/manual-production-fixes`
- Parent implementation checkpoint: `6b99fbc`

## Changed files

- `packages/db/src/schema.ts`
- `packages/db/drizzle/0022_character_controllers.sql`
- `packages/db/drizzle/meta/_journal.json`
- `packages/contracts/src/index.ts`
- `apps/server/src/character-dto.ts`
- `apps/server/src/snapshot.ts`
- `apps/server/src/routes.ts`
- `tests/pool-b-http.test.ts`

## Verification

- `@arken/db` typecheck: PASS
- `@arken/contracts` typecheck: PASS
- `@arken/server` typecheck: PASS
- focused assignment/revoke HTTP test: PASS
- source encoding tests: PASS (4/4)
- `git diff --check`: PASS after formatting
- full `pool-b-http.test.ts`: 40/42 PASS; two pre-existing mojibake expectations fail because runtime now returns valid Cyrillic. These failures are unrelated baseline debt and are intentionally not normalized in this pool.

## Blockers

- GM assignment UI and browser QA are the next pool.
- Revoking the primary owner requires the planned post-beta authentication redesign; it is not part of UIX-324.

## Next action

- Wire GM checkboxes to `PUT /api/characters/:id/controllers`, then verify GM/assigned/unassigned browser paths.
