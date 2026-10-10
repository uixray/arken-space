# Account mail runtime / privacy checkpoint — 2026-10-09

## Decision and runtime boundary

- Added an explicitly opt-in, single-process non-overlapping account-mail scheduler. It uses the existing encrypted outbox drain and injected `MailAdapter`; it does not implement SMTP or add dependencies.
- `ACCOUNT_MAIL_RUNTIME_ENABLED` defaults to `false`. The production server currently wires `unconfiguredMailAdapter`; setting the flag cannot make it ready. Runtime readiness requires explicit enablement, a ready adapter, and the configured active 32-byte key. Auth registration/capability readiness now uses that same enable/adapter/key invariant, so a future ready adapter cannot advertise registration while the scheduler is disabled.
- The worker processes one message per sequential tick, polls every 30s when idle, backs off transient drain failures from 1s to at most 60s, logs only safe counts/fixed failure category, and unrefs poll timers. It starts only after `listen()` succeeds.
- Shutdown stops future ticks, aborts the active adapter signal, waits for the current drain to settle, then closes Socket.IO and the DB client. The drain uses 1-message batches and a 3s transport timeout. Adapters must honor abort; otherwise transport outcome can be ambiguous/at-least-once. DB claim/ack calls are not hard-deadlined; the existing 8s process shutdown deadline is an abrupt-exit limit, **not** a clean-settlement guarantee.
- Account/auth response hooks set `Cache-Control: no-store` on success, anonymous, validation, thrown-error and not-found responses, including campaign routes registered after auth. Unrelated public responses retain their own cache headers.
- Registration, verification-resend and password-reset UI now says the request was accepted/queued and to check later; it does not claim a message was sent or delivered.

## Revision and changed files

- Pool started from `e256280`; frozen source/test state was reviewed at full Git revision `11c3ae390495bdf26f759db6fdeb228f93d1355d` (short `11c3ae3`). No commit made for this pool.
- Changed:
  - `apps/server/src/account-mail-runtime.ts` (new)
  - `apps/server/src/account-mail-runtime.test.ts` (new)
  - `apps/server/src/account-auth-routes.ts`
  - `apps/server/src/routes.ts`
  - `apps/server/src/env.ts`
  - `apps/server/src/index.ts`
  - `apps/server/src/account-auth.integration.test.ts`
  - `apps/server/src/account-login-reset-race.integration.test.ts`
  - `apps/server/src/account-realtime-auth.integration.test.ts`
  - `apps/server/src/account-mail-postgres.integration.test.ts` (only the newly required runtime-enabled test fixture option; PostgreSQL suite not rerun here)
  - `apps/web/src/AccountAuthWorkspace.tsx`
  - `apps/web/src/AccountAuthWorkspace.test.tsx`
  - this checkpoint
- Preserved unrelated changes, including the PG worker's committed tests/scripts and concurrent asset/doc work. No provider credentials, `.env` contents, remote mail, or external service were accessed.

## Verification receipts

- Focused connected Vitest run: **5 files / 41 tests PASS** — runtime + auth integration + login/reset race + realtime-auth + AccountAuthWorkspace UI wording.
- Runtime tests exercise: disabled/missing readiness; actual PGlite registration queued first then accepted later via the coordinator and test-only local sink; retry backoff with safe logs; no overlapping active ticks; `stop()` waits before DB close; abort signal reaches a hanging fake adapter; no post-stop DB work. This is local fake-adapter acceptance, not SMTP or inbox delivery.
- Privacy test checks no-store on account capabilities/session success, invalid input, thrown error and 404 under `/api/auth`, while a public cacheable endpoint retains its explicit cache policy. Runtime-disabled but adapter/key-ready regression returns generic delivery-unavailable, capability registration false, and does not enqueue.
- Direct installed TypeScript compiler (no package manager/install): server and web `tsc --noEmit` — PASS.
- Direct installed server `tsup` production bundle — PASS.
- Direct installed Vite production build — PASS; existing large-chunk warning remains, no deployment performed.
- An attempted `pnpm exec vitest` hit a Windows EPERM while pnpm tried to bootstrap its pinned package manager in a temp path; elevated retry was rejected because it could mutate packages. Tests/type/build were instead run through already-installed Node entrypoints, with no install/network.

## Remaining gates

- No SMTP adapter, dependency approval/version/license review, provider/transport credentials, TLS endpoint test, external send, or inbox placement. Queued is not sent; adapter acceptance is not inbox delivery.
- PostgreSQL cross-process/lock-order/persistent restart and ambiguous post-DATA delivery remain separate evidence gates; this pool did not rerun the PG-specific integration suite after adding its explicit test fixture option.
- Actual adapter socket closure on AbortSignal and clean shutdown under stalled PostgreSQL are not proven. Root owns integration and any later provider activation gate; no deployment/reload/push/merge was done.

## Follow-up local browser gate — 2026-10-09

- Frozen base for the browser gate: product/runtime state at `11c3ae390495bdf26f759db6fdeb228f93d1355d`; this follow-up changes only the two scoped browser specs and this checkpoint. Worktree HEAD at receipt: `0ae96a98cc2f78b18f55af002a82e6fb0a42b3d9` (shared tree has concurrent docs/asset edits; not included in this pool).
- Commands: combined two-file gate `node node_modules/@playwright/test/cli.js test --config=playwright.config.ts --project=chromium --retries=0 tests/e2e/account-auth-local-http.spec.ts tests/e2e/account-campaign-links-local-http.spec.ts` (account case passed; link cases exposed a route-response fixture issue); then final link gate `node node_modules/@playwright/test/cli.js test --config=playwright.config.ts --project=chromium --retries=0 tests/e2e/account-campaign-links-local-http.spec.ts`.
- Result: **3/3 Chromium browser test cases passed across the receipts**: account lifecycle passed in the combined run, then both GM-link and PLAYER-grant cases passed in the corrected link-only run (2/2). Account test exercised actual local HTTP registration, encrypted queue drain to the injected synthetic acceptance adapter, verification, login, and campaign create/select/invite UI. Link tests exercised actual registered server routes and role-specific bootstrap snapshots. Browser Socket.IO transport is not claimed; fixtures use no-op realtime. Trace capture was explicitly off in both specs.
- Disposable Vite bound to localhost only on fixture origin `localhost:5173`; isolated ephemeral Fastify/PGlite APIs, synthetic identities and test-only mail adapter; stopped after tests. A prior attempt on `127.0.0.1:5191` failed origin checks; aligning the fixture origin resolved the two campaign-link bootstrap failures. The initial account attempt also exposed missing runtime/keyring fixture configuration and stale queued-wording expectations; harness now supplies an explicit test keyring/runtime enablement and drains the queued envelope through the fake adapter (no token DB lookup).
- Test-only files changed: `tests/e2e/account-auth-local-http.spec.ts` (explicit runtime/keyring + queued fake-adapter delivery + accepted wording); `tests/e2e/account-campaign-links-local-http.spec.ts` (buffered local route-forward response). No browser traces retained.
- No full gameplay socket/transport claim, production email delivery claim, deployment, remote mail, or real-identity data. The previously documented DB claim/ack clean-shutdown limitation remains.
