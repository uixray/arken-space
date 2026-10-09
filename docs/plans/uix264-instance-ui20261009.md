# UIX-264 campaign instance manager checkpoint — 2026-10-09

## Scope and decision

Partial GM UI slice only. The campaign is still selected by the authenticated server session; the browser filters by canonical `worldContentId` and can edit only `displayNameOverride`, `currentState`, and `gmNotes`. No PLAYER instance list/preload or new instance policy is introduced. Canonical content remains unchanged.

## Revision and changed files

Working tree based on `76fc9cccaafe5dd6795fb4f7c33344990d39eed0` (candidate capture is immutable and predates these source changes).

- `apps/web/src/WorldContentInstancesPanel.tsx` — list/create/edit, pending/error/empty/conflict states, immutable retry requests and explicit revision rebase.
- `apps/web/src/WorldContentInstancesPanel.css` — scoped responsive styles.
- `apps/web/src/world-content-instances-client.ts` — typed API helpers for existing routes only.
- `apps/web/src/WorldContentWorkspace.tsx` — panel below selected canonical entity, keyed by canonical id to isolate late async responses.
- `apps/web/src/WorldContentInstancesPanel.test.tsx` — 5 focused component tests, including 409 draft retention, uncertain create/update exact retries and deferred create after canonical switch.
- `tests/e2e/uix264-instance-manager.spec.ts` — synthetic API browser tests at 390/1280; GM create/edit/reload/409, network error and retry, PLAYER exclusion.

## Verification

- `.\node_modules\.bin\vitest.cmd run apps/web/src/WorldContentInstancesPanel.test.tsx` — **5 passed**.
- `.\node_modules\.bin\tsc.cmd --noEmit -p apps/web/tsconfig.json` — **exit 0**.
- `$env:E2E_PORT='14243'; $env:E2E_BASE_URL='http://127.0.0.1:14243'; .\node_modules\.bin\playwright.cmd test tests/e2e/uix264-instance-manager.spec.ts --project=chromium --workers=1 --retries=0` — **3 passed**, Chromium, mocked APIs, at 390 and 1280 plus PLAYER no-instance test.
- No backend/database, credentials, remote host, or production state was used. Existing backend integration tests remain separate evidence and were not rerun here.

## Remaining scope / next action

This does not complete the broader UIX-264 lifecycle. Canonical CRUD, entity revisions, archive/delete policy, owner/portrait/location/quantity/condition/discovery controls, and any PLAYER view remain outside this slice. Browser gate used synthetic fixtures; backend session/campaign isolation and live persistence are not proven by it. Next: root review/integrate at the connected pool gate; then decide whether to schedule live backend contract verification separately.
