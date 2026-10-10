# UIX-644 next runtime pool feasibility — 2026-10-08

## Scope and guardrails

Read-only harness feasibility plan; no browser run, source edit, seed/fixture read, or credential access. Wait until the current GlobalStickerPackManager Escape browser matrix is complete before any browser work. Candidate checkout HEAD at planning time: `bbc52b1`; the manager Escape files remain dirty and unverified. Use only the approved synthetic campaign B via its already-authorized harness path if needed; do not access campaign A or print/read credentials. Existing receipts/handoff say B GM/PLAYER identities were rotated and B can be used programmatically, but do not establish that B has two selectable scenes or a suitable owned-character token. Never create/delete fixture records to make a test pass.

## Feasibility findings

### Scene selection: feasible without gameplay mutation, fixture prerequisite unknown

- `apps/web/src/ScenePicker.tsx` is the real GM control. A `menuitemradio` click calls `onSelectScene(scene.id)` then closes the popup; `apps/web/src/App.tsx:1615` wires that callback to `setViewedSceneId`, so this is a viewed-scene transition, not a scene publication or persistent gameplay mutation.
- Executable path after the Escape pool: use the already-authorized B GM session only if a non-secret snapshot-level check shows at least two scenes. Open the real header picker, click a different scene by its actual rendered accessible name, assert its radio `aria-checked`, active header/canvas scene identity and the selected scene's tokens/assets; assert broadcast/published scene identity unchanged and no mutation request. Restore the original viewed scene through the same UI. No direct DOM state setters or fabricated snapshot.
- If B does not expose two scenes, stop: there is no documented approved alternative fixture with two scenes. Ask the owner/root for permission to create an isolated extra scene in B or provide an approved fixture; do not mutate B speculatively. PLAYER scene picker is read-only and is not a substitute for the GM selection gate.

### True browser zoom: harness can test actual zoom, but not via viewport/DPR emulation

- Current `playwright.config.ts` names Chromium with installed `channel: "chrome"` and Firefox; default E2E execution is not guaranteed to expose browser chrome. `page.setViewportSize`, context `deviceScaleFactor`, CSS `zoom`, and CDP page-scale/pinch emulation do **not** establish browser UI zoom.
- For a true-browser gate, run the existing focused test headed against installed Chrome/Firefox, hold the browser window/viewport constant, and invoke the browser's own zoom shortcut (`Control+Shift+=` (the `+` key on Windows) to raise, `Control+-` to lower, `Control+0` to restore) with the page unfocused from native inputs. Prove the browser accepted it by recording before/after `window.devicePixelRatio` and `document.documentElement.clientWidth` (expected DPR increase and narrower CSS viewport while `window.outerWidth/outerHeight` remain constant); capture browser, OS, zoom level, outer viewport and resulting layout. If the shortcut does not change those observables, mark the mechanism unsupported and stop—do not substitute emulation and call it zoom. Always restore 100% in `finally`.
- A headed launch is mandatory for confidence that browser accelerators, rather than page JS, own the zoom. Run a compact focused component/actual-App case, not the broad E2E suite. Chromium and Firefox separate evidence; no physical-device claim.

### Causal ResizeObserver: historical repro is bounded; replay harness and candidate comparability are unverified

- Bounded source evidence is `docs/plans/uix-644-menu-inventory.md` “Recovered ResizeObserver sequence” (2026-09-19), `docs/plans/uix-644-applicability.md`, and occurrence ledger `docs/plans/uix-644-runtime-coverage.json` owner-06 reference. Historical trace: Chromium, GM, normal 100% browser zoom, 1280×900, DPR 1; open “Новый токен”, choose `Explorer.png`, perform existing image-picker keyboard transitions, first-open `Персонаж` FormSelect. Popup-visible assertion passed; about 186ms later (about 207ms after trigger click) the unfiltered client log reported `ResizeObserver loop completed with undelivered notifications`. Later screenshots, geometry, keyboard/reopen and workspace assertions occur after the error and are not proven causes.
- The prior bounded diagnosis proposed exact comparison of dev revisions `452f5f1` and `e03b60e`, original 100%/1280×900 scenario, unfiltered window/client logs, and a 500ms post-popup observation with temporary observer constructor/entry geometry telemetry. Historical docs note current non-reproductions and prior error-free tests do not fix/waive the incident.
- **Concrete blocker:** this worktree/history does not establish that both historical revisions and the referenced `artifactBase` trace/checkpoint are available to the current local harness, nor that the isolated B fixture has the required token-editor asset/character setup. The exact sequence is documented, but a safe reproducible old/new harness recipe (including how to obtain the historical sources without changing the active checkout) is not present here. Do not improvise a fixture mutation or claim causal replay on current source alone. Before execution, root must establish artifact/revision availability and a disposable isolated browser target while preserving the active dirty manager pool. If that cannot be established, record the RO item as blocked by missing comparable source/fixture evidence, not NONREPRO.

## Recommended execution order after Escape gate

1. Check `git status`/HEAD and the Escape pool's accepted checkpoint; do not overlay or reset its work.
2. Root verifies B fixture scene count from authorized nonsecret snapshot metadata only. If two scenes exist, run the scene UI selection/restore check with no persistent mutation; otherwise request explicit isolated-fixture permission.
3. In a separate headed focused browser cell, test real zoom shortcut + observables and restore 100%; reject any viewport/deviceScale/CSS substitute.
4. Run historical RO replay only if exact old/new source and safe isolated fixture can be verified. Otherwise stop with the blocker above; do not classify as pass/nonrepro or suppress the telemetry.
5. Record the exact tested source SHA, browser/version, roles, dimensions/zoom, requests/writes, and retained historical RED. This pool does not close the full UIX-644 registry or native Firefox popup human acceptance.

## Checkpoint

- Decisions: use no private/party-A credential data; no fixture mutation absent explicit permission; real browser zoom only; causal RO failure history remains open.
- Changed files: this planning note only.
- Verification: read-only review of handoff, bounded UIX-644 ledger/repro notes, `ScenePicker.tsx`, `App.tsx` scene callback, and Playwright configuration. No tests or browser activity performed.
- Blockers: B two-scene/character-fixture presence unknown; historical RO source/trace availability and safe comparable replay are not established.
- Next action: after Escape matrix, verify B scene count without secrets; execute scene/zoom cells only if their prerequisites hold, and escalate the RO source/fixture prerequisite before replay.

