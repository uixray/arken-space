# UIX-245 known-relations filter checkpoint — 2026-10-09

## Pool result

- Base revision: `8c0a0f7ed72f853e49942519d155c5eef5572a9e` (post-458 freeze). Lane A changes remain uncommitted and outside the frozen package candidate.
- Decision: `relatedTo` means direct adjacency in either edge direction. The server validates that the subject is visible before relation lookup, applies current result visibility, and uses correlated `EXISTS` to avoid duplicate rows and N+1/client graph fetching. No schema or policy changes.
- UI: from an open visible article, “Показать связанные статьи” activates the “Связано с” filter; reset removes only that relation criterion, retaining type/tags/search values. Empty related results name the active subject. A request sequence token prevents older responses or closed-panel requests from winning.
- Browser QA exposed a real 390px detail-pane visibility defect in the prior two-column layout. The owned encyclopedia CSS now stacks list/detail panes below 720px; desktop layout remains unchanged.

## Changed files

- `apps/server/src/world-content-routes.ts`
- `apps/server/src/world-content-routes.integration.test.ts`
- `apps/web/src/world-content-client.ts`
- `apps/web/src/world-content-client.test.ts`
- `apps/web/src/WorldEncyclopediaWorkspace.tsx`
- `apps/web/src/WorldEncyclopediaWorkspace.css`
- `apps/web/src/WorldEncyclopediaWorkspace.test.tsx`
- `tests/e2e/uix245-known-relations.spec.ts`
- `docs/plans/uix245-known-relations-checkpoint20261009.md`

## Verification

- PASS — focused Vitest: 3 files, 34 tests (client serialization, mounted reader/filter/reset/navigation/stale response, route authorization/filter behavior).
- PASS — `@arken/web` and `@arken/server` TypeScript checks.
- E2E TypeScript project check is blocked by existing diagnostics outside this lane (`asset-usage.ts`, `global-sticker-catalog.ts`, `routes.ts` multipart typings; unrelated account-auth-local-http, uix314 fog animation, and uix509 ruler specs). No diagnostic referenced the new UIX-245 spec.
- Integration test uses in-memory PGlite/PostgreSQL semantics, not mocked query results; checks bidirectional edges, type/tags/q conjunction, PLAYER hidden endpoint/subject denial and error equivalence, GM broader visibility, safe DTO fields, invalid UUID.
- PASS — synthetic Chrome E2E, both 390px and 1280px, real mounted workspace navigation, safe/player-shaped mock API responses, selecting a visible subject, filtering, keyboard search, resetting while preserving search, and query capture (2 passed). The navigation source intentionally hides the reader from PLAYER navigation; this test does not claim a PLAYER session. PLAYER authorization/hidden endpoint privacy are independently tested against PGlite above.
- Browser startup initially failed with the pnpm shim and then used the actual installed Vite executable under the dependency junction's `.pnpm/vite@8.2.1_.../node_modules/vite/bin/vite.js` on loopback port 5187. The owned server was stopped after the gate and the port was released. No install/download retry attempted.
- No real API/deployment, production content, database migration, commit, or Linear update performed.

## Blockers / residuals

- No human acceptance or release-wide/runtime claim. Existing issue remains broader than this slice.

## Next action

Root reviews the bounded diff and checkpoint. Keep package export pinned to the prior frozen SHA.
