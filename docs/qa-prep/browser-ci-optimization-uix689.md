# Browser CI optimization — UIX-689

## Scope and preserved contracts

This pool is based on qualified `f123baca`, not a change to production. It changes only CI and test preparation.

- Icon structure reads are batched without removing SVG attributes, positive geometry or24px hit-area requirements. Accessible names remain Playwright accessibility assertions. The complete theme/role/width matrix and real keyboard traversal remain.
- Icon settling awaits active CSS transitions from the document animation inventory filtered to the control/SVG/ancestor chain, including pseudo-elements. Two paint frames precede each rescan. Cancellation forces rescan; unsupported long transitions and paused/non-settling transitions fail closed.
- Bulk TABLE history is inserted transactionally into the worker-owned campaign with its GM membership. Exact original overflow text and ordered rows are preserved. Unknown tokens, non-loopback databases and foreign GM membership are rejected. Real incoming chat, dice, resource edits, media and authentication still use the actual API. Server rate limits are not disabled.
- Shards use longest-processing-time assignment from current Playwright discovery. Historical timing files are weights only, never a coverage allowlist. New files are included automatically; stale entries cannot select absent tests. Each actual filtered discovery is checked against exact planned IDs before execution. Workers, retries, fail-on-flaky, matrix concurrency and aggregate semantics remain unchanged.

## Reproducible local measurements

Same machine, isolated runtime, one worker, Chromium and Firefox sequentially. These are local wall times, not GitHub CI time.

| Set                          | Before    | After     | Coverage                                                                                        |
| ---------------------------- | --------- | --------- | ----------------------------------------------------------------------------------------------- |
| Icon shell + contrast oracle | 1451303ms | 1108338ms | 78 original cases, all single-attempt PASS;72 shell receipts equivalent;23.6% less wall time    |
| Follow-scroll + resize       | 898028ms  | 536858ms  | 28 original journeys plus2 new ownership controls, all single-attempt PASS;40.2% less wall time |

An initial transition implementation failed the existing strict Gravity pseudo-background contrast oracle in both engines. Document-level animation inventory fixed the cause; the same12 controls passed. No expected contrast was changed.

An initial chat after-run lost its local Vite listener late in Firefox and is not accepted PASS/speed evidence. The identical complete rerun with captured diagnostics passed30/30. The first listener termination's cause is not established.

## Timing manifest and maintenance

`scripts/ci/browser-file-durations.json` records historical exact-SHA GitHub durations and explicit local ratio calibration. Calibrated values are estimates until a full optimized CI measures them. Update weights from complete successful shard reports; do not relabel estimates as measured CI.

Run a discovery-only plan with:

```sh
node scripts/ci/run-balanced-browser.mjs chromium 1 3 plan
```

Run the selected shard with:

```sh
PLAYWRIGHT_JSON_OUTPUT_NAME=e2e-report.json node scripts/ci/run-balanced-browser.mjs chromium 1 3
```

Each job uploads its full result and assignment plan. Required gates must pass on the new exact SHA and report union must match current discovery before readiness. Local benchmark PASS does not qualify deployment or replace final CI.
