# UIX-264 map-node canonical LOCATION reference checkpoint — 2026-10-09

## Decision and revision

Implemented Lane A from `arkenhar-next-parallel-pools-wave2-20261009.md` on C checkout base `f077340150ac1d5bd65246f05a56632c8efbbb4c`; latest observed concurrent HEAD during final verification was `9373f30`. Root integrated the accepted lane in commit `a90aa57938398e8d2a2ec8a415a9ad02ff9b5796`; this late checkpoint clarification adds no product bytes. A map node has at most one nullable canonical LOCATION FK. Null means no association; omitted update preserves; explicit null clears. Existing node labels/summary/GM notes and scene links stay independent. No canonical lore/media is copied or auto-renamed. Reuse is allowed across maps/campaigns.

Server create/change validates an existing LOCATION through current `worldContentByIdVisibleTo`; unknown and wrong-type IDs are rejected. Exact idempotency replay is handled before validation; PATCH validates only a changed non-null association after the authorized node and current revision are loaded, so unrelated edits preserve a now-ineligible historical reference. The exact FK race returns a controlled invalid-reference response. Existing GM visibility semantics remain: GM can retain references to DRAFT/ARCHIVED canon. Player map snapshots batch-resolve references using current canonical role visibility: PUBLISHED canonical references may project; DRAFT/ARCHIVED IDs are omitted, while the otherwise visible map node remains. FK uses `ON DELETE RESTRICT`; archive preserves the relation. No campaign discovery/publication rule was added.

## Owned files

- `packages/db/src/schema.ts`
- `packages/db/drizzle/0055_reflective_beyonder.sql`
- `packages/db/drizzle/meta/0055_snapshot.json`
- `packages/db/drizzle/meta/_journal.json`
- `packages/contracts/src/index.ts`
- `apps/server/src/world-map-routes.ts`
- `apps/server/src/world-maps.ts`
- `apps/server/src/world-maps.test.ts` (existing policy tests unchanged)
- `apps/server/src/world-map-canonical-location.integration.test.ts`
- `apps/web/src/WorldMapsWorkspace.tsx`
- `apps/web/src/WorldMapsWorkspace.copy.test.tsx`
- `apps/web/src/WorldMapCanonicalLocationPicker.tsx`
- `apps/web/src/world-map-canonical-location-client.ts`
- `apps/web/src/world-map-canonical-location-client.test.ts`
- `tests/e2e/uix264-map-canonical-location.spec.ts`
- This checkpoint

Generated local `packages/db/dist` and `packages/contracts/dist` in the C checkout were rebuilt only so workspace tests load current schema/contracts; they are build outputs, not source changes. The root `node_modules` is a junction to shared dependency storage; it is not the package source/build output location. Other workers' dirty files were preserved. No migration was run against a persistent/production database. No install, commit, Linear write, remote operation, push, merge or deployment.

## Connected evidence

- Drizzle-kit generator produced additive `0055_reflective_beyonder.sql` and matching journal/snapshot artifacts from the schema; no handwritten snapshot. Existing migration chain through 0055 was exercised in ephemeral PGlite.
- Focused Vitest final after replay-order correction: 4 files / 15 tests passed — web picker client, mounted workspace component, PGlite route/projection integration, and existing map policy tests. Integration covers create set, unknown/wrong type rejection, exact create replay despite canonical-type change, update omission preserve for historical ref, change, explicit clear, PLAYER write forbidden; GM retention and player draft/archive redaction vs published ID projection. Local only.
- Server TypeScript check passed.
- Web TypeScript check passed.
- Installed Chromium mocked-API mounted workspace: 2/2 passed at 390px and 1280px; GM selector changes the node association via PATCH payload while preserving independent node label/summary. Not live API persistence evidence.

## Residuals / next action

Root review and integration/commit remain. New 0055 belongs to a future candidate freeze; frozen 8c0a0f7 Gate 2 and its historical migration ledger are unchanged. No full issue acceptance claim: independent canonical-scene links, cross-navigation, discovery, import, container/mobile decisions and broader UIX-264 AC remain open. Browser API was mocked; no production/private data or runtime server test was used.

