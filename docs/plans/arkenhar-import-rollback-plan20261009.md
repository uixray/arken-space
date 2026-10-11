# ArkenHar — local import failure / rollback rehearsal plan, 2026-10-09

## Scope and truthful outcome

Plan only, NOT RUN. Inspected docs HEAD `c2ab03a2ff501ccbf5302a1f596cc6a2f625d590`; product source52013d4. Latest root checkpoint and readability runtime section establish restored global139 route/hash/full-decode PASS, not full recovery. Older pending/no-auth text retained inside the readability document is superseded by its actual-runtime section and root checkpoint; do not rerun the accepted gate merely because of stale prose.

Rehearse **actual persisted partial import, interrupted/ambiguous client recovery, rejected input and exact paired rollback** on new disposable LOCAL databases/media only. Existing currentQA `arken_qa`/OID16384 via14181 remains untouched; existing paired restore `arken_qa_pair_20261009_b10d6e69`/OID26493 and its139-file snapshot remain retained/unchanged. No reconstruction/deletion of173 historical missing objects. No migration/seed/new user fixture, remote/deploy/push/merge, stock server entry or full legacy E2E.

Outcome is scoped rollback of this known incomplete139-file baseline, not recovery of missing173 or proof of production rollback/images. Root explicitly reviews/assigns each execution gate; a request to prepare helpers is not launch GO.

## Official contracts inspected / tools not to reuse blindly

- `scripts/import-local-qa-stickers.mjs` is **legacy campaign importer**, hardcoded `127.0.0.1:15180`, legacy source folders/private state and `/api/sticker-packs`. Its dry-run only inventories inputs; apply can publish. It is NOT a global-catalog importer and must not be run/retargeted as if it implements current global idempotency.
- No tracked dedicated global-import executable was located in the narrow scripts/source listing. Current authoritative global contract is `apps/server/src/global-sticker-catalog.ts`; root may supply a previously reviewed ignored importer separately, but planner did not read private code/inputs. Otherwise implement a new ignored bounded HTTP driver, not product changes.
- Create: `POST /api/gm/global-sticker-packs` `{actionId UUID,name}`; same creator/action/name replay returns existing pack, changed name conflicts. Upload: `POST /api/gm/global-sticker-packs/:id/stickers` multipart plus strict metadata `actionId,sourceSha256,name,altText` and optional authorCredit/licenseNote/sourceReference. SourceSha256 binds submitted source bytes; stored converted-WebP hash is a different identity. Same action+metadata+SHA replay returns existing sticker **before retry file consumption**; changed intent conflicts. Detail GET exposes persisted action IDs/metadata/source hashes for reconciliation. Publish is revision-CAS with ACTIVE replay; this plan does not need publication or messages to test import rollback.
- Store upload can precede DB transaction; source catch paths attempt cleanup or reconcile ambiguous committed action. A process killed between file write and DB commit may leave an orphan: do not assume cleanup ran.
- `infra/backup/backup.sh` is production-Compose/restic oriented, fixes project `arken-space`; do NOT run it for this local pool. `infra/backup/restore.sh` requires `ARKEN_RESTORE_CONFIRM=isolated-clean-target` then delegates the broad restic/Compose runner. That runner defaults to `SNAPSHOT_ID=latest` and a production health URL unless isolated configuration supplied. Neither script is this narrow existing-container rehearsal. Reuse their **contracts** (exact snapshot identity, dump/media checksums, table/schema proof, isolated target, actual readability), not their production defaults or startup/migration behavior.

## Luna ownership / prerequisites (Gate0)

Own one new ignored `.data/qa-prep/import-rollback-20261009-<unique>/` with receipts/helpers/new copied media and one sanitized checkpoint. You are not alone; preserve concurrent work. Root coordinates no-currentQA-write observation window if currentQA before/after fingerprints are requested. Credentials only programmatic authorized inputs, never stdout/env dump/DSN arguments, public docs, Git or Linear.

Propose two new DB names, each absent before creation:
- `arken_qa_importfail_20261009_<nonce>` — working fault target F.
- `arken_qa_importback_20261009_<nonce>` — recovered baseline target R.

Capture actual allocated OIDs once created; never hardcode guessed OIDs. Reject names/OIDs16384,24647,26493 and any pre-existing unrelated target. Both use existing loopback14181 QA PostgreSQL container, no container/volume lifecycle. Privileged creation/restore connection performs only exact quoted new-name operations; every app connection guards `current_database()` plus actual OID before import/env/routes/listen. Resolve media roots beneath the unique rehearsal directory; reject links/reparse escapes and any equality with live/snapshot/media source. Proposed API loopback **14186**, sequentially bound to F then R, strict free-port check. No14182/14183/14185 changes.

