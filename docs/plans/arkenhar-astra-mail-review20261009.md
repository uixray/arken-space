# Astra mail pool source review — 2026-10-09

## Scope / evidence boundary

Independent bounded review of encrypted-mail additions only, against the earlier auth architecture in `arkenhar-astra-auth-review20261009.md`; old auth baseline not repeated. Backend worker remains active. This reviewer owns this document only, makes no source/Linear/environment/provider changes and runs no test suite. Baseline HEAD at inspection `59ef1b32cffbdc1ed86b89a4c4772bf34bcab4e0` plus dirty mail pool. Test assertions read are not test execution receipts.

## Immediate findings sent to root and backend owner

### P1 — verification confirm/resend lock inversion (repair requested)

At initial reviewed snapshot, verification confirmation updates/locks action token, then outbox, then user. Verification resend/re-registration locks user, then outbox, then action tokens in enqueue. Concurrent requests can deadlock on token/user/outbox: one request fails 503 or waits until DB detection. Canonical user → action token → outbox lock order is required; lookup candidate user without locking, lock/recheck user, conditionally consume token with DB clock after wait, cancel outbox last. Existing reset/change user-first path should follow same ordering. A two-connection PostgreSQL interleaving is the decisive regression test; single-process PGlite tests cannot prove lock-order behavior.

### P1 delivery liveness — unknown-key backlog starvation (repair requested)

At initial snapshot the drain selects due rows with LIMIT and no deterministic ordering, then skips an unknown key without modifying row due state. A full batch of old-key rows can be selected indefinitely, starving new deliverable mail despite valid active key. Preserve unknown-key ciphertext for key restoration, but back off/classify or exclude blocked keys in eligible selection and provide a fair retry lane. Regression: more than batchSize unknown-key rows plus a known-key message; known-key delivery progresses and blocked ciphertext survives.

### Root-found crypto issue — source fix now observed, regression still required

Root reported a synthetic Node v24.15.0 check where default GCM decipher accepted a truncated 4-byte tag. This reviewer did not rerun that experiment. Current crypto source now enforces canonical base64url, 12-byte nonce, 16-byte tag and explicit `authTagLength:16`, bounded payload, UUID/context fields and purpose/version. Do not report the old tag flaw as still unfixed at this snapshot. Test 4/8/12/15-byte tags, wrong nonce, malformed/noncanonical encoding, changed every AAD field and wrong key; assertions/logs must never include secret material.

## Positive source boundaries

- Fresh random 12-byte nonce with AES-256-GCM; encrypted recipient/subject/text including bearer. AAD binds domain/version/message id/action-token id/purpose/key id. Active and retained keys are separated by key id; exact 32-byte canonical keys, no baked key/default plaintext fallback.
- New registration inserts user + token + outbox in one transaction. Existing unverified registration retains original password. Resend locks user and rechecks eligibility; purpose predecessors invalidated/cancelled transactionally. Outbox has unique action-token FK, explicit states, lease/payload/accepted/error-category SQL constraints.
- Queue commit precedes generic accepted response; sending is outside request. Missing configured key/transport blocks globally before account existence branching. In-memory mail sink remains test-only; production routes explicitly use unconfigured adapter.
- Claim transaction locks only outbox with SKIP LOCKED and commits before transport. Send gets stable message id. Conditional lease-token updates fence a newer owner's state. Terminal success/failure/cancellation clears ciphertext; errors stored as fixed safe categories instead of provider exception strings.
- Current source has corrected catch-path maxAttempts comparison (no second increment), pre-send lease ownership/expiry recheck, conditional cancellation and token-expired/used/disabled cleanup independent of normal due time. Do not recycle root's previous findings as unfixed without checking final bytes.

## Residual gates / limitations before a real transport

