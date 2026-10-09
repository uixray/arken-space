# UIX-644 scene diagnostics checkpoint — 2026-10-09

## Result

One bounded connected matrix completed against the already-running local teststand; no service restart or fixture write. Chrome desktop passed scene selection/restore by pointer and keyboard. Chrome compact exercised both modalities and restoration, but the final `noRestMutation` assertion failed because the first diagnostics harness version counted requests from login onward; it observed `POST /api/auth/gm` and `POST /api/chat/read` and cannot attribute either to scene selection. All scene inventory and published-active invariants were true. This is an unresolved measurement gate, not a demonstrated scene-publication defect. Firefox timed out waiting for the app shell after route HTTP 200, with zero sign-in buttons detected; no scene actions ran.

## Revision and evidence

- Product source tested: `52013d43e6f2fca1bb268c38608afde9cd76424a`.
- Current document HEAD recorded in the receipt: `f67e53b7453a79230624d1ca2e228e5f3b35d928`.
- API-only sanitized summary: `.data/qa-prep/uix644-scene-zoom-20261008/scene-diagnostics-api-summary-20261009-025153505Z.json`; SHA-256 `118212CF009CC667A08A783C9A081F4053A68DB1C54E6B6737526570CEC5EFD6`.
- Original immutable matrix output: `.data/qa-prep/uix644-scene-zoom-20261008/scene-matrix-20261009-025153505Z.json`; SHA-256 `B464C928970915D01B9D09E7CF9F860E6F14FDF7C762B49B569F1643CBB66AE6`. Its request inventory includes dev-module paths; use the API-only projection above for compact review. Neither receipt includes query strings, GM route token, response bodies, scene names, or fixture contents.
- Updated ignored harness: `.tmp/uix644-scene-matrix.qa.mjs`; SHA-256 `7A2EF654E940C8699A65E718059DDC0D9ECE1D1A86E2BC8B3B3B03A2E93FDD6F`. The harness now records API method/path/status aggregates only and resets an interaction-only mutation counter immediately before scene actions. This edit occurred after the matrix; it is unverified and was not rerun. `node --check` passed after the edit.

## Matrix findings

| Cell | Outcome | Safe diagnostics |
|---|---|---|
| Chrome desktop | PASS | Route 200; inner/client viewport 1360×900; pointer, keyboard and restore passed; bootstrap 200, expected IDs/count, unchanged published active scene, no interaction mutation, 0 page errors and 0 RO signals. |
| Chrome compact | BLOCKED / partial | Route 200; actual inner/client viewport 390×844 (outer 516×932); pointer, keyboard and restore passed. Final booleans: bootstrap 200=true, expected scene count=true, IDs=true, published active unchanged=true, `noRestMutation=false`. Aggregate write observation was `POST /api/auth/gm:1`, `POST /api/chat/read:1`; counter began before login, so action attribution is unavailable. |
| Firefox desktop | BLOCKED | Route 200; viewport inner/client 1360×900; sign-in button count 0; timed out at `login-wait-shell`; no scene action. |
| Firefox compact | BLOCKED | Route 200; viewport inner/client 390×844 (outer 500×938); sign-in button count 0; timed out at `login-wait-shell`; no scene action. |

The test used the existing approved B fixture and retained second scene; it did not mutate/publish fixture state. Browser viewport emulation was used only for compact product-layout interaction, not as true browser zoom. A zero RO count in these short interactions does not reproduce or clear the historical causal ResizeObserver issue.

## Checkpoint / next action

- Decision: do not classify compact as PASS or as a reproduced product defect; the scene and broadcast invariants passed, while the mutation counter's scope prevented a valid no-write conclusion. Firefox remains blocked at login. No retries in this pool.
- Changed files: ignored `.tmp/uix644-scene-matrix.qa.mjs` harness only and this new checkpoint. No product source, tracked tests, fixture contents, or runtime data were edited by this matrix.
- Verification: local Vite `14183/healthz` and API `14182/healthz` returned 200 before the run; no restart. The one matrix emitted the receipts above. The harness syntax check produced no JS diagnostic, but runtime evidence after its counter-scope correction is not yet available.
- Remaining blockers: validly attribute any REST mutation to scene selection using the updated interaction-only counter; Firefox login shell timeout; native browser zoom and causal ResizeObserver replay remain separate open gates.
- Next action: if another runtime matrix is authorized, run the corrected ignored harness once and keep all four cells plus final assertions/HTTP status counts in one immutable receipt. Do not alter product behavior unless the corrected evidence reproduces a specific scene-selection defect; true zoom/RO require their own prerequisites. Preserve the created B scene for manual cleanup.