Private source inputs: the already hash-proven paired DB archive `current-qa.pgcustom` SHA `b28e1975c63bd87a2fa5c0e881650bfac6dafed669f46898733e1fe8e0926dab`,523TOC, and exact restored139 snapshot manifest under `20261009-b10d6e697c264c3f83ebd577a058300d`. Root/operator resolves paths programmatically from the known private receipt, not filesystem search or planner reads. Original PNG manifest paths were not present in earlier recovery audit: do not claim they are available now.

For a **mechanism rehearsal**, choose two distinct valid stored WebP buffers from the approved139 snapshot and copy them as immutable test inputs with actual input hashes. Label them transformed-storage-derived test inputs, not original24/115 PNG import acceptance; reuse bytes without modifying source snapshot. Read-only copy/input permission must be included in root scope. If owner requires exact original24+115 importer rehearsal, missing original source bytes are a concrete BLOCKER; this two-item run cannot satisfy that criterion.

Gate0 deliverable: frozen helper hash/source review, target names/port/media containment, fault boundaries, auth eligibility plan, allowed writes and cleanup ownership. Root GO before creating/starting anything.

## Gate1 — establish and back up the actual baseline

1. Verify exact source archive SHA and `pg_restore --list` exit0/523TOC. Create F only after absence check, record OID, restore with `pg_restore --exit-on-error` exit0; capture each command exit independently, no masked pipeline status. No migration. Copy139 files into new F-media and hash compare source→copy; do not serve source snapshot directly because imports must write only F-media.
2. Verify schema/journal matches source and all baseline storage refs312, present139, missing173 categorized141/31/1. Fingerprint **all full rows of every public domain base table**, excluding only sessions in a separately listed set. Use deterministic column serialization (null/type distinctions preserved), stable sorting by primary key or canonical complete row for tables without PK; retain row counts/per-table hashes/overall hash, not row payload. Include schema/constraint/index and migration-journal hashes, sequences/identity state separately. Counts alone cannot prove rollback.
3. Establish auth using existing restored matching GM credentials through real `/api/auth/gm`; no seed/rotation/new membership/grant. If PLAYER needed later, only existing nonrevoked grant branch with no displayName, never unclaimed invite. Record exact natural session delta separately. Missing eligible token => BLOCKED, not direct session insert/test header.
4. Quiesce this owned harness/connection before backup. Baseline B0 is now this exact F DB after planned preflight sessions; include sessions in a separate full-row baseline as well as full domain baseline. Take fresh `pg_dump -Fc` exit0 into unique private archive; SHA/bytes and `pg_restore --list` exit0 with actual TOC count. Snapshot F-media recursively into new B0-media with per-file relative-key/length/stored-byteSHA, no overwrite. Pre/post full-row+schema+sequence+media fingerprints must agree while quiesced. Exact B0 DB archive plus B0-media manifest define the rollback target, not `latest`.
5. Reopen F only through root-reviewed source-faithful harness, no ensureSeed, loopback14186, real routes/auth/cookies/rate-limit/plugins/DI/error handler. Reuse prior accepted composition by reviewed delta for exact new OID/media, not blindly reuse an entry pinned to26493. Root explicitly GO for launch. Verify listener ownership/address. B0 includes no test import entities.

## Gate2 — real partial import and controlled failure

Freeze immutable import intent BEFORE requests: unique pack create actionID, two distinct sticker actionIDs, input source hashes, exact metadata/name/alt/provenance and target F identity. Never replay this state against currentQA/another DB accidentally. Receipt binds intent to target name+OID+media-root identity and sourceSHA.

1. Create one **new own DRAFT test pack** using real GM API; expect201. No existing pack mutation, no orphan ownership change or operator allowlist invention.
2. Upload item1 through the real route; use an HTTP client-local response-loss hook that fully consumes the server response privately but deliberately withholds it from importer state persistence, then exits the importer. This creates a genuine committed-server/lost-client-ack boundary without killing server/DB or injecting product code. Independent read-only detail/DB evidence must prove item1 persisted before calling this case exercised. Record exact injected failure, not “spontaneous outage”. If persistence unproved, classify attempted interruption, not commit-ambiguity PASS.
3. Fresh importer process reads only frozen intent and last durable state, authenticates normally if needed, queries official own-pack list/detail and reconciles creator/action IDs. Replay identical create/upload action: expect stable IDs/replay status200, no duplicate rows or new media. Changed declared metadata/SHA for same action should409; state remains unchanged. This tests intent conflict, not verification of arbitrary changed retry bytes (route deliberately replays before consuming them).
4. Submit item2 once with a new actionID and intentionally mismatching declared sourceSha256 or another narrowly reviewed schema-valid invalid upload. Confirm actual route's expected rejection code from source before running; do not hardcode guessed error. Capture response status/code, count/row/file delta and absence of committed item2. Do not publish despite one successful item. The importer must stop and retain a recoverable partial receipt, not print all error bodies/private paths or report success.
5. Verify partial state: exactly owned test pack + item1/media delta, no duplicate from retries, rejected item2 absent; existing baseline rows byte-equivalent via full-row hashes, media139 unchanged. Inventory any orphan files by storage-reference comparison; an orphan is retained failure evidence, not silently deleted. No broader crash windows or repeated sweeps in this pool.

