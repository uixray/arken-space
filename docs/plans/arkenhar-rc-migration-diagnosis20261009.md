# ArkenHar RC and 0047 migration diagnosis — 2026-10-09

## Finding

**Do not declare an RC candidate or migration command green yet.** The repository has a bounded, source-reviewed candidate slice and fresh narrow UI evidence on product source `52013d43e6f2fca1bb268c38608afde9cd76424a`, but not a complete release dossier. The migration's recorded post-state is consistent with successful application of 0047 while its wrapper reported exit 1. Existing evidence does not identify which process returned 1 or why. No migration, restore, import, service restart, or production action was performed for this diagnosis.

## Candidate / evidence manifest

| Evidence item | Exact identity / result | Scope and limitation |
|---|---|---|
| Current checkout | HEAD `f67e53b7453a79230624d1ca2e228e5f3b35d928`; product source base `52013d43e6f2fca1bb268c38608afde9cd76424a`; branch `codex/uix-293-catalog-20261007` | Later commits are documentation. Working tree has a concurrent edit to `docs/plans/uix-644-runtime-coverage.json` and existing untracked `.tmp/`; neither belongs to this assignment. Preserve both. |
| Product delta from global implementation | `3ed0f51966e0c547b33311387c10e52f4e42391f..52013d4`: only `apps/web/src/GlobalStickerPackManager.tsx` and `.test.tsx` (96 insertions, 1 deletion). `52013d4..HEAD` has no `apps`, `packages`, or `infra` source delta. | Escape fix only; no backend/database implementation changes in this delta. |
| Focused Escape gate | 2 suites / 25 tests passed; web typecheck exit 0; browser Chrome/Firefox × desktop/compact 4/4; web build exit 0 with large-chunk warning. Build log: `.data/qa-prep/uix644-escape-build-52013d4.log`. | Evidence reported in continuation checkpoint, exact product source SHA above. Browser cells exercised summary close, held Escape, fresh Escape; native select/input passthrough is DOM unit evidence only, native OS popup remains human-pending. Do not imply whole-service or native-popup acceptance. |
| Cross-campaign runtime | Receipt `.data/qa-prep/uix497-crosscampaign-runtime-20261008181718752-2c899095-ef81-4fa3-ae0d-c3c7d6d9e07c.json`, receipt SHA `367DC677C024569D2AF36D63F143946622F55EB0B158C78A67D5843EE2E55216`; source `52013d4`. | Four authenticated GM/PLAYER contexts, same 24+115 global catalog IDs, two same-campaign sends HTTP 201 and receiver realtime/persistence/image checks passed. Foreign detail returned 404 concealment; creator mutation was not runtime-probed. Not RC-wide evidence. See `docs/plans/uix497-crosscampaign-runtime20261008.md`. |
| 0047 migration source | `packages/db/drizzle/0047_global_sticker_catalog.sql`; SHA-256 `c413656c3d5b7110293063c9c73148e4cba1680cd1588910814dedc6de11a59c`; journal entry index 47/tag `0047_global_sticker_catalog`. | This is a source identity, not proof it ran in a target/release environment. |
| Migration wrapper chain | root `db:migrate` → `pnpm --filter @arken/db migrate` → package `tsx src/migrate.ts`; migration runner resolves `../drizzle` relative to its own module URL, requires `DATABASE_URL`, applies Drizzle migrations, then calls `client.end()`. | No wrapper code changed in the candidate source delta. Runner has no explicit success receipt/try-catch. The called child's code/termination was not captured in the sanitized receipt. |
| Sanitized migration receipt | `.data/qa-prep/uix293-global-import-prep/0047-migration-receipt.json` (read only whitelisted metadata; no DB URL, command string, private fixture or DB payload). `commandExitCode: 1`; expected SQL SHA matches current; pre journal latest ID 47, post latest ID 48; post schema hash exact; global FK/check constraints validated; global tables were empty at migration time. | Preserved-campaign baseline records 141 media rows, 3 packs, and unchanged pack IDs/counts/media rows. These recorded postconditions make a wholly unapplied migration unlikely, but they do not prove command success, transaction semantics, or live data correctness independently. Do not retry on current DB. |
| Backup evidence | Receipt records size 311439 bytes, SHA-256 `578beb0d6024798010722ef8c6691287fb4407ea3eda826bed147773c8077295`, TOC count 503 and `pg_restore` list validation true. | Restore validation/execution are both false. It is an inspected backup artifact, not a proven recoverable backup. |
| RC checklist / release path | `docs/production-release-checklist.md`, `docs/deployment.md`, `infra/deploy/release.sh` inspected. | Checklist requires exact reviewed committed SHA, clean tree, ancestry verification, release gates, backup + actual restore rehearsal, and human acceptance. Owner-excluded full legacy E2E must be labeled `NOT RUN / owner-excluded`; narrow gates remain separate. `release.sh` is not a dry run: unconfirmed path still performs backup/restore work. No release script run. |