1. **Helper is not runtime delivery.** Production routes use unconfigured adapter; repository non-test references to drain are its definition only at review. No scheduler/service startup, graceful drain shutdown or actual provider acceptance. Correct fail-closed posture, but never call queued mail operational/delivered.
2. **Bounded count is not bounded time.** `await adapter.send` has no deadline/AbortSignal or lease renewal. Hung send stalls remaining batch and shutdown; lease expiry can let another worker send while old call is still pending. Add explicit timeout/cancel transport contract, deadline below lease with reserve or heartbeat policy, bounded worker concurrency and shutdown. A Promise.race alone does not abort actual network delivery.
3. **Attempt semantics incomplete.** Attempt count is incremented at claim, maxAttempts checked only when send throws. Repeated crash/reclaim or decrypt-failure paths can exceed configured ceiling. Define whether claim, decrypt and actual send attempts differ; enforce terminal policy consistently without destroying missing-key recoverability. Unsupported/missing key must stay recoverable, not silently consume all delivery attempts.
4. **Counters do not yet mean all processed outcomes.** Invalid rows cleaned during claim are not represented in cancelled count, unknown-key skips not in blocked count; do not build healthy/empty monitoring solely from current result. Safe aggregate categories/oldest-pending age/blocked counts are needed for operations, never addresses/tokens.
5. **Expiry uses two clocks.** Claim derives timestamps before transaction/lock wait; pre-send checks token and lease with DB clock but does not explicitly compare outbox expiry. Align authoritative expiry to DB time after waits and assert outbox/token purpose/expiry linkage; normally enqueue keeps them equal, but invariants should be explicit. Send cannot recall mail if token superseded immediately after final check; security comes from invalid token, not exactly-once delivery.
6. **Encoding length check allocates before byte bound.** decodeCanonical checks decoded length only after Buffer.from and regex over whole value. Bound encoded length before decoding untrusted/corrupt DB payload; not an exposed unauthenticated endpoint, but avoid unbounded corruption/OOM path.
7. **Secret evidence must be accurate.** Account user email is intentionally stored in users, so a whole DB dump cannot be expected to omit the recipient everywhere. Require no plaintext action/session bearer/password/mail body/URL or encryption key anywhere; require recipient absent specifically from outbox metadata/payload columns. Existing ciphertext-only test is narrower than full dump/log scanning. Capture logger/error/DTO output separately and inspect only boolean redacted receipts.

## Focused missing verification

- Lock-order barriers resend/confirm, reset issuance/confirm, re-registration/confirm with one current valid token and no unexpected deadlock; real PostgreSQL multi-connection receipt or explicit outstanding gate.
- Existing-account enqueue failure rolls back old-token invalidation and old-message cancellation (new-account rollback test alone insufficient).
- Known/unknown key fairness, old+new key rotation/recovery, malformed key startup, complete context/nonce/tag tampering and full-length tag enforcement.
- Lease replacement while old send awaits: stale success/catch/cancel cannot overwrite newer lease or resurrect cleared ciphertext; assert message id stable, possible duplicate accepted send but one token consumption. Test expiry exactly at boundary.
- Persistent fixture close/reopen and actual process restart before send and after send-before-ack. Current manually fabricated expired lease is lease-reclaim evidence only, not restart recovery.
- Used/expired/disabled/verified-ineligible cleanup while normal retry date lies far in future; ciphertext removed; cancelled/blocked counters truthful.
- Hung transport/abort/shutdown, retry ceiling and maximum claims with crashes/decryption failure, clock waits; downstream provider behavior remains untested until approved adapter exists.
- Whole-fixture secret scan and captured logs across forced DB/adapter/decrypt errors; public missing-config behavior same for known/unknown identifier; no debug/test-token endpoint.
- Migration set including 0053 on fresh and legacy fixture; schema CHECK negatives; canonical snapshot/journal consistency. One connected gate after repairs, tied to final fingerprints, not each micro-change.

## Integration recommendation

Finish the two raised lock/liveness repairs and crypto regression, obtain backend connected test receipt, then integrate only as **local encrypted queue/helper foundation with production transport disabled**. Real mail activation remains blocked by runtime runner, safe transport lifecycle and provider/key operations gate. No approval of full auth security, external delivery, restart reliability or production readiness is implied.

## Checkpoint