## Final corrected matrix delta — 2026-10-09

Root authorized one corrected final connected run. It used the retained B scene, performed no fixture write or runtime restart, and did not modify product code. This final receipt supersedes the prior Firefox login-timeout result:

- Implementation SHA remained `52013d43e6f2fca1bb268c38608afde9cd76424a`; current document HEAD `f67e53b7453a79230624d1ca2e228e5f3b35d928`.
- Immutable full matrix `.data/qa-prep/uix644-scene-zoom-20261008/scene-matrix-20261009-025614890Z.json`, SHA-256 `392BCBAC38DE30FE4A04633E6800204B5E527105FEDD82CE9383A04CEA2BC57A`.
- Sanitized API-only projection `.data/qa-prep/uix644-scene-zoom-20261008/scene-diagnostics-api-summary-20261009-025614890Z.json`, SHA-256 `2C27108BCCA27C61146F76782CD89E8CB0F8D957425A35F050E852CD4DBDD1C3`.
- Corrected ignored harness `.tmp/uix644-scene-matrix.qa.mjs`, SHA-256 `95EA182D81DDFBEE1E13CEDED388F18D5E8826524AADECE2800B6B38A0A421B4`; syntax check passed before the one run. API method/path/status counts are retained; GM auth and chat-read are reported as separate background classes; only non-allowlisted write methods after the interaction baseline count against the scene-mutation invariant.

| Cell | Final result |
|---|---|
| Chrome desktop 1360×900 | **PASS** pointer + keyboard selection and restore; bootstrap, two-scene inventory, unchanged published active scene and no scene mutation all true. |
| Chrome compact inner/client 390×844 (outer 516×932) | **PASS** actual compact bottom-menu scene-manager route; pointer + keyboard select/restore; final state invariants true; no scene mutation. |
| Firefox desktop 1360×900 | **PASS** pointer + keyboard selection and restore; final state invariants true; no scene mutation. This supersedes the previous Firefox login timeout. |
| Firefox compact inner/client 390×844 (outer 500×938) | **BLOCKED** at `compact-keyboard-restore`, generic `AssertionError`. Pointer and keyboard selection steps passed; restore step did not complete. Receipt does not serialize the assertion label or final state, so this is an unresolved compact-Firefox interaction result, not a proven product defect or a pass. |

All four routes returned HTTP 200 and exposed one sign-in button; no page errors, failed requests or failed scripts were counted. Each authorized session recorded GM auth and chat-read separately from scene mutations. No scene mutation was observed in completed interaction counters. The Firefox compact failure is after successful login/scene selection, so its former login blocker is no longer current. No source fix is proposed without identifying which restore assertion failed. No further retries in this pool.

### Final checkpoint

- Decision: desktop Chrome/Firefox and compact Chrome scene selection gates pass on the exact implementation SHA. Keep Firefox compact blocked pending the missing assertion-specific evidence. Do not change product behavior from the generic error alone.
- Changed files: this checkpoint and ignored `.tmp/uix644-scene-matrix.qa.mjs`; no product source/tests/fixture data changed. Existing retained empty scene remains available for explicit manual cleanup.
- Verification: corrected four-cell matrix above; Vite 14183 and API 14182 returned 200 immediately before run; no restart. True browser zoom and causal ResizeObserver replay were not tested and remain separate gates.
- Next action: if Firefox compact is pursued in a later pool, first make the harness record the safe failure label/restore-state predicate and return only that targeted matrix under explicit authorization. Do not rerun the current matrix or infer/patch the product from this receipt. Keep UIX-644 open.
