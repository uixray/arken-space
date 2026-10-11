# Astra runtime/privacy review — 2026-10-09

## Scope

Independent source-only review of current `account-mail-runtime.ts`, narrow index/env/auth route wiring, no-store hook and AccountAuthWorkspace queued wording/tests. No repeat crypto/PG/full-auth review. Initial inspected HEAD `549375486185b6e9ecfe9ef9d8707d277d865aff` with dirty scheduler/privacy changes. Worker music_mixer owns product files; reviewer changes this document only. No tests, external sends, credentials, dependencies or network operations performed by reviewer. Final fingerprint waits for worker freeze.

## Result at source level

No new concrete P1 found in the current disabled-runtime/privacy pool. Suitable for integration after worker's connected gate and final byte freeze, with these claims only:

- Runtime requires explicit enable + active32-byte key + ready adapter; starts after listener. Default runtime flag false, index and routes both use unconfigured adapter, so no timers or public registration/delivery readiness today.
- One scheduled tick, no overlap while active promise exists. Exponential failure backoff is bounded; error details are discarded, only fixed category/counts logged. Poll timer unref does not itself keep process alive.
- Stop is idempotent, clears pending timer, prevents rescheduling, aborts combined per-send/stop signal and awaits drain settlement. Index onClose awaits runtime.stop before Socket.IO and database close. Late adapter promise gets both handlers, avoiding unhandled rejection from an aborted send. Adapter IO side effects are not proven cancelled; at-least-once ambiguity remains.
- Runtime one-message/3s transport timeout/8s lease fits nominal helper budget; this is not a bound on DB or event-loop delays. Existing global process shutdown timeout may force exit if DB stalls. Do not report guaranteed clean shutdown from constants or mocked drain tests.
- `onSend` adds Cache-Control:no-store for `/api/account` and `/api/auth` namespaces, including success/errors/not-found and late serialization paths; unrelated cache headers untouched by predicate. Auth session/capabilities/CSRF and account campaign invite response fall under hook. Hook coverage tests include anonymous/error/404 and public control; add actual authenticated session/campaign invite/429 headers to connected proof when available.
- Register/resend/reset success copy says request accepted and check later, not sent/delivered; unknown/existing identity responses remain conditional generic copy. Button action labels can say send without claiming completed delivery. Component assertions cover queued wording, not actual mailbox transport.

## Explicit residuals / next adapter gate

1. **Readiness split:** route mailReady checks adapter/key, not scheduler.enabled/started; runtime readiness is separate. Currently safe because both adapters unconfigured. When real adapter is wired, use one shared readiness contract or explicit external-worker mode. Configured ready adapter with runtime disabled must not advertise a working local delivery capability accidentally. Decide whether deliberate durable-queue-only mode can accept mail, and expose it honestly; no implicit mode.
2. **Shutdown evidence:** runtime stop waits DB drain without its own DB-query timeout; global8s forced exit is fallback, not graceful-completion evidence. Need real app.close/signal integration with active fake send and DB operation, assert no DB write after close and safe expired lease recovery on forced termination. Current tests manually call stop then mark mock dbClosed; that does not execute index's whole server shutdown path.
3. **Abort compliance:** wrapper settles on AbortSignal but cannot force unknown adapter socket closure. Future maintained SMTP client adapter must demonstrate underlying IO closes and late result cannot mutate queue state. Current fake proof is not SMTP proof.
4. **Status/operational meaning:** ready reflects construction-time config, not remote provider health or queue backlog. Per-tick blocked count is not total unknown-key backlog. Safe operational status must avoid misleading 'delivered/healthy' conclusions.
5. **Lifecycle contract:** stop is terminal for that runtime instance (stopPromise blocks later start); document this one-shot server lifetime or test it explicitly. No hot-restart/config-rotation claim. No overlapping timer proof under injected fake clock is proof of cross-process DB leasing; existing PG gate is separately scoped.
6. **Small additional tests:** start twice, stop twice, stop-before-first-tick, start-after-stop terminal behavior; full bootstrap early-error/429 no-store; authenticated account DTO and invite no-store; actual close ordering. These improve evidence without expanding to full auth/security audit.

## Connected gate criteria

Worker reports exact files/commands/build/typecheck/runtime+privacy+web tests and source hashes after freeze. Source-level readiness=no-send must stay true in real bootstrap. Separately label unit fake-clock tests, PGlite queue+fake sink lifecycle, component mocks, true HTTP/socket/browser transport and production SMTP (not run). No production/private mailbox claim. No new dependency/client introduced by scheduler pool.

## Checkpoint

Decision: no new P1; disabled runtime/privacy source integration candidate pending connected gate/freeze. Changed only this document. Verification: targeted source/tests read, no tests executed by reviewer. Blockers before real delivery: approved adapter/dependency, common capability readiness, actual adapter abort/SMTP acceptance, provider/key/activation decisions; actual process-close/restart evidence remains distinct. Next: worker freeze → record hashes/results → root integration; future SMTP pool owns readiness/transport completion.

## Final source freeze / disposition

Worker freeze and reviewer hash check agree at HEAD `11c3ae390495bdf26f759db6fdeb228f93d1355d` with unrelated shared dirty files preserved. Route options now include `mailRuntimeEnabled` and mailReady requires it; routes use same ACCOUNT_MAIL_RUNTIME_ENABLED setting as scheduler. Initial runtime-off capability mismatch is **closed in source**, with worker-reported explicit disabled-runtime/ready-key+adapter regression. This is shared configuration readiness, not remote provider health.

Worker checkpoint `arkenhar-account-mail-runtime-luna20261009.md` reports 5 files/41 tests PASS, server+web typecheck PASS, server+web build PASS (large-chunk warning retained). Reviewer did not rerun tests. PostgreSQL suite fixture option changed but not rerun in this pool; do not silently relabel earlier PG receipt. Current production adapter remains unconfigured; actual SMTP delivery not available.

SHA256 independently captured after freeze:

```text
apps/server/src/account-mail-runtime.ts C786C2321A02EC25EF29782DC945ED7D1E7594CB904B10F5D0E90C364AC61C7D
apps/server/src/account-mail-runtime.test.ts C2389172C8CF6D1C88817C08A4CDD2B98C9617F240F4815313D7A1F46999A29E
apps/server/src/account-auth-routes.ts 2A8C2B34AEA833E4EB22CD7EB1784CD251AFA256BA63A41E64A74B6C5CB80EF3
apps/server/src/routes.ts 471E5B57691CB1A07708E5A24EF1CA6C4743BF312B28E3B428A925FDEDBE8029
apps/server/src/env.ts 78E70F4AB7A765F28D7B3A75F3AC5B9D8C00A282E31BF689BC612FC5F8E7C83E
apps/server/src/index.ts 4D16C58D09A6A64E892130FC5312D2DCB13A2E0976FC04A694E7C8CF7BB31A36
apps/web/src/AccountAuthWorkspace.tsx 6FFB409E4FDB3EA3EC35BF70B8FA08E1A6A3A32F2F857C61EC247CF48BEE5E15
apps/web/src/AccountAuthWorkspace.test.tsx C4B18AFE24295C25321AD0AEED03FEC321A954C41A8303C8D7A2CF6BB6B9CC90
```

Final review: no open demonstrated P1 in this bounded disabled runtime/privacy pool. Recommend root integrate local scheduler/no-store/queued-copy foundation with stated residuals, not public mail activation. DB stall/whole-bootstrap shutdown, real adapter socket abort, process restart and external acceptance remain separate. Changed only this review document; next candidate allowlist work waits root-supplied exact frozen SHA, never guesses HEAD.
