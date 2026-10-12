# Local connected dev loop

These commands are local feedback, NOT release qualification or automatic impact analysis.
Run from the checkout root; explicit targets are mandatory (no accidental full suite).

- `pnpm lint:fast scripts/ci/run-logged.mjs scripts/qa/dev-check.mjs`
- `pnpm typecheck:fast configs` (scopes: web, server, contracts, db, system, e2e, configs)
- `pnpm test:pool tests/example.test.ts` (replace with actual connected unit files)

Select the whole related pool before running: modified behavior, caller tests, fixtures and
all consumers of a changed shared helper. Styles require affected themes/roles/viewports;
server boundaries require authorization/isolation negative cases. Unknown impact is not
permission to claim a narrow PASS. Automated impact map is deferred to UIX-694.

Review and fix the connected pool first, then one local run; fix actual failures as one pool.
Freeze bytes before final qualification. Full CI stays unchanged: one completed pool and
one push, not a push/full run for each micro-edit. Reuse old timing baselines, never old PASS
as evidence for changed bytes. No new mandatory jobs or test matrix entries here.

Browser CI captures Vite stdout/stderr through Playwright into browser-run.log; the existing
failure-only artifact includes it. Discovery mode starts no webServer. Abrupt cancellation
uploads remain best-effort; logs may contain synthetic test data, never production secrets.

The CLI rejects directories, option-like targets and inherited/unknown type scopes.
Unit targets are passed as absolute Vitest file filters (Vitest matching is not a
transitive impact map); always inspect the executed file inventory.
The logger drains both streams, flushes console writes before returning, and fails
closed on spawn/log/tee errors. SIGINT/SIGTERM cannot become PASS: POSIX forwards
to Playwright for cleanup then kills only its owned group after 5 seconds; Windows
terminates the owned process tree. SIGKILL/runner loss cannot guarantee teardown
or artifact upload. These controls do not add a mandatory CI scenario.
