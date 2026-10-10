# UIX-264 campaign-instance deletion checkpoint — 2026-10-09

## Decision and base

Lane B implemented at checkout HEAD `8c0a0f7` with uncommitted changes. Existing API semantics are reused: GM-only campaign-scoped hard delete, immutable `{actionId, revision}`, CAS conflict, duplicate replay, 204 success. This does not delete the canonical entity or sibling instances, and adds no cascade/restore/soft-delete policy.

Schema review: campaign FK cascades only on campaign deletion; `world_content_id` references canonical content without `ON DELETE CASCADE`; instance rows have no discovered child-table FK references. Portrait ID has no FK, owner deletion sets null, and campaign/location composite FK sets null. No server route/schema changes were made. Existing route integration suite uses local PGlite and migrations (not a remote or production DB).

## Owned files

- `apps/web/src/WorldContentInstancesPanel.tsx`
- `apps/web/src/WorldContentInstancesPanel.test.tsx`
- `apps/web/src/world-content-instances-client.ts`
- `apps/web/src/world-content-instances-client.test.ts`
- `tests/e2e/uix264-instance-delete.spec.ts`
- This checkpoint

Preserved concurrent UIX-245 encyclopedia work and all other dirty files. No install, commit, Linear write, remote operation, production data or deployment.

## Behavior and evidence

- Explicit accessible confirmation names the selected instance and explains campaign-only scope. Cancel is default; dirty edit warns and requires an explicit “discard changes and delete” action. No delete control is exposed for a new unsaved draft.
- Request uses the captured exact action ID and revision; ambiguous retries reuse that envelope. 204 and duplicate 200 reconcile from the list. Ambiguous failures refresh current state without claiming who deleted; 404 is reported as unavailable/not confirmed; 409 reloads the current revision and requires a fresh confirmation. No optimistic removal.
- Panel/client focused tests: 17 passed, including cancel/focus return, sibling preservation, dirty-edit guard, empty last row, exact retry, CAS re-confirmation, and external 404.
- Existing route integration: 6 passed / 19 skipped by focused name pattern (PGlite plus migrations), covering GM success, foreign campaign 404, stale revision 409, duplicate replay, and PLAYER forbidden.
- Web typecheck passed. Browser: new mocked-API Chrome flow passed 2/2 at 390/1280; cancel/Escape focus, keyboard-confirm, selected deletion, sibling + canonical unchanged, and reload are covered. This is not live UI/API persistence evidence.

## Blockers / next action / residuals

- Root review found stale async continuations on errors after a campaign switch, and a confirmed-deleted selection could remain editable if list reconciliation failed. Fixed by fencing each post-await catch with the captured canonical ID and clearing the confirmed-deleted row/selection/draft before reconciliation. Added regression for switching canonical while ambiguous reconciliation rejects.
- Follow-up focused panel gate: `WorldContentInstancesPanel.test.tsx` — 16 passed (Vitest 4.1.10, `--maxWorkers=1 --hookTimeout=120000`). No broad suite or browser rerun for this narrow source fix. No commit made.
- Existing route tests establish the authoritative handler contract but the browser flow is mocked. No production or remote persistence test was run.
- Wider UIX-264 container, token binding, canonical-location links, player instance projection, and whole-issue acceptance remain open. Any future constraint-driven cascade policy requires a separate root decision.
