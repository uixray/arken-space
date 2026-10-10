# ArkenHar recovery tooling source checkpoint — 2026-10-09

## Scope and decision

Bounded source-only tooling pool. No Docker build/up, restore/backup runner, restic, database, retained backup, external network/provider, deployment or production endpoint was run. This is not a fresh candidate build, runtime, restore, rollback or release acceptance. The existing production-oriented `scripts/run-restore-rehearsal.mjs` remains separate and was not modified or executed.

## Changes

- `scripts/exact-candidate-context.mjs`: caller supplies a full immutable commit SHA, positive regular-file allowlist, import requirements and approved history list. Default is plan-only with no Git read/write. Export mode resolves the exact commit, reads only listed Git blobs using argv/no shell, rejects unapproved path classes and symlinks/reparse points, and writes only a new child under an explicit `.data/qa-prep` artifact root. Root Dockerfiles and workspace config files have a narrow explicit allowlist. Manifest contains relative file, byte length and SHA-256.
- `scripts/local-candidate-recovery.mjs`: deterministic plan requires full candidate and pre-upgrade SHAs, immutable image IDs, synthetic-only scope, unique project, contained artifact root, distinct loopback ports and exact pre-upgrade snapshot/media/image tuple. Emits `--pull never --no-build`, project-scoped DB/media volumes, count/ledger and fake-only mail checks. Default executes zero commands. Execution is deliberately not implemented pending a separate root-approved gate.
- `docker-compose.restore-candidate.yml`: separate image-ID template, no build, pull policy never, internal project network, DB unexposed, QA ports loopback-only, named synthetic volumes and account mode enabled with registration, legacy dev auth, campaign creation, link access and mail runtime explicitly off. Real `docker-compose.restore.yml` only received the necessary production `ACCOUNT_AUTH_ENABLED=true` and explicit false public-expansion/runtime flags; its previous build/restic production-restore role is unchanged.
- `infra/backup/database-counts.sql` and `scripts/restore-rehearsal-core.mjs`: reconciled all current schema table names, adding account tables (`users`, account sessions/action tokens, campaign creation/invite, encrypted outbox) and global sticker pack/media/sticker tables. Dynamic omission of tables absent in historical migration prefixes is retained.
- Tests: `tests/exact-candidate-context.test.ts`, `tests/local-candidate-recovery.test.ts`, `tests/restore-config-safety.test.ts` plus existing `tests/backup-safety.test.ts` coverage.

## Verification

- Focused source suite: `node node_modules/vitest/vitest.mjs run tests/exact-candidate-context.test.ts tests/local-candidate-recovery.test.ts tests/restore-config-safety.test.ts tests/backup-safety.test.ts --reporter=dot` — **PASS**, 4 files / 39 tests. The positive exporter test creates a tiny synthetic local Git repository, commits only a root Dockerfile and server package manifest, dirties the live file afterward, exports the exact committed blobs into a new artifact child, checks manifest path/hash receipts and rejects output reuse. Separate tests reject symlink/reparse escape before Git access.
- Initial sandboxed pnpm/Vitest attempts hit Windows sandbox `EPERM` in pnpm temp realpath and Vitest atomic rename. Direct installed Vitest CLI succeeded with approved elevated filesystem access; no package install/download was performed.
- No Docker, compose, restic, backup/restore, DB or endpoint command was invoked. No candidate SHA/image IDs were frozen or built.

## Limits and next action

- Positive exact-Git-blob export was exercised only against a synthetic two-file repository, not the ArkenHar candidate. No candidate SHA/context was built; no candidate build, migrations, fresh/upgrade/restore/rollback data arms, media integrity, app/browser/socket checks, TLS same-origin browser auth, shutdown, fake outbox restore or provider acceptance is proven.
- The candidate Compose template is a local synthetic execution scaffold, not proof it can run. Fixture/bootstrap strategy and exact-image plan still require root-frozen source SHA, candidate image IDs, and separate execution authorization. No secrets are materialized by the helper or logged.
- The old restore runner still defaults to restic and `--build`; it is not an acceptable candidate gate and must not be used for one. Candidate tooling remains plan-only until reviewed and separately authorized.
- Root owns integration/review/commit and later runtime gate. Production/provider/deploy/remote actions remain outside scope.
