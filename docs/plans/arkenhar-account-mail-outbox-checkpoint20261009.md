# Account mail outbox checkpoint — 2026-10-09

## Stage / revision

Local backend mail pool implemented against HEAD `59ef1b32cffbdc1ed86b89a4c4772bf34bcab4e0`; source is uncommitted and shared worktree is dirty. No commit, push, merge, production activation, SMTP/provider, credentials, or external network actions. Existing account/campaign-link semantics and P1 credential/invite guards are preserved.

## Decisions and implementation

- Added migration `0053_pretty_giant_girl.sql` and `account_mail_outbox`: one row per action token, ciphertext-only sensitive payload, AES-256-GCM nonce/tag/version/key id, message/token/purpose/version AAD, bounded status/attempt/lease metadata, unique action-token relationship.
- Corrected the `0052` Drizzle snapshot to match the already-applied `0051` COALESCE session constraint fix. The generated 0053 had tried to drop/re-add that predicate; removed this unrelated DDL. `drizzle-kit generate` subsequently reported no schema changes (no phantom diff).
- `account-mail.ts` provides strict injected keyring parsing and AES-256-GCM envelope encrypt/decrypt. Requires canonical base64url, 32-byte keys, 12-byte nonce, 16-byte tag, bounded plaintext/ciphertext, context UUID/purpose/version validation. No default key; test-only keys are random in process.
- `account-mail-outbox.ts` enqueues user/token/ciphertext in the caller transaction, invalidates older tokens and cancels stale payloads; bounded SKIP LOCKED claim, expired lease recovery, stale-row cleanup, unknown-key preservation without starving active keys, action/user eligibility checks, lease-token fencing, retry cap/backoff, terminal ciphertext wipe, bounded adapter timeout + abort signal. Sequential batch size is constrained to fit inside lease deadline + 5s margin. Adapter acceptance is not inbox delivery; delivery remains explicitly at-least-once.
- Auth routes now only return generic accepted after durable queue commit; registration, resend, reset request and token invalidation are transactional. New-user/outbox failure rolls back account creation. Duplicate unverified registration does not replace password. Mail readiness requires injected active key and adapter readiness; runtime adapter remains unconfigured, so public registration capability remains off.
- Verification confirm uses canonical user → token → outbox order (candidate read; lock/recheck user; token CAS using fresh DB clock; cancel payload), avoiding resend/confirm deadlock inversion. Password change/reset remain user-first. Global auth-route errors use redacted stable categories rather than raw errors; no account error message returned in development.

## Changed owned files

- `apps/server/src/account-auth-routes.ts`
- `apps/server/src/account-auth.integration.test.ts`
- `apps/server/src/account-login-reset-race.integration.test.ts`
- `apps/server/src/account-realtime-auth.integration.test.ts`
- `apps/server/src/account-mail.ts`
- `apps/server/src/account-mail-outbox.ts`
- `apps/server/src/account-mail.test.ts`
- `apps/server/src/account-error-logging.ts`
- `apps/server/src/account-error-logging.test.ts`
- `apps/server/src/env.ts`
- `apps/server/src/index.ts`
- `apps/server/src/routes.ts`
- `packages/db/src/schema.ts`
- `packages/db/drizzle/0053_pretty_giant_girl.sql`
- `packages/db/drizzle/meta/0052_snapshot.json`
- `packages/db/drizzle/meta/0053_snapshot.json`
- `packages/db/drizzle/meta/_journal.json`

Other concurrent web/nginx/guide files remain untouched and unowned by this pool.

## Connected verification

- `pnpm --filter @arken/db build` — PASS.
- `pnpm --filter @arken/server typecheck` — PASS.
- `pnpm --filter @arken/server build` — PASS.
- `pnpm exec vitest run apps/server/src/account-auth.integration.test.ts apps/server/src/account-login-reset-race.integration.test.ts apps/server/src/account-realtime-auth.integration.test.ts apps/server/src/account-mail.test.ts apps/server/src/account-error-logging.test.ts --reporter=dot` — PASS, 5 files / 22 tests. Coverage includes lifecycle, queue-vs-delivery semantics, atomic rollback, encryption/context/tamper/key rotation, 4/8/12/15-byte tag rejection, AAD/oversize rejection, unknown-key starvation, concurrent drainer lease exclusion, expired-lease recovery, timeout abort, retry exhaustion, capability fail-closed, P1 login/reset races, live socket lifecycle, migration fixture, and safe error log metadata.
- `pnpm --filter @arken/db generate` with placeholder local-only `DATABASE_URL` — PASS, no schema changes after snapshot sync.

Evidence is local source/build/PGlite only. PGlite is single-connection and does not establish PostgreSQL multi-connection deadlock/lease behavior. No external transport was configured or contacted, and there is no production-ready mail driver or scheduled worker.

## Limits / blockers / next action

- Memory keyring/runtime mail adapter are deliberately absent/unconfigured: real registration remains fail-closed. Owner/environment still must approve sender/provider, inject/rotate/retain encryption keys, configure durable worker lifecycle, and run transport acceptance/recovery/operational gates. No “sent” or “delivered” claim is supported.
- At-least-once semantics permit duplicate messages if a provider accepts and the process crashes before DB ack; stable message ID is supplied to future adapters. Abort signal cannot prove an external provider stopped side effects after timeout.
- Remaining independent gates: disposable multi-connection PostgreSQL concurrency/lease testing; production mail adapter/provider acceptance; production key provisioning/rotation/backup; owner policy approval; full browser acceptance of queued wording; production activation stays forbidden without explicit request and completed gate.
- Next action: root/Astra review the frozen source and run the planned disposable PostgreSQL multi-connection verification before any production mail/registration decision. Do not commit or activate from this checkpoint alone.
