# CI optimization pool2 — UIX-689

Base: qualified PR93 `bda221ab`; PR92 `f123baca` remains unchanged. No merge or deployment.

## Remove / consolidate / preserve

| Work                                      | Decision and preserved evidence                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four-job queue for six browser shards     | Allow all six independent runners; each keeps its own Postgres, one browser worker, existing retries, timeout and required aggregate.                                                                                                                                                           |
| Logout/privacy per-test migration loops   | Use existing migrated PGlite template clones. All seed, route, real socket, exact-session races, privacy rejection and cleanup assertions remain. Same seven-case pool including template isolation passed before/after, 23643ms to 20076ms locally; this is a small sample, not full-CI speed. |
| Repeated focused-element protocol reads   | One DOM snapshot per real keyboard step retains SVG exclusion, identity, radio handling, focus-visible/outline/shadow. Playwright enabled/accessibility and real Tab/arrow navigation remain. Tag assignment is batched.                                                                        |
| Cached visible controls across phases     | REJECTED: visible collections are dynamic. An attempted cache produced one Firefox forest timeout; original per-phase enumeration restored. Never count that failed run as speed or PASS evidence.                                                                                              |
| Web production bundle in each browser job | Omit unused web dist: Playwright runs Vite dev. Fresh API plus all workspace dependencies still build on each exact checkout; complete release build remains in checks. Local filtered build passed, selecting four required packages.                                                          |
| Shared build artifact job                 | Not adopted: observed total build about13sec and web about1sec. Additional runner/artifact latency may cost more critical-path time. No speculative stale artifact/cache shortcuts.                                                                                                             |
| Historical duration estimates             | Replace with actual complete bda report file durations, retaining skipped durations. Timing weights are never a coverage allowlist; current discovery and exact filtered IDs remain authoritative.                                                                                              |
| Theme keyboard/contrast matrix            | Preserve: focus visibility and DOM visibility can differ by theme. No proof these are equivalent coverage duplicates.                                                                                                                                                                           |
| Privacy helper vs actual route            | Preserve: pure sanitizer tests do not catch a route logging raw user text.                                                                                                                                                                                                                      |
| Multiplayer/PG/restart/reconnect/cleanup  | Preserve: separate runtime/security invariants.                                                                                                                                                                                                                                                 |
| Historical branch workflows               | Not current critical path; no deletion without unique coverage/lifecycle mapping.                                                                                                                                                                                                               |

## Qualification limits

Owner requested reuse of existing baseline reports, not rerunning unchanged tests. Prior complete local icon report and GitHub bda six reports are the baseline. A redundant baseline was cancelled; its partial output is not evidence.

An initial affected78-case run had77PASS/one Firefox forest timeout in label/hover before keyboard; no claim of faster icons from that run. Dynamic collection cache was withdrawn. Corrected forest full journey and keyboard probe controls passed in both engines (four cases, single attempts). The new control detects skipped disabled, radio identity, missing indicator and focusable SVG using actual Tab.

Final qualification must inspect all six current reports/plans:649unique IDs per browser, all648 bda cases retained with unchanged pass/skip, one added keyboard control per engine. Final measured CI and full receipt equivalence are pending; local narrow PASS is not fullCI readiness.

## Evidence location / next

Independent Claude audit confirmed queue dominance and that sharing builds would not pay back. Added a40-minute Playwright global timeout below the45-minute job limit; a5-second synthetic timeout returned exit1 with JSON error receipts (not PASS). Added supplemental staged-pool verification using normalized Git blob IDs, exact staged diff equality, no unstaged tracked edits and a staged tree receipt; negative controls reject wrong blobs, undeclared staged files and tampering, including CRLF-to-LF normalization. The existing local Push gate remains mandatory; its raw working-file SHA256 is not relabelled as a commit hash.

Optimization worktree `.data-ci-optimization`: pool2 unit before/after JSON, build/static/discovery logs, focused browser JSON and failed full diagnostic report. Main checkpoint: `D:/AI/personal/experiments/arken-space/docs/qa-prep/ci-optimization-pool2-20261012.md`.

After frozen local qualification and Push gate, push one connected commit and observe its automatic full CI. Do not dispatch a second run merely for parallelism. Measure actual wall time including queues and report skips separately.
