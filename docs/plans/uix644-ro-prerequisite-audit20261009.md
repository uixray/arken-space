# UIX-644 causal ResizeObserver prerequisite audit — 2026-10-09

## Verified, not a causal PASS
- Current checkout incoming HEAD `84641ce38899cb2d6f7edcd144cae2cc3e129d8f`; product source `52013d43e6f2fca1bb268c38608afde9cd76424a` unchanged.
- Both historical commits are locally available: `452f5f162da51f10fbafcedef92f5d85fc9d36cf` and `e03b60e2be3c95f5f18033b2760284587160e566`. Git cat-file/resolve exited0. Their lockfile/root/web package manifests have no diff. The selected FormSelect diff changes popup `width: popupWidth` to `minWidth: popupWidth`; it is a hypothesis, not proof of cause or fix.
- Historical artifact base: `C:/Users/UIXRay/.codex/visualizations/2026/09/16/01a0a7d5-b072-7022-8e9d-4538c0a92b07` (read only).
- Exact original trace exists, 2,815,527 bytes: `true-browser-zoom-gate/owner-06/token-generator-UIX-272-UI-05f7b--picker-at-desktop-viewport-chromium/trace.zip`, SHA256 `68956006F23D98A9EFDA126551E8B6D569DF9B370FF05869E031741BFB15A918`.
- Adjacent provenance files are at the parent gate directory, NOT inside owner-06: `true-browser-zoom-gate/checkpoint-fix-452f5f1.md` SHA256 `F87394A4797724E5873966C394EFB645F37B513FBCB839958809FB01E549C47B`; `true-browser-zoom-gate/owner-results.json` SHA256 `B15B0F3BF09C7B776CAB420D90EB394EC08C841C1121E15B2C9E5D4E58D92B75`.
- `token-resize-diagnosis/diagnostic-spec.ts` exists, SHA256 `4C9D5E8DC7D11B8EF638172BB361DC44DE44D3B6ADA0DEF6739B4B135E6F80F8`; its checkpoint explicitly preserves original FAIL and warns against more identical warm/cold repeats. No raw trace payload, private fixture or token was printed.

## Prior diagnosis / applicability
The retained diagnosis located the error during first character popup open, BEFORE later hidden textareas/Setup; ten warm and eight cold ordered checks did not reproduce it. Those runs are NONREPRO, not causal resolution. The historical owner cell is normal100% browser zoom at1280×900/DPR1, despite its parent directory being named true-browser-zoom. Actual browser UI zoom is a separate gate.

The former missing-commit/artifact prerequisite is now resolved by file/Git checks. It must not remain listed as a missing-source blocker. This does NOT establish a comparable executable target, the original private synthetic fixture, browser/cache/runtime equality, an offending callback stack or causality.

## Next bounded causal pool
1. Read the retained diagnostic-spec and original action sequence programmatically, omitting all private payloads from output. Reconstruct exact first-open trigger/image-picker keyboard sequence, not guessed keystrokes.
2. Prepare independent non-live front-end exports of both available SHAs, preserving the active checkout/runtime. Resolve compatible dependencies from their identical historical lockfile without silently substituting the current dependency set. Isolated target/ports/data scope must be coordinated with root; do not migrate current QA or run the whole legacy suite.
3. One controlled layout-transition old/new comparison with retained error listener, first-popup trigger/list/floating geometry and native observer callback forwarding. Instrumentation must not suppress warnings or turn failure into a pass. Source hash/runtime/fixture differences must be explicit.
4. If no error is reproduced, preserve NONREPRO with attempted conditions; do not mark the original RO FAIL resolved. If reproduced, propose the narrow causal fix before product edits; then one connected affected-controls gate.

## Checkpoint
- Decisions: verified source/artifact availability supersedes earlier uncertainty; causal gate remains open, no repeated warm/cold reassurance.
- Changed files: this new audit only. Historical artifacts untouched.
- Verification: exact commit resolution, source/manifests diff, artifact existence/size/SHA, retained diagnosis read; no browser/run/process/data changes.
- Blocker: executable comparable fixture/runtime and actual causal evidence still absent.
- Next: bounded causal target preparation after current connected Select/media pools; overall UIX-644 INCOMPLETE.