If initial failure case exposes an implementation defect, stop before product edits. Root decides a bounded repair/new test assignment. Even if retry succeeds, the actual rollback remains required; replay/resume is not rollback.

## Gate3 — restore the exact pre-import pair and switch isolated target

1. Stop ONLY owned F API14186 gracefully, verify listener gone and no F app writers. Retain F DB/media/partial receipt as failure evidence; do not drop/clear its tables/media. No destructive in-place restore and no terminating other sessions. Check active14182/14183 unchanged.
2. Verify B0 archive/media hashes again and list dump exit0. Create absent R, record fresh OID. Restore B0 into empty R using `pg_restore --exit-on-error`, demand exit0. Copy B0-media into separate new R-media; verify complete manifest. No imports/migration/seed. R is a genuine recovery from pre-import backup, not a transaction rollback or merely reverting code.
3. Before auth/HTTP, compare R against B0 **full rows including session table separately**, schema/constraints/journal, sequence state and media manifest; exact equality required. Verify all newly imported pack/sticker/media IDs/actionIDs absent in R, not just hidden by visibility. Baseline global2/139/139 and312refs/139present/173missing identical. Count/hash any missing differences; no normalization beyond documented transport/ordering. If physical dump metadata differs while logical content matches, report logical scope explicitly, never require archive bytes to equal a new dump.
4. Root approves rebind of the same loopback14186 harness to R with new mandatory same-client OID/media guards; no automatic fallback to F. This explicitly rehearses configuration switch to recovered pair while retaining failed pair. Authenticate restored existing identity again using real official route; new sessions are separately recorded from B0 and excluded ONLY from post-auth domain equality, not silently ignored earlier.
5. Run scoped recovered readability: catalog2/24+115 and139 exact IDs; all139 full content GETs matching R stored-byte hashes/size/headers/full decode, plus anonymous401. This is a post-rollback check on R, not reuse of earlier26493 results. No message publication/send/operator actions needed. Recheck full domain/media equality after HTTP, sessions exact allowed delta. If API smoke fails, rollback gate FAIL/BLOCKED even when restore command exited0.
6. Stop only owned R API, verify listener gone. Retain F/R DBs, media, B0 backups and immutable receipts for root. No automatic cleanup. A future explicit cleanup gate must list exact resolved contained directories/newDB names/OIDs and preserve evidence first. Never run gameplay reset.

## Result matrix and limitations

| Gate | Required evidence | Initial state |
| --- | --- | --- |
| Isolation | exact F/R name/OID/media/loopback/process guards; protected originals unchanged | NOT RUN |
| B0 backup | quiesced full-row/schema/sequence/media equality, dump/list0, exact hashes | NOT RUN |
| Failure exercised | committed item1 before lost acknowledgement, actual rejected item2, immutable receipt | NOT RUN |
| Idempotent recovery | stable action/IDs, conflict rejected, no duplicate rows/files | NOT RUN |
| Actual rollback | B0 restored into R, full equality before sessions, test delta absent | NOT RUN |
| App after rollback | actual139 payload/hash/decode and auth; domain/media unchanged | NOT RUN |
| Complete historical recovery |173 missing objects still unresolved | NOT PASSED |
| Production/image rollback | no preserved production images/restic/remote verification in this scope | NOT RUN |

Dump stdout/stderr remain private; outward receipt only exit codes, safe counts/digests, timestamps, target pseudonyms and state classifications. All actions/session deltas recorded; no invented zero-write claim. Compare currentQA read-only control fingerprints only under coordinated no-write window; concurrent legitimate changes cannot be attributed to rehearsal without evidence. Protected26493 snapshot/DB must remain unchanged throughout; never authenticate against it during this pool.

Rollback assumes quiesced disposable writes. Production full-snapshot restore would discard later writes and needs a separate write-stop/recovery-point decision, exact image identity and tested target-specific backup. Once chat references imported content, deletion is constrained by FKs; do not generalize this DRAFT unreferenced two-item rehearsal into production publication rollback. Deprecation/hiding is not full data rollback.

## Planning checkpoint / next assignment

Changed only this plan. Read latest checkpoint/runtime result, recovery context and narrow official importer/global-route/backup-restore contracts. No private inputs, DB/media/runtime/browser/product changes, Linear, commit or remote operation. Root next assigns Luna Gate0 helper/intent/protected-baseline preparation; receive frozen review artifact first, then separate explicit GO for Gates1–3. Human/auth/main/publication gates remain open independently.