## Exit-1 diagnosis

Known: the receipt says the wrapper returned 1; sanitized log summary says only benign already-exists NOTICE records were captured and no fatal text/stack trace was captured; post-state has migration journal ID 48, exact expected schema hash and validated constraints. Therefore the current evidence is internally consistent with **migration state applied, invocation not green**.

Not known: whether exit 1 came from the migration child, pnpm/tsx wrapper, a post-commit `client.end()` failure, a signal/termination, or parent-side exit capture. The receipt does not carry child exit code/signal, process IDs/termination status, structured stdout/stderr boundaries, or a post-close verification phase. The migration source has no explicit success print and awaits `client.end()` after `migrate()`, so a post-commit close failure is a plausible hypothesis only—not a finding. The benign NOTICE summary alone cannot explain an exit 1.

The exact failed invocation is intentionally not copied here because it may contain private connection material. Historical Node/pnpm/tsx runtime versions and cwd were not recorded in the sanitized evidence. No raw log was opened or copied. A sandbox listener probe returned no rows; root elevated preflight independently verified API14182 and Vite14183 health200 and the existing QA DB running. The sandbox result is not outage evidence and does not justify a restart.

## Release dossier gaps / decision

1. **Candidate provenance:** the product SHA is known, but the release plan explicitly lacks a clean release worktree proof and a fresh same-host ancestry check against `origin/main`. Current status also includes a concurrent modified coverage doc and `.tmp/`; do not clean or stage them. Do not fetch as part of this pool.
2. **Build/runtime identity:** the web build is tied to product SHA `52013d4`; it has a chunk warning. No fresh API/runtime build or currently live listener identity was established in this audit.
3. **Migration gate:** 0047 source hash and DB post-state are recorded, but exit 1 unresolved. Do not relabel green or rerun against the current QA DB.
4. **Recovery:** backup TOC/list is good, but no isolated restore validation has occurred. Backup readiness remains unproven.
5. **Test scope:** focused Escape and cross-campaign evidence are bounded successes. Full legacy E2E is owner-excluded, not passed. Cross-campaign mutation authorization, native popup, human image/content and GM usability acceptance are not established by those receipts.
6. **Publication:** public authentication/registration remains deferred; secret-link access is not a substitute. Remote host/deployment and owner acceptance remain separate later gates.

## Next isolated reproduction (proposed P2; not executed)

Use a **new disposable database** on the already-authorized local test stand, never the current QA DB. First identify the exact backup artifact privately and verify its SHA-256 and TOC count against the sanitized receipt; restore only into a unique disposable database and record the restore exit code. Then run the exact checked-in migration wrapper once against that isolated database, with a private environment file/secret store (never command-line DSN or stdout), and capture separately: parent exit code, child exit code and signal, PID/termination status, start/end timestamps, runtime versions, cwd, stdout/stderr file hashes, and post-run journal index/schema hash/constraint validation. Do not suppress NOTICE or alter migration SQL. If that again yields exit 1 with the post-state applied, compare a second disposable run of the package-level script versus root pnpm wrapper, one at a time, to localize wrapper versus child; do not retry a failed command on the same disposable DB without recreating it from the verified snapshot. Preserve receipts without secrets; destroy only the disposable DB after evidence is saved. Stop if the backup cannot be privately identified/verified or restore cannot be isolated.

Suggested bounded command sequence (operator substitutes only private local connection/config handles; do not put secrets in arguments):

```text
1. sha256sum <private-backup-file> && pg_restore --list <private-backup-file>
2. createdb <unique-disposable-db-name>
3. pg_restore --exit-on-error --dbname=<private-disposable-connection> <private-backup-file>
4. run the checked-in root migration script with DATABASE_URL supplied via private environment, capturing parent/child status and stdout/stderr separately
5. read-only query: migration journal latest index/tag, schema hash, FK/check validation; compare with pre-run baseline
```

Do not run this sequence until the next pool is explicitly scoped. This task performed no DB writes.

## Checkpoint

- **Decision:** candidate preparation is partial; 0047 remains unresolved and current DB must not be retried.
- **Revision:** audit at HEAD `f67e53b7453a79230624d1ca2e228e5f3b35d928`; source evidence explicitly tied to `52013d43e6f2fca1bb268c38608afde9cd76424a`.
- **Changed files:** only this new diagnosis document. Concurrent `docs/plans/uix-644-runtime-coverage.json` modification and `.tmp/` preserved untouched.
- **Verification:** inspected source lineage, migration SQL SHA, sanitized receipt fields, release checklist/script, and Git source deltas. No tests repeated and no DB/process mutation.
- **Blocker:** exit-1 attribution and isolated restore proof absent; no clean candidate worktree/live ancestry proof.
- **Next:** bounded P2 disposable restore + instrumented migration reproduction, contingent on verified private backup and isolated DB. Keep current DB, remote, and production untouched.
