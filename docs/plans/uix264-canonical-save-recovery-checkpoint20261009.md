# UIX-245/264 canonical save recovery — lane B checkpoint

- Date: 2026-10-09
- Product checkout: `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space`
- Integrated base: `d86dbef` (docs-only descendant of the source base `a90aa57938398e8d2a2ec8a415a9ad02ff9b5796`); lane B source accepted in root commit `2a5bd9b310dac761d5acd2af061667bf7a6fa4c9`. This later checkpoint refinement changes documentation only; frozen candidate remains that exact commit.
- Frozen package/export `8c0a0f7` is untouched and remains independent.
- Parallel lane A owns map schema/contracts/routes/UI. Its changes were preserved; this checkpoint covers B only.

## Decision / behavior

- Existing canonical PATCH now captures only changed fields into frozen `{entityId, actionId, revision, payload}`.
- Editor retries an ambiguous request with exactly the same action/revision/payload. Duplicate response is discriminated from a DTO and triggers authoritative detail refetch; failed refetch does not claim saved or discard draft.
- On 409, preserve local draft and keep latest server DTO separate. Show changed-field local/base/server values. Discard loads latest; only explicit reapply uses latest revision, only intentional changed fields, and a fresh action ID. A subsequent 409 will repeat the same review path.
- Editor fields lock during pending/unknown/conflict states. Parent selection/close prompts to stay or explicitly discard. State guard updates synchronously from field changes to avoid a stale parent callback race.
- A synchronous in-flight ref prevents same-render double PATCH or conflict refresh requests. Request epochs fence refresh and save completions across refresh supersession/unmount; exact pending envelopes remain unchanged.
- No contracts/schema changes and no server route implementation changes. Existing non-PATCH mutations, media, relations, and instance workflows remain outside this lane. No persistent local storage of GM data.

## Changed files (lane B only)

- `apps/web/src/WorldContentWorkspace.tsx`
- `apps/web/src/WorldContentWorkspace.css`
- `apps/web/src/WorldContentWorkspace.test.tsx`
- `apps/web/src/world-content-client.ts`
- `apps/web/src/world-content-client.test.ts`
- `apps/web/src/canonical-edit-state.ts`
- `apps/web/src/canonical-edit-state.test.ts`
- `apps/server/src/world-content-routes.integration.test.ts`
- `tests/e2e/uix264-canonical-save-recovery.spec.ts`

## Verification / evidence tier

- Web typecheck: PASS.
- E2E TypeScript project typecheck: PASS (no diagnostics).
- Focused unit + editor component + PGlite route integration: 4 files, 38 tests PASS, including rapid double-save → one PATCH and double conflict-refresh → one detail read. PGlite harness is local synthetic database behavior; route implementation itself was not changed.
- Direct installed Vite production build: PASS (4791 modules); existing >500 kB chunk-size advisory only. The pnpm `build` script shim was unavailable, so the same installed Vite binary was invoked directly.
- Mocked-API Chrome, actual mounted app, direct local Vite, no backend: 2/2 at 390px and 1280px PASS. Flow verifies 409 local draft preservation, explicit compare/reapply using revision 5 and only the changed name field with a new action ID, and unsaved switch confirmation plus Stay preserving the draft. The browser run did not exercise closing the editor. This is browser UI evidence with mocked API, not production/server runtime evidence.
- Direct Vite server was stopped after the run. One initial E2E run used an inaccurate mock for instance responses and failed on app-render error; corrected fixture then passed. No retry/download/installation.
- Switch/close nested dialog interaction is kept at mounted-browser tier rather than weakening jsdom accessibility queries; mounted browser specifically proves switch confirmation and Stay preserves the draft, not close confirmation.
- No private fixture/data used.

## Residuals / next

- Other world-content create/lifecycle/archive/media/relation clients do not gain the exact retry envelope.
- Route test confirms existing duplicate action handling and no duplicate audit side effects; no database production data or migration exercised.
- Root should review lane B alongside lane A before a future candidate freeze. Do not attribute this future-wave verification to frozen `8c0a0f7`.


