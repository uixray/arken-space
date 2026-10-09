# UIX-458 AC2/AC3 assignment pool checkpoint — 2026-10-09

## Decision and revision

Implemented the bounded assignment/discovery/display slice in the connected product checkout. Pool gate ran at HEAD `600715c` (uncommitted owned changes; concurrent ruler/instance work preserved). Do not treat this as full UIX-458 acceptance.

School grants remain existing immutable `SCHOOL` assignment envelopes against exact ACTIVE pack versions. Only the GM can explicitly promote a DRAFT/REFERENCE graph through the existing CAS lifecycle command; ordinary save does not activate. PLAYER-visible branch summaries are derived from current SCHOOL assignment snapshots, are exact-version pinned, and exclude GM_ONLY names; DISCOVERED visibility remains visible only because the school is already assigned. NODE-only grants do not appear as a school grant.

## Changed files (owned)

- `apps/server/src/spell-pack-routes.ts`, `apps/server/src/spell-pack-routes.integration.test.ts`
- `apps/server/src/spell-projection-routes.ts`, `apps/server/src/spell-projection-routes.integration.test.ts`
- `apps/web/src/SpellSchoolsWorkspace.tsx`, `apps/web/src/SpellSchoolsWorkspace.test.tsx`, `apps/web/src/spell-schools-client.ts`
- `apps/web/src/CharacterSpellBranches.tsx`, `apps/web/src/CharacterSpellBranches.css`, `apps/web/src/CharacterSpellBranches.test.tsx`
- `apps/web/src/character-spell-branches-client.ts`, `apps/web/src/character-spell-branches-client.test.ts`
- Narrow mount in `apps/web/src/sidebar/CharacterWorkspace.tsx`
- `tests/e2e/uix458-character-branches.spec.ts`

Concurrent ruler and UIX-264 work remains untouched. No commit, install, Linear write, remote action, content publication or deployment.

## Verification

- Connected web typecheck: passed, no diagnostics.
- Connected server typecheck: passed, no diagnostics.
- Focused web suites: 3 files, 16 tests passed (client + character UI + school editor), including initial-load retry/rejection and character-switch stale-response regressions, plus edited-draft activation protection.
- Touched server route suites: 2 files, 17 tests passed (school discovery + character branch privacy/pinned version).
- Web production build via installed Vite: passed (4786 modules). Existing chunk-size advisory remains; build is not a release artifact.
- Installed Chrome synthetic mounted flow: 2 tests passed at 390px and 1280px. Each mock fixture created a custom draft, required explicit ACTIVE confirmation, assigned a SCHOOL, reloaded as authorized PLAYER and verified the pinned branch; then switched to a second character and verified the zero-branch state. All API responses were mocked; this is not a live database/auth receipt.
- Follow-up pending-save dialog integration assertion: `uix458-spell-schools-editor.spec.ts` focused test passed in installed Chrome. While the save request was held in-flight and again after an ambiguous response, Escape and outside click left the actual dialog open; exact retry succeeded and Escape closed it after settlement.
- Follow-up editor safety: activation is now bound to the persisted selected graph fingerprint/version. Editing a loaded draft disables activation, clears any confirmation, and shows an explicit save-first instruction; targeted regression confirms lifecycle endpoint is not called for unsaved local contents.
- These route tests use synthetic fixtures; API/database state is not live.

## Residuals / next action

- Still required: root's review of the connected delta. The assignment flow and dialog interaction use mocked responses, not a live route/database; keyboard coverage is limited to the existing editor/component tests.
- Root owns final integration/review. Do not infer database durability from mocked browser output.
- Unreviewed reference-import branches, real content activation, UIX-457 frames and UIX-459 SP remain outside this pool. No real campaign/reference content was activated, and whole UIX-458 remains open.
