# UIX-644 scene/zoom local pool — 2026-10-08

## Result

The initial read-only pass was blocked by a single-scene fixture and inability to activate browser-chrome zoom. After explicit owner authorization for the isolated teststand, one empty B scene was created through the GM UI. The corrected matrix fully passed Chrome desktop scene select/restore, partially exercised compact selection but failed an unresolved final invariant, and timed out at Firefox login. True browser zoom and causal ResizeObserver evidence remain blocked. No campaign-A data/credentials were accessed; no production/runtime source files changed.

## Exact candidate and artifacts

- Tested source HEAD: `52013d43e6f2fca1bb268c38608afde9cd76424a` (Escape pool already frozen by root); the harness itself made no source edits.
- Ignored harness: `.tmp/uix644-scene-zoom.qa.mjs`.
- Nonsecret receipt: `.data/qa-prep/uix644-scene-zoom-20261008/receipt-20261008-180543810Z.json`.
- Receipt SHA-256: `C7CE4A0F78483E43ED51E8EDD0619A3E7E8FB890BA0D663844D869DBA861C374`.
- Harness loads only the approved B GM route token programmatically. It never prints or serializes it; the receipt contains no auth token, scene name, scene ID, or response body.

## Four-cell bounded check

Each Chrome/Firefox × requested desktop/compact headed cell loaded B GM and performed `GET /api/bootstrap` → HTTP 200. Snapshot contained **one scene** in all four cells (active index 0), so real pointer and keyboard selection were not attempted; there was no alternate scene and creating one would be an unauthorized fixture write. Selection: BLOCKED, not FAIL/pass.

The harness sent the browser zoom-in accelerator and tested real browser observables; it did not use viewport/deviceScale/CSS zoom or pinch emulation. In every cell DPR and CSS client width were unchanged after the shortcut (DPR 1.5 before/after; CSS zoom remained 1). Zoom therefore remains BLOCKED: this Playwright keyboard-input path did not activate browser UI zoom. Reset to baseline was confirmed, but that does not count as zoom evidence.

Requested and actual outer window sizes show the compact limitation: Chrome desktop 1360×900; Chrome requested 390×844 produced 516×844; Firefox both requested desktop and compact produced 1295×967. These are **not** valid Chrome-390/Firefox-compact cells. Do not claim compact acceptance.

Across all four cells after the post-login observation baseline: 0 POST/PUT/PATCH/DELETE requests, 0 page errors, 0 ResizeObserver console signals. This short check is only a non-reproduction note; it is not causal ResizeObserver evidence or a full runtime gate. No scene selection action occurred.

## Concrete blockers / next action

1. **Scene selection:** B has only one scene. Need an owner-approved isolated B fixture with at least two scenes (or explicit permission to create an additional disposable B scene), then repeat the real GM picker pointer + keyboard select/restore checks. Do not derive an alternate scene by reading private fixture/seed contents.
2. **True browser zoom:** Playwright's page-keyboard accelerator did not affect browser zoom. Need a verified OS/browser-chrome input path that sends the shortcut to the headed browser UI and observable compact-size window control; otherwise report the true-zoom gate blocked. Keep window resizing separate from browser zoom and record actual dimensions, not requested ones.
3. **ResizeObserver causal replay:** unchanged: this pool did not replay the historical trigger. Its zero RO count cannot clear the older failure; exact old/new source and replay fixture prerequisites are still unresolved.

## Checkpoint

- Decision: keep scene selection, compact sizing and true browser zoom BLOCKED; no synthetic scene, viewport emulation or warning suppression as substitute.
- Changed files: `.tmp/uix644-scene-zoom.qa.mjs` and this checkpoint only. Existing nonsecret receipt is ignored local QA evidence.
- Verification: four headed browser cells, four bootstrap GETs returned 200, one scene each, zero writes/errors; actual zoom shortcut did not change observables. Receipt SHA recorded above.
- Blockers: approved B fixture lacks a second scene; real OS/browser UI zoom input and valid compact windows not verified; historical RO cause not exercised.
- Next action: request isolated-scene fixture permission and a native browser-input path before another runtime pass. No tests, auth, server starts, remote operations, deployment, push, merge, or Linear updates beyond this bounded pool.

## Owner-authorized teststand scene fixture and corrected matrix — 2026-10-08

The owner directly authorized mutations on this isolated teststand. This does **not** permit campaign A access, production/remote operations, deployment, or push/merge. One empty scene was created for this bounded UIX-644 selection test, then retained for later cleanup; do not delete it automatically.

### Baseline and creation receipt

