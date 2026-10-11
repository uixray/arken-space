# SMTP integration source review — 2026-10-09

## Scope / provisional disposition

Bounded source review of new SMTP adapter/context, env/index/routes wiring, server manifest and pnpm lock, plus focused test source. No source edits, private fixture/env reads, dependency install, external send or test execution by reviewer. Final frozen-source disposition appended below. Prior crypto/PG/auth/image gates not repeated.

## Finding sent to worker

**P1: pre-TLS connect timeout can leave sendMail pending.** In initial reviewed getSocket implementation, timeout set `settled=true` then destroyed socket with error. The error listener's finishError immediately returned because settled was true, never notifying Nodemailer callback. Later abort also could not complete that callback. Outer outbox timeout masked the unsettled adapter promise, but direct send and resource lifecycle were incorrect. Requested finishError(timeoutError) before destroy, plus silent TCP server regression proving bounded adapter rejection and actual socket close without relying on outer drain timeout. Status: FIXED in frozen source; timeout destroys socket then invokes finishError without pre-setting settled. Direct adapter regression observes SMTP_TIMEOUT and actual client TLS close.

## Reviewed invariants

- Production index creates one context and passes its exact adapter/keyring/runtimeEnabled to runner and registerRoutes. Route default factory remains for compatibility; actual entry point explicitly injects shared context. Registration contract unchanged: email/password, mandatory verification, no invitation requirement or automatic campaign ownership.
- Implicit TLS only, certificate validation true, DNS hostname supplied for SNI; injected private CA is test API only, absent production env. No plaintext/opportunistic TLS fallback. Username/password/config validation errors use fixed message; Nodemailer logging/debug/transaction logging disabled; returned failures scrub raw provider replies.
- Non-pooled one-shot transport; stable queue UUID Message-ID. Recipient/from restricted to mailbox-like values; CR/LF/NUL rejected in headers, subject/text bounded. No attachments or user-directed URL/file fetch inputs.
- Runtime explicit opt-in still defaults off. Config readiness is not provider health. Missing complete config yields unconfigured adapter; partial config throws safely at startup. Already verified login and campaign links are not mail-gated. Start-after-listen and stop-before-DB-close order unchanged.
- Manifest/lock pin Nodemailer 10.0.8 with integrity, Node >=20, no transitive dependency entries added. This is local dependency diff evidence, not a vulnerability audit or claim about newest upstream version.

## Evidence limits / precise residuals

- Adapter's SMTP_PERMANENT classification is **not** an immediate terminal queue policy: existing outbox catch retries all transport errors bounded by attempt cap/expiry, stores generic TRANSPORT_FAILURE. Do not describe 5xx fail-fast as implemented. This does not introduce unbounded retry.
- Current lifecycle test uses actual local HTTP auth/campaign routes, context, scheduler and real adapter with synthetic SMTP; it registers auth routes directly, not the complete index/registerRoutes entry point. Shared entrypoint wiring is source-reviewed separately. No production cookie/TLS browser or full game socket claim.
- Adapter abort closes socket; DB claim/ack calls remain without hard deadlines. Existing outer shutdown ceiling is not guaranteed clean settlement under stalled DB. Post-DATA ambiguous send can duplicate; stable Message-ID is not deduplication.
- Provider provisioning, real external acceptance/inbox check, key operations, sender/DNS configuration and activation remain unperformed. Campaign creation entitlement remains owner decision; public signup approval is not unlimited storage or default-three-campaign approval.
- Existing candidate images predate this dependency/integration. New exact-SHA release artifacts/gates are required when root chooses another candidate; never transfer old image PASS to these bytes.

## Checkpoint

Reviewer owns only this file. Concrete timeout finding sent to music_mixer/root; wait for repaired source freeze and targeted receipt, then append fingerprints/disposition. No generic broad rerun requested.


## Final frozen-source disposition

Worker declared freeze at HEAD `d539b3520e6360999c716d764ac3076f4c8fdc9d` plus the listed dirty source. Reviewer re-read repaired timeout, final shared context and bootstrap ordering, then independently hashed all eight owned files; hashes exactly match worker checkpoint `arkenhar-account-mail-smtp-adapter-luna20261009.md`. Transport/key config now validates before DB connection. No additional blocking source finding in this bounded review. Suitable for local integration, **not production/mailbox acceptance**.

Worker-reported final gate: 2 files / **15 tests PASS** (SMTP + runtime), server typecheck and bundle PASS. Reviewer did not rerun tests. This supersedes intermediate 12/13/14-test counts. Separate lifecycle harness is still worker-owned/pending and is not part of that 15-test receipt. The repaired timeout finding is closed at source review plus worker-regression evidence level.

```text
apps/server/src/account-mail-smtp.ts A60A10369A79EF20F71F2F25AC1B29BE2D317F079360553AA4EA30690B303EDB
apps/server/src/account-mail-context.ts D9E325EAFBE7C9F0F4A5343892E5BF44A85E9C6A3B284C33ECEA22F6D0C6DB46
apps/server/src/account-mail-smtp.test.ts CC94665BEAA4D1A754F2FB92ACF6418BE11EB4EC9143E8EADB92BA17707A62A9
apps/server/src/env.ts 3697F477FBBEA3F96E8DBF0239BF067E2EA9394A8E84219E19BC1F69BFB81BF0
apps/server/src/index.ts A138A04A2BB2200D02FF9C282B00850C1A1DB52F3956D2362BB58A0BBB327D10
apps/server/src/routes.ts 3402AFC58AE6FDD5B5B8581DEB7A49966AF5764D028A776B1FCB7A03E62C9387
apps/server/package.json 0A310D97AD538E96235D29670CF849AB1AEBEC1095411D3D58C2339282923665
pnpm-lock.yaml 129D0571BA15E6FECDD6A8630D6ABF44E50E67BD939F3DD9107DB8C8DC19EF29
```

Next action: root integrates frozen adapter after separate connected lifecycle receipt, preserving the precise provider/retry/shutdown limitations above. No new broad re-audit or repeat accepted auth/crypto/PG gates requested. Changed only this review document.