Decisions: source review only; crypto hardening observed; lock inversion/key-backlog repair requested; at-least-once delivery honesty retained. Changed: this document only. Verification: source/schema/tests read, no commands that sent mail or accessed credentials, no test run by reviewer. Next: backend announces quiet final source; reviewer records fingerprints and resolved/open disposition, root integrates stage-gate evidence.

## Follow-up source disposition (supersedes initial findings above)

Reinspection after backend fixes confirms:

- Both reported P1s are **repaired in source**: verification confirmation locks user before conditional action-token update; enqueue updates prior tokens before cancelling outbox, yielding user → token → outbox. Verification expiry is rechecked with clock_timestamp after lock. Due selection filters known keys before LIMIT, so missing-key backlog cannot consume the delivery batch; separate stale cleanup preserves expiry/revocation handling.
- Strict GCM tag16/nonce12/canonical encoding is present. Root's truncated-tag finding is no longer an open source finding.
- `sendWithTimeout` now passes AbortSignal and bounds helper wait; options validate integer bounds, minimum lease reserve, and sequential batch capacity. Preclaim exhausted and decrypt terminal paths now enforce attempt ceiling. Initial residuals 2–3 are therefore no longer missing-helper-implementation findings. Actual SMTP adapter must honor abort and close underlying IO; a raced promise alone cannot prove transport stopped. DB/event-loop delays can still consume nominal lease reserve; preserve pre-send ownership checks and at-least-once semantics.
- Claim cleanup counts are improved; unknown-key backlog is deliberately excluded and still not represented by `blocked`. Monitoring must not treat result.blocked=0 as proof no key problem. DEAD rows are currently included in cancelled count, so document metric semantics before UI/alerts.
- Remaining source hardening observations are non-blocking for this disabled helper foundation: encoded input bound should precede decoding; queue/token purpose/expiry relationship and clock discipline could be made explicit. No newly demonstrated credential-bypass finding from this follow-up.

### Final integration boundary

Subject to root accepting the backend gate receipts for these exact bytes, this is a runnable **encrypted durable DB queue plus drain helper**, not running mail delivery. Current non-test runtime still supplies `unconfiguredMailAdapter`; no periodic drain invocation/SMTP provider exists. Source repairs and PGlite/fake adapter tests do not prove real PostgreSQL contention, persistent process restart or mailbox delivery. No full-security/production acceptance.

## Proposed next bounded production-mail implementation pool (requires dispatch)

Goal: configurable actual SMTP transport implementation and runtime scheduler lifecycle, proven only against disposable loopback fake SMTP/TLS; **no provider purchase/account, external send, real secrets or network configuration**. A plan is not implementation permission or delivery evidence.

### Local implementation scope