- Implementation source under test remains `52013d43e6f2fca1bb268c38608afde9cd76424a`. Current document HEAD `0e571489119159d250039391a20888ded9ca7830` is a docs-only commit (four plan files only).
- Before the write, the harness saved the one-scene B inventory, original active-scene ID and count to `.data/qa-prep/uix644-scene-zoom-20261008/scene-inventory-before-20261008-181216788Z.json`; SHA-256 `9E31246B777C8BDCF201EFA42243CFDB891F36555C5E79015D8C7D7201A483E7`.
- Created through the real GM UI flow (header create → scene manager → new scene editor → save); official `POST /api/scenes` returned **201**, new empty scene ID `e851ef18-7392-4e6c-9a62-21a758208c05`, `mapAssetId=null`. B scene count moved 1→2. No activate/publish path was invoked; original broadcast active ID remained `2e1f2a51-7b48-4971-b76f-6cf067e98c69` in the post-create bootstrap.
- Creation receipt `.data/qa-prep/uix644-scene-zoom-20261008/scene-selection-receipt-20261008-181216788Z.json`; SHA-256 `E4B61C56DAD63BD2CF02F701156909538EC491EA5DE4A0CD3756EF93977AA7F7`. It stores IDs and counts only; scene name/token are not recorded. Preserve this inventory for explicit later cleanup.

### Corrected interaction matrix and retained failures

- A few earlier attempts are preserved, not erased: `.data/qa-prep/uix644-scene-zoom-20261008/scene-selection-receipt-20261008-181044218Z.json` and `...181138795Z.json` stopped before any baseline/write; the first matrix attempts `...scene-matrix-20261008-181436968Z.json` and `...182019629Z.json` ran while Vite was absent/using the initially wrong compact path. Vite was relaunched by the authorized owner-coordinated helper; no parallel restart was attempted.
- Source inspection showed `.compact-sections-button` is intentionally hidden by `apps/web/src/mobile-foundation.css`; the correct compact app route is the bottom `#compact-nav-menu` → campaign menu “Сцены” tile → manager card “Открыть для мастера”. This remains a separate compact interaction contract from the desktop header ScenePicker.
- Final corrected no-write run receipt `.data/qa-prep/uix644-scene-zoom-20261008/scene-matrix-20261008-182739913Z.json`, SHA-256 `7680DBB5A1EE5BE4E59F154938367973665394FBA0335FADCE58A61AAE50197F`. Harness `.tmp/uix644-scene-matrix.qa.mjs`, SHA-256 `91E2882989CC4D0CFDDE20145523977F99B6375D9EE3BAA353C68F97DF7EEE44`. No private names/tokens/response bodies are emitted.
  - Chrome headed, desktop 1360×900: pointer and keyboard select/restore both passed. The test checked picker/radio or manager state, outbound `scene:view` IDs and server `game:snapshot` responses; final active/broadcast scene ID was unchanged; 0 REST mutations, page errors or ResizeObserver signals.
  - Chrome compact, viewport-emulated 390×844: actual bottom-menu route reached the manager; pointer and Tab+Enter selection/restoration plus `scene:view`/snapshot assertions passed. This is **partial interaction evidence, not a cell PASS**. The final gate failed with `phase=verify-active-and-no-writes` / `errorClass=assertion_or_harness`. The possible failing checks were final sorted scene inventory, unchanged published active-scene ID, or zero REST-write counter; the harness did not serialize which predicate differed. Do not infer which one or upgrade the cell to PASS.
  - Firefox desktop and compact: headed launch was previously blocked at login; the final allowed headless viewport run timed out during login before interactions. Its final sanitized receipt has no route-status/sign-in-count fields, so exact auth substep/status is unavailable. No selection claim for either Firefox cell.
  - This scene-interaction matrix intentionally uses Playwright viewport emulation and makes no true browser zoom claim. The earlier actual zoom-shortcut probe remained blocked because DPR/CSS viewport geometry did not change. Causal ResizeObserver replay was not part of this pool; its historic failure remains open. The brief runs recorded zero RO signals, which is not causal acceptance.

### Pool checkpoint

- Decisions: retain the new B fixture scene and nonsecret inventory for manual cleanup; never publish it; preserve all blocked/failed attempts; no repeated runtime retries after this bounded corrected matrix.
- Changed files: ignored harnesses in `.tmp/` and this checkpoint delta only. No product code, test, private fixture source, or world data file changed except the single authorized scene creation through the product UI.
- Verification: UI create POST 201; prewrite/post-create bootstrap counts; Chrome desktop full pointer/keyboard pass with measured 0 REST writes; Chrome compact selection/restoration interaction partial evidence but final invariant/REST gate unresolved; Firefox login timed out. Scene selection was UI-driven. The compact post-interaction REST counter was not serialized because its final assertion interrupted receipt assignment, so do not claim 0 REST writes for that cell. No browser zoom or RO causal claim.
- Blockers: compact final invariant mismatch is not identified by the sanitized receipt; Firefox login timed out with exact substep/status absent; true browser zoom still needs native browser-UI input; historic RO causal replay unchanged. No retry is authorized by this checkpoint.
- Next action: retain the new B scene and receipt as manual cleanup inventory; keep compact overall BLOCKED/partial and Firefox BLOCKED. A future diagnostic must explicitly serialize the final invariant booleans and safe login status before any new browser run is authorized. Keep UIX-644 open.

