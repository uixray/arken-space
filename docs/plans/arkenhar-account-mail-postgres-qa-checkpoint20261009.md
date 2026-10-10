# Account mail PostgreSQL QA checkpoint — 2026-10-09

## Scope / state

Bounded two-connection integration QA against a fresh disposable PostgreSQL instance. Product source remained frozen; only the opt-in integration test and this checkpoint were added. No external mail, credentials, network pulls, existing databases/containers, deploy, commit or remote actions.

Base HEAD: `59ef1b32cffbdc1ed86b89a4c4772bf34bcab4e0` plus shared dirty worktree. Test is opt-in through `ACCOUNT_MAIL_PG_URL`; it is skipped when unset. Container synthetic secret/connection string are not recorded.

## Cached-image check and isolation

- Read-only Docker image inspection found cached `postgres:15-alpine`, image `sha256:09e4f20b14ddb3dfe3a0c825b206032aaf8f28300ba2070c0b60fc1c10c6abc7` (also `postgres:17-alpine` cached).
- Started only a unique ephemeral container from cached PostgreSQL 15 with `--pull=never`, `--rm`, synthetic disposable role and a fresh database whose name has the required `arken_auth_mail_qa_` prefix; random host port bound to `127.0.0.1` only. `pg_isready` passed.
- After the focused run, verified the container id before stopping it. It exited and Docker `--rm` removed it. No other container was stopped or changed; no volumes or retained DB.
- Fresh migration suite applied all ordered SQL files including 0053 before tests. Test fixture reset uses `TRUNCATE users CASCADE` only inside this disposable DB.

## Added artifact

- `apps/server/src/account-mail-postgres.integration.test.ts`
  - Opt-in real PostgreSQL test harness uses existing `@arken/db` client (no dependency changes), fresh migrations and multiple pool connections. Before any connection/migration/truncate, it rejects all non-loopback hosts, database names without the dedicated prefix and roles without the synthetic `authqa` prefix; a negative test checks non-loopback and non-dedicated targets.
  - Verification confirmation vs resend uses a disposable trigger sleep after the action-token row update plus `pg_stat_activity` barrier, then asserts both HTTP requests complete and no token remains active after verify; this exercises the user → token → outbox order without PGlite assumptions.
  - Competing drainers: first transport is held; second worker cannot claim the live lease.
  - Fenced stale acknowledgment: replace a live lease while old transport is blocked; old worker cannot overwrite it; after lease expiry the replacement worker recovers and accepts the row.
  - Existing-token replacement rollback: a test-only constraint rejects the replacement pending row; route returns failure, transaction retains original unused token/accepted outbox row, then original token still confirms.

## Verification

- `pnpm --filter @arken/server typecheck` — PASS after adding harness.
- With `ACCOUNT_MAIL_PG_URL` pointed to the disposable loopback PostgreSQL DB (synthetic account, application name set, client notices reduced): `pnpm exec vitest run apps/server/src/account-mail-postgres.integration.test.ts --reporter=dot` — PASS, 1 file / 4 tests, including PostgreSQL 15 fresh migrations, target-guard rejection, and multi-connection lock/lease/rollback checks.
- `pnpm --filter @arken/server typecheck` after final target guard — PASS.
- No product files changed in this pool; test suite and build from previous checkpoint were not rerun because product source remained frozen.

## Limits / next action

- This tests local PostgreSQL 15, not the production PostgreSQL version, topology, proxy, load or multi-process deployment. It provides deterministic evidence for the tested interleavings only; it is not full account/auth/security acceptance.
- Mail uses an in-process fake transport. No SMTP/provider acceptance, runtime scheduler, process crash/restart, real inbox delivery or production key lifecycle was tested.
- Next: root integrates this QA receipt with earlier local queue checkpoint; real transport/activation remains a separate owner-approved gate. Do not commit or alter product code from this QA-only pool.
