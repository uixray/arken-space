# UIX-657 account backend checkpoint — 2026-10-09

**Current HEAD:** `53bdea8506a8e716e295da3a3e80705fb771c01f` (no commit made; shared working tree contains concurrent frontend and other task files). **Schema SHA-256:** `packages/db/src/schema.ts` = `949C320D51709852723769D92CBBBF8F07CDB3F5DDF09738F21071C24EE1E30F`.

## Frozen decisions/current source

- Email/password account lifecycle with verified-email action tokens; password helper uses Node async bounded `scrypt`. No external crypto package.
- Campaign bearer-link authentication is distinct from accounts and has explicit source provenance: `ACCOUNT`, `GM_LINK`, `PLAYER_GRANT`, `LEGACY_INVITE`. No public alias login, inferred provenance/backfill, or alias-based account binding.
- Account game sessions require an active verified parent and membership ownership match. GM credential campaign/revision, PLAYER grant identity/revision/role, and claimed non-revoked legacy invite/PLAYER role are validated on HTTP and socket auth. Historical unbound sessions and link sources when campaign-link access is off in account mode fail closed.
- Account login session insertion locks and rechecks the user row/password verifier inside the transaction. Password reset and change acquire the user row first, then action-token/session rows, so a session cannot be minted after reset has revoked the account's sessions. Reset and invite claims use database `clock_timestamp()` predicates after row-lock waits.
- Legacy invite claiming now locks the invite and conditionally marks it claimed only while unclaimed, unrevoked, and unexpired before changing ownership or creating memberships/controllers. The subsequent work remains in the same transaction; stale/expired/revoked claims roll back without side effects.
- Link feature, signup, and campaign creation are independent explicit capability flags. Defaults remain disabled; production cannot silently enable signup/campaign creation without recorded policy approval. Link issuance requires exact configured Origin.
- Campaign selection is serialized on the account-session row; old game sessions expire transactionally, with socket disconnection after commit. Legacy invite revocation has `revoked_at`, expires linked sessions, and disconnects sockets after commit.
- Current app mail is only an in-memory test outbox or unconfigured fail-closed adapter. No durable encrypted queue/SMTP; public production account activation is not complete.

## Exact owned files

- Server: `apps/server/src/auth.ts`, `env.ts`, `index.ts`, `routes.ts`, new `account-auth-routes.ts`, `account-campaigns.ts`, `account-mail.ts`, `password-security.ts`.
- Server tests: `account-auth.integration.test.ts`, `account-campaigns.integration.test.ts`, `account-session-provenance.integration.test.ts`, `account-realtime-auth.integration.test.ts`, new `account-login-reset-race.integration.test.ts`, `beta-player-auth.integration.test.ts`, `account-mail.test.ts`, `password-security.test.ts`.
- Contracts: `packages/contracts/src/account-auth.ts` (new), `packages/contracts/src/index.ts`.
- DB: `packages/db/src/schema.ts`; new migrations `0049_account_auth.sql`, `0050_cuddly_nightshade.sql`, `0051_thick_saracen.sql`, `0052_safe_maverick.sql`, plus matching Drizzle journal/snapshots.
- Do not attribute dirty `apps/web`/E2E files to this backend pool: those are Music frontend owner work. Root owns Git integration and Linear updates.

## Exact verification receipts

Build/typecheck commands all passed:

```text
pnpm --filter @arken/contracts build
pnpm --filter @arken/db build
pnpm --filter @arken/db typecheck
pnpm --filter @arken/server typecheck
pnpm --filter @arken/server build
```

Focused tests, each run locally in Vitest:

- `account-auth.integration.test.ts`, `password-security.test.ts`, `account-mail.test.ts`, `beta-player-auth.integration.test.ts`: **18 passed / 18**. Includes additive legacy-preservation migration fixture and the two prior Pool A regression repairs: retry of unverified registration sends again without replacing the original password; migration test applies account migrations only after legacy records are seeded.
- `account-campaigns.integration.test.ts`: **4 passed / 4**, including concurrent selection leaving exactly one active account-backed game session.
- Root SQL review identified PostgreSQL CHECK's NULL acceptance risk; migration 0051 and schema snapshot now wrap the provenance predicate with `COALESCE((...), false)`. Added DB-level negative insert cases for null-source mixed fields, incomplete ACCOUNT source, and GM link missing revision. Updated provenance+campaign result: **9 passed / 9**.
- `account-realtime-auth.integration.test.ts`: **2 passed / 2**, using actual loopback Socket.IO: account logout disconnects an already connected game socket; a foreign-account membership is rejected before connection.
- `account-login-reset-race.integration.test.ts`: **2 passed / 2**, using barriers to prove old-password login cannot mint after a reset commits and reset rejects a token that expires while waiting for the user lock.
- `account-session-provenance.integration.test.ts` now additionally has stale/revoked and expiry-while-waiting invite-claim cases. The expiry-while-waiting test holds an invite row lock, expires it before release, and verifies no membership/ownership claim survives. `claimInviteOwnership` claims conditionally before any side effect in one transaction.
- `account-auth.integration.test.ts` was rerun after serialization: **7 passed / 7**. Password/mail/alias tests earlier in the same 4-file suite were 11 additional passes; their source paths were not changed by the P1 edits. Actual current focused receipt totals **33 passed / 33 across 8 files** (18 lifecycle/security/mail/alias + 4 campaign + 7 provenance + 2 login/reset race + 2 loopback socket). PGlite fixtures applied migration set including updated `0051_thick_saracen.sql` and `0052_safe_maverick.sql`; no production database was accessed.

## Remaining / next

- Music frontend owner earlier saw local campaign create return HTTP 500. The focused integration failure was traced to a test fixture lacking the supplied `sessionTtlDays`/`cookieSecure` options and is fixed; frontend owner was asked to restart and retest current backend. That live UI rerun is pending and is not claimed passed.
- Root review requested socket evidence specifically for account revocation/reset; current actual socket test covers account logout only. Grant rotation/revocation socket path is not yet separately exercised end-to-end (grant revision and invalidation are covered by PGlite source tests, and existing route logic disconnects session rooms).
- Root/ASTRA identified and the source/tests now cover two additional P1 interleavings: login verification followed by reset before session mint, and invite expiry/revocation while claim waits on a row lock. `clock_timestamp()` is used for authoritative expiry decisions after lock acquisition; these paths are locally tested in PGlite.
- The last full server typecheck invocation surfaced four existing argument-count errors in a concurrent guide-owned `account-link-realtime.integration.test.ts`; guide owns that test and has been notified. The earlier account-auth route errors from this invocation were fixed. Root will rerun the connected typecheck gate after the guide test is ready. No claim that the latest full typecheck passed.
- Durable encrypted transactional mail outbox/worker and provider acceptance/recovery remain incomplete; production SMTP is not configured. Broader token race/replay and production activation gates remain open. No deployment or production feature activation.
- Root to integrate/review and coordinate fresh runtime with Music/guide workers; do not commit from this subtask.

## Root connected integration gate
2026-10-09: `pnpm --filter @arken/server typecheck` PASS, then one workspace-root Vitest invocation of the eight owned test files PASS8/8files33/33tests (59.43s). This is fresh evidence after P1 lock/expiry changes; earlier 29/29 remains historical. New guide-owned link socket test is not part of this33-test receipt. C actual HTTP account/campaign flow1/1 separately passed after session TTL fixture repair; full gameplay in persistent account stand independently proved login/select/bootstrap/browser only. Mail durability and full public acceptance remain open.