1. Root assigns exclusive ownership of `account-mail-smtp.ts`, `account-mail-runtime.ts`, their focused tests and narrow options/bootstrap wiring; existing auth/schema helpers only if explicitly assigned. Preserve other workers. Transport independent from DB scheduler.
2. First inspect already available runtime dependency closure. Preferred maintained SMTP client would require explicit dependency/license/security approval if absent; do not install it silently. If dependency-free Node net/tls implementation is chosen, scope to a deliberately narrow text-only SMTP submission profile, not a general mail library. Root must approve that protocol-maintenance tradeoff before coding; no speculative provider SDKs.
3. Configurable host/port/sender and trusted secret injection. Default disabled. Production require certificate-validated TLS (initial candidate implicit TLS only; STARTTLS is extra reviewed scope, never opportunistic downgrade), hostname validation and required auth profile; test-only loopback accepts explicit synthetic test TLS configuration isolated from production. Never `rejectUnauthorized:false` in production or trust-all certificates. Sender/recipient/header inputs reject CR/LF/control injection; bounded lines/multiline reply parser, correct SMTP sequencing and dot-stuffing, limits for message/response size, supported auth only over validated TLS. No plaintext credentials in URLs/argv/errors. Adapter returns acceptance only after final successful DATA reply; that is server acceptance, not delivery.
4. AbortSignal/deadline must terminate socket IO and settle once; handle DNS/connect/TLS/auth/RCPT/DATA timeout/rejection and malformed replies with fixed safe categories. Retry/terminal policy covers SMTP transient/permanent errors deliberately; stable Message-ID is useful but SMTP does not promise deduplication/exactly-once. A timeout after DATA can be ambiguous and retry may duplicate; preserve one-use action token semantics.
5. Bootstrap constructs validated keyring+adapter+runner once only when explicitly enabled/ready. Account capabilities reflect queue/key/transport **configuration** readiness, not claim that a remote mailbox is reachable. No first request creates timer; one bounded non-overlapping scheduler per process with finite drain batch, jitter/backoff, poll budget and safe aggregate status. Multiple processes rely on DB leases; no hidden global singleton assumption.
6. Graceful shutdown stops scheduling, aborts/waits for in-flight transport within deadline, avoids closing DB while drain writes acknowledgment; leftovers recover by leases after restart. Scheduler failure logs category/count only and follows bounded retry, never process crash loop. No public diagnostics/token/mail-read endpoint. Operator diagnostics through existing authorized surface or private safe logs; no generic new HTTP management API.
7. Configuration validation and startup failure messages cannot echo keyring/password/DSN/provider replies. Provisioning instructions contain placeholders only. Do not read local real .env or credential store. Test secrets generated in harness and disposed, not committed fixtures or screenshots.

### One connected local gate

- Loopback synthetic SMTP/TLS server: successful final DATA acceptance; greeting/EHLO multiline/framing, invalid certificate/hostname, auth rejection, RCPT/DATA permanent/transient failures, disconnect at every stage, oversized replies/header injection/dot-stuffing; no real addresses/mail/network.
- Prove actual AbortSignal closes socket and no late success overwrites newer lease; hung connection bounded; shutdown during send/retry; runner never overlaps own tick and respects concurrency.
- Start real runtime via disposable config, request verified lifecycle through queue, observe synthetic sink through in-process test API only (never server public route); capability unavailable on missing keys/config; known/unknown identifier outward responses stay generic.
- Process-level crash/restart with persistent disposable DB at pre-send and post-DATA/pre-ack barriers; stable Message-ID, possible duplicate, one token consumption. Root separately allocates PostgreSQL multi-connection test if local approved database exists; otherwise mark that gate open, do not borrow production.
- Capture logs/DB/DTO for secrets absence with correct scope: user's email may exist in users table, never plaintext bearer/password/key or outbox recipient/body/URL. Existing source regressions and targeted build/typecheck follow as one pool gate.

### Owner/environment decisions remain

Provider/SMTP account and sender/domain ownership, DNS/SPF/DKIM/DMARC operational setup, supported TLS/auth profile and dependency choice, safe credential/key provisioning and rotation/backup, quotas/abuse handling, deployment network egress, public signup/creation policy and activation timing. These are not solved by fake SMTP. Real transport acceptance needs separately approved external environment verification; final inbox placement is distinct. No production activation/push/deploy from this plan.

### Self-contained Luna prompt

> After root authorizes the next pool and confirms backend ownership, implement configurable SMTP adapter + bounded runtime mail scheduler/graceful-stop integration from this review. You are not alone: preserve concurrent edits and own only assigned backend mail/bootstrap/tests. First return dependency-free narrow profile versus approved maintained-client choice; do not add dependency or external SDK without explicit approval. No provider purchase/account, real credentials/env reads, external network sends, firewall/DNS changes, deployment/push/merge or public token/debug endpoint. Keep production disabled by default and use disposable loopback fake SMTP/TLS plus synthetic credentials/data only. Implement certificate-validating TLS, strict protocol bounds/header safety, abort that closes IO, typed safe failure categories, stable Message-ID, non-overlapping bounded runner and shutdown-before-DB-close. Run one connected fake-transport/runtime/restart gate; explicitly distinguish queue committed, SMTP accepted, inbox delivered. Return exact files/revision/hashes, evidence and unresolved real-provider/PostgreSQL/activation gates. Stop at local implementation gate.

