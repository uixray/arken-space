# ArkenHar paired DB/media recovery — 2026-10-09

## Result

**A new local QA database archive and a matching snapshot of the media files present at capture were restored successfully into isolated storage. Full media recovery is NOT proven.** The restored database has 173 referenced objects whose files are absent from the proven active media root: 141 campaign-sticker rows, 31 chat-upload rows, and 1 feedback attachment. Do not label this a complete backup/recovery pass.

No current QA DB mutation, migration, service restart, fixture creation, or production/remote action occurred in this pool. The retained isolated database and snapshot are for review; do not drop them without an explicit cleanup gate.

## Provenance and capture boundary

- Revision: `84641ce38899cb2d6f7edcd144cae2cc3e129d8f`.
- The checked-in media resolver uses `env.MEDIA_ROOT`; the environment default is `./media`. The running API PID 23636 was independently confirmed by root to own local port 14182 and return health 200. A bounded, approved process-environment probe extracted only `MEDIA_ROOT` in memory and stored the exact value solely in ignored receipt `.data/qa-prep/uix293-global-import-prep/media-root-audit-34d2f9b3818947e8bb25a789a852c1c5.json` (SHA-256 `897c447604b5894946bf27f406389b59f10c535e16ee1a894210cfb6edd6cbf1`). The established root contains 139 WebP files / 10,518,668 bytes. No raw environment, command line, DSN, credentials, or path value is included here.
- Snapshot ID: `20261009-b10d6e697c264c3f83ebd577a058300d`; ignored artifact directory `.data/qa-prep/uix293-global-import-prep/recovery-snapshots/20261009-b10d6e697c264c3f83ebd577a058300d/`.
- Capture was coordinated with the fixture/browser worker during its paused, no-browser interval. Pre/post DB table-count fingerprints (56 aggregate rows) and storage-reference fingerprints (312 rows) were identical. Media source manifests before/after were identical. This proves capture stability for those measured aggregates and files, not an atomic historical backup.

## Restore evidence

- Custom-format archive: `current-qa.pgcustom`, 366,355 bytes, SHA-256 `b28e1975c63bd87a2fa5c0e881650bfac6dafed669f46898733e1fe8e0926dab`; `pg_dump` exit 0, `pg_restore --list` exit 0 / 523 TOC entries.
- Restored with `pg_restore --exit-on-error` into the new isolated database `arken_qa_pair_20261009_b10d6e69` (OID 26493); exit 0, empty stdout/stderr. Restored table-count fingerprint and 312-row storage-reference fingerprint equal the captured source.
- The 139 files present at capture were copied into the unique snapshot directory without overwrite. All 139 copied byte/hash checks matched; restored snapshot media has 139 files and 0 hash mismatches.
- Storage reference coverage: global sticker media 139/139 found with matching sizes; campaign sticker media 0/141; chat uploads 0/31; feedback attachments 0/1; assets 0/0. Total 312 references, 139 files found, 173 missing. The measured current media root therefore does not cover those DB references.
- Private, sanitized machine receipt: `.data/qa-prep/uix293-global-import-prep/recovery-snapshots/20261009-b10d6e697c264c3f83ebd577a058300d/paired-recovery-receipt-20261009T035500Z.json`, SHA-256 `197d68dc313b4e36a2197e7dc0f50f967a7528a2ae99713e2b0d143cc9aa6141`. Private manifests contain storage keys and per-file hashes; do not publish their contents.

## Recovery interpretation and next action

Metadata-only comparison found 139 distinct source-input SHA values among the 141 campaign media references overlapping the current 139 global-media source SHA values. This is a possible source-file lineage signal only: those hashes describe source inputs, not stored WebP bytes, and do not authenticate or reconstruct missing campaign files. No copy or reconstruction was attempted. The remaining two campaign references and the 32 chat/feedback references have no proven corresponding file in the active root/snapshot. The earlier prep-only comparison likewise cannot establish a historical paired backup.

## Bounded historical source review

Reviewed only the already-referenced handoff, current recovery checkpoints, the exact known `uix293-arken_qa-20261008T164747Z.pgcustom` database backup and its sanitized preservation receipt, and the exact source paths in the retained global-import manifest. The known archive is a PostgreSQL custom-format database dump; it proves database rows/metadata, not a paired filesystem-media archive. The preservation receipt says the old 141 DB media IDs/source-SHA values were unchanged across import; that is preservation evidence, not a stored-WebP byte backup. The checked-in manifest names 139 imported source files across two referenced directories, but an exact-file metadata check found 0/139 present at those manifest locations; no directory search was widened. The earlier bounded candidate check also found 0/141 campaign storage-key filenames in the known prep-media and `apps/server/media` candidates. No known handoff/checkpoint artifact identifies another paired media snapshot or a proven location for the missing campaign/chat/feedback objects.

**Recovery decision:** the evidence currently supports faithful database recovery plus the 139-file current global-media snapshot only. Full media recovery is blocked pending an owner-authorized historical source artifact with exact object mapping and stored-byte verification. If no such artifact is available, treat the 173 absent objects as unrecovered/lost; do not infer availability from matching source SHA, synthesize transformed objects, or claim the DB dump contains them. A future owner-provided snapshot should be inventoried read-only, mapped to exact DB storage keys, and hash-verified before any isolated restore attempt.

Next bounded gate: locate a known, authorized historical source artifact for the exact missing storage keys and prove its bytes against the expected stored-object hashes (if retained in the DB/export). If that artifact does not exist, report the media loss as unresolved; do not substitute similarly named/source-SHA files. An app-level GET/readability test against the isolated restore was not run, so it remains unproven.
