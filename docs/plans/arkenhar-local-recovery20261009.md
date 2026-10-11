# ArkenHar local recovery and 0047 rehearsal — 2026-10-09

## Result

**Disposable restore and official migration wrapper passed once. The earlier exit-1 anomaly was not reproduced; its original cause remains unknown.** The current QA database was not modified. The rehearsal used only a unique disposable database in the already-running local QA PostgreSQL container. No service was started, stopped, or restarted; no remote or production action was taken.

## Target isolation and backup proof

- Container `arken-uix644-qa-db-20261008` was already running, port `127.0.0.1:14181` mapped to PostgreSQL; its QA volume was `arken-uix644-qa-data-20261008`. No container/volume lifecycle command was used.
- Read-only container metadata showed the actual role/database are `arken_qa` / `arken_qa` (older preparation notes said `arken`). Local socket queries as `arken` and `postgres` failed with “role does not exist”; no write was attempted with those roles. `arken_qa` was verified from non-secret container metadata before proceeding.
- Existing migration backup: `.data/qa-prep/uix293-global-import-prep/backups/uix293-arken_qa-20261008T164747Z.pgcustom`; 311,439 bytes; SHA-256 `578beb0d6024798010722ef8c6691287fb4407ea3eda826bed147773c8077295`; `pg_restore --list` exit 0 and exactly 503 non-comment TOC entries, checked both before and after copying into container `/tmp`.
- Disposable database `arken_qa_rehearsal_20261009_57f5a678` was checked absent, then created empty; OID `24647`. It is retained for root review. It was restored with `pg_restore --exit-on-error` into that database only; restore exit 0, stdout/stderr both empty.
- Restored pre-migration baseline: journal rows 47, latest ID 47/hash `41900f2564b0ca13fd221e1b40fdefc9191e2164788362ec39a707bccc1902d9`; memberships 2, campaign packs 3, campaign media 141.

## One official wrapper execution

Ran checked-in root command `pnpm db:migrate` from the worktree root exactly once, with `DATABASE_URL` assembled in-memory for the disposable database and supplied only through the child process environment. No DSN/password was passed as a command argument, printed, or written to documentation/receipt. Raw stdout/stderr remain in ignored local log files; only byte counts and SHA-256 hashes are recorded here.

- Parent process PID 7448; exit 0; signal null. Migration node PIDs observed during execution: 13468 and 31180; child exit codes were not independently captured. Runtime: Node `v24.15.0`, pnpm `10.12.1`; worktree root cwd.
- stdout 694 bytes, SHA-256 `20b628006bd60d0ca08779c70a31a8bf6feec50bf3aa33b3ba4b038d67de7331`; stderr 0 bytes, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Logs (private ignored local files): `.data/qa-prep/uix293-global-import-prep/logs/rehearsal-20261009-migration.stdout.log` and `.stderr.log`. Restore logs use matching `rehearsal-20261009-restore` basenames. Do not publish raw logs.

## Post-state and current database non-change evidence

Disposable post-state read was limited to migration journal, row counts, and schema/constraint metadata:

- journal rows 48, latest ID 48, latest hash equals exact checked-in 0047 SQL SHA-256 `c413656c3d5b7110293063c9c73148e4cba1680cd1588910814dedc6de11a59c`;
- global packs/media/stickers `0/0/0`; `chat_messages.global_sticker_id` exists; its FK is validated; both expected chat-shape checks are validated;
- preserved aggregate counts remain memberships 2, campaign packs 3, campaign media 141.

The current QA DB was fingerprinted before and after using read-only aggregate queries. Both observations are identical: database `arken_qa`, OID `16384`, journal rows/latest ID 48, latest hash equal to 0047 SHA above, global packs/media/stickers `2/139/139`. Container remained running. This shows no migration or restore was directed at the current database.

Sanitized machine-readable result: `.data/qa-prep/uix293-global-import-prep/rehearsal-20261009-receipt.json`, SHA-256 `71318136B60303FC3A13A34F432A7ABB94C8246B967EF46830D8770D229084DA`. Private root-provenance note: `.data/qa-prep/uix293-global-import-prep/media-root-provenance-private.json`, SHA-256 `6B7415B29B5457EE23D1660896EAC4D27C900EC4EFF7F6853197354033A56116`. These receipts contain no credentials, DB record payloads, campaign/pack IDs, or content.

## Interpretation and remaining evidence gap

The exact current wrapper, local runtime, and 0047 SQL completed successfully against a restored journal-47 disposable snapshot. Therefore the historical exit 1 is **not a deterministic reproduction under this current local environment**. The result does not identify why the earlier invocation returned 1: its exact runtime, actual role/database, per-process exit/signal, and separated raw streams were not captured in the sanitized record. The previous sanitized receipt also reported journal-48 post-state with the expected SQL hash, so it remains consistent with applied migration despite a failed wrapper receipt. Do not rewrite that historical result as a pass.

Backup recovery is only partially established. Database archive integrity, TOC, isolated restore and migration are proven. A paired persistent-media snapshot is **not** proven. The only preparation media directory found contains 139 `.webp` files (10,518,668 bytes). A bounded private metadata-only comparison against current DB references found all 139 global-media storage-key filenames in that preparation directory, but none of the 141 campaign-media storage-key filenames. The DB's `sha256` is the source-input hash used before storage conversion to WebP, so it is not an expected hash for persisted WebP bytes and cannot authenticate those contents.

The actual API storage root is **not established**. Source resolves the field `env.MEDIA_ROOT`; the default is relative `./media`. Root's independent elevated preflight verified that API PID 23636 owns local port 14182 and health returned 200; no API restart was attempted. A bounded parser inspected the known safe process receipt and live process command line only in memory for a `MEDIA_ROOT` argument; neither contained one. The safe receipt gives the `apps/server` working directory but no resolved media root. The environment override is not represented in that receipt, so the default candidate `apps/server/media` cannot be assumed to be active. A metadata-only check of the retained pre-migration restored DB found 0/141 campaign storage-key filenames in the two known candidate directories (prep-media and `apps/server/media`); this is not evidence that those files are absent from an unknown active root. No raw command line/environment, storage paths, keys, media hashes, or media contents were printed. Full DB+media recovery remains pending safe root provenance plus an identified, hash-verified paired snapshot and isolated restore/readability check.

## Next action / guardrails

1. Root reviews the receipt and retained disposable DB. Do not drop it automatically; root may decide when it is no longer needed.
2. To attribute the original exit 1, compare only if the original private log/receipt can supply safe process/runtime facts. Otherwise leave cause unknown; this successful reproduction is enough to establish that the current package wrapper can return 0.
3. Treat full recovery as incomplete until the correct persistent media snapshot and file-to-record coverage are established. Do not treat the staging `.webp` directory as that snapshot.
4. No current QA DB migration retry, import, production migration/deploy, service restart, push, merge, full E2E, or auth change follows from this rehearsal.

## Checkpoint

- **Revision:** source HEAD `f67e53b7453a79230624d1ca2e228e5f3b35d928`; migration SQL SHA recorded above.
- **Changed files:** this new document and ignored private result/log artifacts only. Existing `.tmp/`, concurrent UIX-644 coverage edit and scene work were left untouched.
- **Verification:** exact backup SHA+TOC, isolated restore exit 0, wrapper exit 0, post-migration hash/schema constraints, and identical current-DB pre/post fingerprints.
- **Blockers:** historical exit-1 cause unlocalized; full persistent-media recovery proof absent.
- **Next:** root review; separately locate and validate the paired media backup before claiming full recovery readiness.