## Final frozen-source receipt

Backend owner explicitly declared source frozen after connected gate at HEAD `59ef1b32cffbdc1ed86b89a4c4772bf34bcab4e0` plus dirty mail files. Reviewer re-read repaired lock ordering/drain/crypto and new account error-log helper. No additional source edits requested in this bounded disabled-helper pool. Initial raised P1 findings are closed **at source-review level**, not empirically proven on PostgreSQL.

Backend checkpoint `arkenhar-account-mail-outbox-checkpoint20261009.md` reports DB build, server typecheck/build PASS; five focused test files / 22 tests PASS; Drizzle generate no diff. These are backend-reported receipts, not independently rerun by this reviewer. Error metadata helper drops raw account errors in index wiring; helper-only logging test does not equal a captured whole-runtime secret audit.

SHA-256 fingerprints captured by reviewer after freeze:

```text
apps/server/src/account-mail.ts D2347AE3B9F9AF51719977D632C3EF560C4ACFB07B0DB8B808711751F3E7D0D0
apps/server/src/account-mail-outbox.ts A608E50D14EC1CCE6AA95DAE62B98E4D22455DDEC0EA0C131AF67F00706F5DD7
apps/server/src/account-auth-routes.ts 6E7EAFE4193141B84195F4147E5D001C5A3DA31ED1D34E306E3AFCB09FB75CF5
apps/server/src/env.ts A67A5E79E863E36834D846BE7E4A9EE3334B288EC2C6BF9EEA89083C72E8BF5E
apps/server/src/routes.ts 2127D43EF468004F51AC2CA9D70569592E4A72423F73AA1B0529F9D273D99EF7
apps/server/src/index.ts 643736F696009DC89AA70B9F05E42EAB2B15953920180D3F340EAFE55A0E10EE
apps/server/src/account-error-logging.ts B74A37FF2C7C7ACF1661805BD3A502D177763ED6E1DFA7E3C2A355668035C4C9
packages/db/src/schema.ts CDFA454B76F2A66C8044C804F083F610E97EAB52B89CEBB413A9C2F6B0733F3F
packages/db/drizzle/0053_pretty_giant_girl.sql 3E48466A7511E85BAF00EDF6EF69A9B2B012CB2E1EA80BBA0E4E4C55E78161C1
apps/server/src/account-auth.integration.test.ts 4982A18D8C3D3C07C74309570AD445F677D395157685C04274087113F5A1291A
apps/server/src/account-mail.test.ts 60B971C5DAAEBE3958FF4C50CCF8B101DB77DB8972957C0D215D357A4DE66563
```

Final decision: integration candidate for local encrypted queue/drain-helper foundation only. **Mail delivery is not ready:** runtime transport/scheduler absent and production fail-closed. Remaining acceptance: real PostgreSQL concurrency, persistent process restart/ambiguous-send recovery, full logging secret capture, actual adapter abort compliance and SMTP acceptance, key/provider/owner activation decisions. Next bounded runnable adapter/scheduler pool prompt is above; it does not authorize dependencies/provider accounts/credentials/network/production actions. Reviewer changed only this document and performed no source edits or test execution.

## Dependency preflight and immediately executable split (2026-10-09)

Read-only current lock/install inventory: no `nodemailer`, `smtp-connection`, `smtp-client`, `emailjs`, `emailjs-smtp-client` or `mailparser` entry in pnpm-lock.yaml or matching directories among 658 installed `.pnpm` package directories. `.modules.yaml` records pnpm 10.12.1, store `D:\.pnpm-store\v10`. Filename inventory of its 1505 index entries and the default user pnpm store found no matching SMTP-client package. Thus **no cached/installed Nodemailer version is established**; do not invent version or claim offline install possible. No new dependency was installed. `pnpm store path` unexpectedly attempted package-manager bootstrap and failed EPERM; stopped that CLI path and used filesystem metadata only, with package manifests/lock unchanged.

