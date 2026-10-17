# UIX-313 — fog geometry backend checkpoint — 2026-08-02

## Decisions

- Canonical fog operations are ordered `RECT | CIRCLE | POLYGON | BRUSH` geometry plus an explicit bbox; coverage uses actual geometry and the latest matching `REVEAL`/`COVER` operation.
- Legacy rectangular payloads remain accepted and are clamped. New geometry is rejected when any bbox edge is outside its scene.
- Brush samples are deterministically RDP-simplified using `radius / 4` tolerance and capped at 256 canonical points. Polygons are capped at 128 and validated for area and self-intersection.

## Revision

- Base: `7137513` (uncommitted pool).

## Changed files

- `packages/contracts/src/fog-geometry.ts`, schema exports/DTO, focused tests.
- `packages/db/src/schema.ts`, `packages/db/drizzle/0027_fog_geometry.sql`, migration journal.
- `apps/server/src/fog-geometry.ts`, fog create/undo/redo projection paths, snapshot, focused tests.

## Verification

- Contracts, DB, and server typecheck pass.
- Focused geometry, source-encoding, and migration tests: 15/15 PASS.
- Contracts, DB, and server typecheck: PASS.
- `git diff --check`: PASS.
- Migration includes a compatibility trigger for legacy RECT inserts that omit geometry/bbox.

## Known verification gap

- Broad regression, Docker multiplayer, renderer interaction, and browser QA remain deferred.

## Next action

- Integrate renderer/tooling against exported canonical geometry and evaluator, then run the deferred database/integration gate.
