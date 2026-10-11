# UIX-264 ITEM instance fields checkpoint — 2026-10-09

## Scope and decisions

Bounded GM-only client extension for ITEM campaign instances: nullable quantity (integer 0..2,147,483,647) and nullable condition (trimmed 1..200 characters). Empty quantity/condition clear to null; explicit quantity zero remains `0`. Non-ITEM instances do not display or send these fields. This does not finish UIX-264 and introduces no owner/container/location/media/discovery/economy/delete behavior.

Contracts and routes already expose/persist the fields under GM authorization, campaign scoping, CAS revisions, action idempotency, and audited mutations; no backend changes were made. Existing retry payload snapshots, conflict draft/rebase, and keyed canonical isolation remain in use.

## Revision / changed files

Starting revision: d8e8b51b630e4c707cbe39b8e7554028c04d9b5c.

- `apps/web/src/WorldContentInstancesPanel.tsx` — type-aware ITEM fields, validation, null-vs-zero semantics, ITEM-aware dirty comparison, conflict display, duplicate-create matching.
- `apps/web/src/WorldContentInstancesPanel.css` — unchanged; existing responsive form rules suffice.
- `apps/web/src/world-content-instances-client.ts` — field type widened to existing DTO fields.
- `apps/web/src/WorldContentWorkspace.tsx` — pass existing selected canonical type.
- `apps/web/src/WorldContentInstancesPanel.test.tsx` — ITEM creation/edit/unset, zero, invalid values; existing LOCATION test checks controls/payload absence.
- `tests/e2e/uix264-instance-manager.spec.ts` — synthetic ITEM create/retry/edit/reload/zero/unset/invalid at 390/1280.

## Verification

- `vitest run apps/web/src/WorldContentInstancesPanel.test.tsx` — **7 passed**.
- `tsc --noEmit -p apps/web/tsconfig.json` — **fails** on parallel UIX-382 work: `MusicBar.test.ts` call sites do not supply the new required `audioTracks` prop. UIX-264 files were clean in the scoped diagnostic filter; the shared audio worker owns the blocking source/test mismatch.
- `playwright test tests/e2e/uix264-instance-manager.spec.ts --project=chromium --workers=1 --retries=0` — **3 passed** (GM CRUD at 390/1280, PLAYER no-preload). Reused local Vite started from installed Node/Vite binaries; all APIs were mocked.
- No credentialed/live backend, external auth, remote host, or production state was used.

## Blockers and next action

The scoped browser gate passed. Root should review the focused diff and coordinate the separate full-web typecheck failure with the UIX-382 owner. Full UIX-264 lifecycle, backend session/campaign integration, and real persistence remain open.


