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

## Verification status

Local source-only pool based on accepted main 93935933738c78f459b8a0fa1c4d13747f82c8e3.
Prepared unit and SSR tests are NOT executed. No formatter/typecheck/lint/Vitest/SSR/browser/build gate was run.
A separate private tool-isolate check exercised actual three module bodies after explicit checked removal of TS annotations/imports: 16 scenario groups passed; three in-memory functional faults were detected and the restored source passed 16 again. This is not TypeScript compilation or Vitest evidence.
Independent source review corrected an assertion against non-existent CSS classes; regressions now check the actual roll-result--critical- prefix.
Git diff --check passed. No dependencies, runtimes, servers, production/publication actions or asset copies were created by this pool.

## Pending gates

- Formatter, TypeScript, lint and all affected unit/SSR tests in an authorized environment.
- Realtime/reload/history and narrow UI acceptance.
- Full UIX-289 frame assets/posters, curated skill mappings, registry/ACL, actual renderer integration and animation/performance acceptance.
  UIX-289 must not be closed based on this boundary pool. Publication of this exact local branch remains a separate authorization/gate.