Practical selected approach: **maintained Nodemailer client adapter, contingent on explicit dependency approval and then exact version/license/security review**. Do not handwrite SMTP to bypass that gate. Root has requested owner permission. Until approval, run only the transport-independent scheduler/privacy pool below; actual SMTP adapter remains separate. No current-version claim or remote research was performed.

### Dispatch now: Luna scheduler/privacy pool, no new dependencies

> Implement a bounded runtime coordinator around existing `drainAccountMailOutboxOnce`, using the already-defined MailAdapter interface and injected fake only in tests. Own new `apps/server/src/account-mail-runtime.ts` and focused runtime tests plus narrow `index.ts`/route-options wiring and account response privacy headers. You are not alone; root must release shared backend files and coordinate any frontend owner before edits. Preserve PG concurrency worker's tests/harness and frozen outbox/crypto source; no source fix there unless root assigns a demonstrated issue. No package install, SMTP implementation, provider/network sends, .env/credential reads, service/firewall/DNS, push/merge/deploy or public debug/token endpoint.
>
> Coordinator must be explicitly enabled and key/adapter-ready before start, have one non-overlapping bounded poll, controllable clock/timers for tests, bounded backoff on transient DB/drain failure, safe count/category diagnostics, and idempotent start/stop. Keep public runtime unconfigured/disabled by default; registration cannot become ready through a fake adapter. Define actual shutdown ordering: stop scheduling, settle/abort active bounded drain through existing adapter contract, then close DB. Do not claim abort stops provider side effects. Do not use a timer per request, unbounded overlapping intervals, shared test-memory runtime sink or global auto-start during import. If existing helper does not permit immediate coordinator cancellation, bound stop wait by validated batch/time budget and explicitly report that limitation rather than force closing DB mid-ack.
>
> Add `Cache-Control: no-store` (including unsuccessful responses and auth session/capabilities/token/invite responses) to the account namespace using a scoped hook; no caches of account email/CSRF/session DTO. Verify response headers on anonymous/authenticated/error paths and ensure game/static caching is not broadly altered. Coordinate web owner for queued—not sent/delivered—wording: register/resend/reset responses mean request accepted for processing; generic known/unknown wording must not reveal account existence. No marketing rewrite.
>
> Tests: fake adapter lifecycle through actual coordinator tick, queue commit then later fake acceptance, no overlap on long drain, bounded retry, missing key/transport stays off, stop before next tick, stop during active drain, startup/shutdown idempotence, no DB access after close, no secrets in captured logs, namespace no-store headers, frontend queued state tests assigned to its owner. Prefer disposable loopback/local HTTP harness and persistent queue fixture where available, never public harness endpoints. Run one connected focused gate plus server build/typecheck. Return exact files/revision/hashes and evidence. Explicitly report: scheduler fake proof is not SMTP/network delivery, process restart/PG semantics remain separate unless actually tested. Stop at local gate.

### Subsequent SMTP adapter pool — pending approval

After owner approves dependency scope, root resolves/pins an exact reviewed Nodemailer version and updates manifest/lock in a separate governed step. Adapter should wrap maintained client TLS/auth/protocol behavior rather than implement SMTP parser; configure no pool initially to simplify abort/close ownership and enforce bounded DNS/connect/TLS/auth/send deadlines. Confirm how chosen client version closes in-flight IO on abort empirically; do not assume AbortSignal support. Keep sender/host config trusted and credential errors redacted. Use injected synthetic options and a small loopback fake SMTP/TLS fixture (test fixture protocol only), not an external provider. A local fake fixture is not the production handwritten SMTP client.

Separate adapter gate tests certificate/hostname rejection, timeout/socket closure, accepted DATA vs rejected commands, ambiguous post-DATA failure and stable Message-ID, typed transient/permanent results, integration through coordinator, secret-safe logs and graceful shutdown. Public runtime remains disabled until provider configuration, keys, sender domain, owner policy and authorized external transport gate are complete.

Cache cross-check completed: content search for exact package names across 1505 D-store and 998 user-store index JSON files also returned no matches. This proves only inspected caches lack those entries, not global machine absence. No dependency version can be selected from this evidence.
