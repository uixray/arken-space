# UIX-227 + UIX-231 checkpoint — 2026-07-19

## Decisions
- Token placement width/height is authoritative in realtime DTOs; definition defaults no longer overwrite resized dimensions.
- Token resizing is proportional in both renderer and server validation.
- Loaded token portraits remain visible while a replacement image source is loading.
- Drawing preview state is cleared synchronously before the create request.
- Ping delivery follows the player-visible active scene; a GM ping on a private scene remains visible to GM and reports that no players can see it.
- Token base color and optional border color are persisted, revision-checked, broadcast, and included in undo/redo.
- Stack labels show the number of additional tokens in the occupied grid cell.
- Grid visibility is a local GM preference beside the existing fog visibility/opacity controls and does not affect players or scene state.

## Revision
- Pending commit at checkpoint creation.

## Changed files
- apps/server/src/realtime.ts
- apps/server/src/routes.ts
- apps/web/src/App.tsx
- apps/web/src/renderers/Orthographic2DRenderer.tsx
- apps/web/src/renderers/SceneRenderer.ts
- packages/contracts/src/index.ts
- packages/db/src/schema.ts
- packages/db/drizzle/0015_token_appearance.sql
- packages/db/drizzle/meta/_journal.json
- tests/pool-b-http.test.ts
- tests/realtime.test.ts

## Verification
- Format changed files: PASS
- Lint: PASS
- Typecheck: PASS
- Unit/integration: 153/153 PASS
- Production build: PASS (existing bundle-size warning)
- Playwright: 21 PASS, 1 credential-dependent test skipped
- git diff --check: PASS

## Blockers
- None for UIX-227/UIX-231.
- Existing non-blocking mocked-backend proxy noise and Konva six-layer performance warning remain outside this pool.

## Next action
- Continue the release batch with UIX-230 music. After that run one combined Luna review and production release gate.
