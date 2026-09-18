# UIX-289 — client dice presentation boundary

## Scope

A defensive client boundary on top of the existing server-authoritative dice result. No server dice rules, selected-pool calculation, totals, modifiers, resource spending, permissions or frame assets change.

## Contract

- Legacy rows with no semanticOutcome keep the existing kept-d20 term fallback.
- A present semanticOutcome must be a non-array record with a known exact kind. Critical failure requires keptNaturalD20 === 1; critical success requires === 20.
- NORMAL accepts null or a whole natural in 1..20, including 1 and 20. This preserves an authoritative noncritical override instead of recomputing mechanics from old terms or totals.
- Present malformed semantic metadata rejects the normalized dice result. A direct getDiceCritical call also returns null and does not reinterpret that row as legacy.
- Missing/null frame metadata is a valid static-card path. An unknown, mismatched or orphan frame is discarded, not the valid roll total/breakdown/semantic label.
- The only recognized frame pair is ARKEN_CRITICAL_V1 with the matching critical-success/critical-failure key and validated semantic. Canonical projections do not forward input URLs, asset IDs or other extra metadata.
- This validation does not resolve assets or establish a published registry. A future authorized renderer must also handle failed/missing/deprecated assets.

## Changed surfaces

- dice-outcome.ts: shared semantic parser and frame-reference sanitizer.
- dice-result.ts: parse valid semantics, sanitize decorative frames without losing the core result.
- dice-critical.ts: distinguish malformed authoritative metadata from absent legacy metadata.
- Unit coverage in dice-outcome.test.ts, dice-result.test.ts and dice-critical.test.ts.
- Six simple/skill ChatMessageBody SSR regressions appended to sidebar/ChatPanels.test.tsx; existing component implementation and Gravity mock remain unchanged.

## Historical verification status (before the released CI)

Local source-only pool based on accepted main 93935933738c78f459b8a0fa1c4d13747f82c8e3.
Prepared unit and SSR tests are NOT executed. No formatter/typecheck/lint/Vitest/SSR/browser/build gate was run.
A separate private tool-isolate check exercised actual three module bodies after explicit checked removal of TS annotations/imports: 16 scenario groups passed; three in-memory functional faults were detected and the restored source passed 16 again. This is not TypeScript compilation or Vitest evidence.
Independent source review corrected an assertion against non-existent CSS classes; regressions now check the actual roll-result--critical- prefix.
Git diff --check passed. No dependencies, runtimes, servers, production/publication actions or asset copies were created by this pool.

## Pending gates

- The original formatter/TypeScript/lint/unit/SSR gate is resolved by the named hosted CI evidence below; do not rerun unchanged code merely because this old plan said pending.
- Realtime/reload/history and narrow UI acceptance.
- Full UIX-289 frame assets/posters, curated skill mappings, registry/ACL, actual renderer integration and animation/performance acceptance.
  UIX-289 must not be closed based on this boundary pool. Publication of this exact local branch remains a separate authorization/gate.

## Current verification reconciliation — 2026-09-16

- Live UIX-289 remains In Progress with its full original frame-system scope.
  This is evidence reconciliation, not implementation/acceptance of animated assets.
- Read existing run `35043939188`, job `104629599895`: completed SUCCESS for exact
  main `7f28ca399ec0530e55e6bd41d4427ea23150522b`. Build, typecheck, lint, format and
  test steps succeeded. No workflow was dispatched or restarted.
- Named log entries prove: web dice-outcome30, dice-result8, dice-critical18,
  ChatPanels14; server dice-outcome3 and dice-result4 all passed. Overall run:
  261 files /2199 tests PASS. The 14 ChatPanels cases include six relevant simple/
  skill boundary cases; this is SSR with the existing Gravity mock, not animation
  or browser delivery acceptance.
- Git diff against that exact release is empty for these source/test modules
  and ChatPanels tests. Source implementation originates at `803602f`. Current
  semantic validation and those regressions can reuse this CI evidence; unrelated
  newer UI changes are not thereby certified by the old exact-main run.
- Coverage inspected: raw1/20 vs adjusted totals, accepted/rejected semantic
  metadata, normal override, invalid/private/orphan decorative references dropped
  without losing valid totals/text. This does NOT prove access control for real
  assets: a sanitizer is not an authorized published-theme registry.
- Current source still only sanitizes the recognized ARKEN_CRITICAL_V1 pair.
  No frame/poster renderer was found in ChatPanels. Missing original deliverables:
  approved asset+poster import/provenance, published/private lifecycle and ACL,
  GM assignment of selected skill outcomes, rendering, reduced motion, newest-only
  animation/off-screen pause, realtime/reload/history/narrow runtime acceptance.
- Eagle is disabled by the current project tool constraint. No Eagle call, import,
  invented artwork, registry assignment or permission broadening was performed.
  Do not silently replace the requested supplied assets with synthetic frames.
- Evidence: local `outcome-boundary-audit/checks.log` preserves the existing run
  log; source/Git checks and run metadata were read this turn. No local tests,
  builds, servers, publication/deploy or Linear writes were performed.

Next: asset/mapping approval under the current tool boundary must be resolved
before the asset-import slice; other existing UI tasks can proceed independently.
The whole UIX-289 and the full project goal are not complete.
