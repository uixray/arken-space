# New-server package checkpoint — 2026-10-09

## Current status

Software-only configuration skeleton exists; it is **not yet a complete release package or ready-to-transfer artifact**. Candidate images are now built and accepted by root. Encrypted download completed; owner restored the selected October6 snapshot locally and read-only checksum preflight passed. The old building/download/password-blocker text is superseded. Actual production-derived DB restore/migration and exact-image SMTP runtime acceptance remain pending; neither may be inferred from these receipts.

## Accepted software identity

Source receipt: `.data/qa-prep/release-gate-4dca5a1-20261009/image-build-manifest.json`.

- Candidate commit `4dca5a19d3b6b7ca17464825b893dfc276185462`, tree `c4a3112e3a821d92a4304882a371641dfe792ff1`.
- Server image `sha256:be8464f516e027f24424f4f7c0a16fdfe7c7278eea714c64395ee221365257ff`; `server-image.tar`,191649280 bytes; SHA256 `15274BFE281567B31374BD9EBF1664070A91C9526615CC5C61A18880B1969E24`.
- Web image `sha256:2b779e7febe21dd3f4b065872fa64f3676064c317648c0889d7146ad9804b71f`; `web-image.tar`,23671296 bytes; SHA256 `60F84E1BE0358BAB8869ECEA0F06A633D09A986EF71C2FFB52DAE700BC8E3E98`.
- Both build exits0. Final exact-blob contexts194 server/316 web files; earlier CRLF-transformed Git-archive contexts were rejected, not used. Frozen-lock dependency resolution/build is recorded; no offline-build claim. Build pool started no runtime containers and performed no deployment.

These are values read from the accepted manifest, not newly rehashed or inspected by this documentation update. Earlier2c35435 image/recovery evidence remains historical and cannot replace this candidate's runtime/data gates.

## Private data evidence

- Root reports encrypted download completed:701 files,272271426 bytes,174 snapshots. This is repository/download inventory, not174 verified recoveries.
- Owner-selected/restored snapshot `0b1b0140`, reported capture `2026-10-06T10:03:48.737168028Z`, retained at main-root `D:\AI\personal\experiments\arken-space\.data\recovery\restored-20261006`. No password or private payload was read for this update; no password search is needed or authorized.
- Safe receipt `.data/qa-prep/production-recovery-20261006-preflight/checkpoint.md`:155 files +6 directories,90959325 bytes. Dump2277455 bytes matches checksum `65ad98734028eac4774ade133fad98d209396b16e382a92008df28979f75c2eb`. All151 media files match sidecar hashes;88665896 bytes; aggregate manifest digest `7a8fcfa52030ef672cc1a72521346bd428b8c616378c26a04824b9db941fcaf0`. Counts manifest has55 distinct labels.
- Preflight proves local presence/checksum consistency, not DB/schema restore, complete count crosswalk, DB-to-media semantic references or independent source-capture provenance. Describe this as the selected recoverable October6 snapshot, not proof no newer usable production snapshot exists.
- Isolated migration worker encountered a missing database role and is resolving a minimal **NOLOGIN** prerequisite inside the disposable DB only. This is active work, not a completed restore/migration PASS; no host role, owner credential or production change is implied. Preserve original restored tuple read-only.

## Staging skeleton and boundaries

Staging `.data/qa-prep/new-server-package-20261011/` contains README, placeholder compose template, runtime.env.example and manifest.pending.json. This update did **not** modify or populate those files, copy image archives/private data, inspect credentials or execute Docker/SQL. Skeleton pending metadata may still need the accepted identities above applied by its owner.

Keep software-only artifact and encrypted/private DB/media/config/key recovery bundle separate. Never add private data, real env or keys to software archive/Git. Old links retain backed credentials/revisions/roles/revocation semantics; no silent rotation or legacy-to-account ownership conversion. Open signup policy is approved but operational mail activation remains gated; campaign creation entitlement remains separate. Do not guess host/domain/TLS/SMTP/backup settings.

## Pending gates and finite next assembly

1. Packaging owner can now populate skeleton image/archive identity from the accepted manifest, copy only allowlisted software archives/docs/templates and verify copied sizes/hashes plus explicit archive-member list. Do not rebuild images or rerun old auth/image matrices.
2. Consume isolated DB worker's final receipt after minimal role prerequisite: baseline schema/count manifest crosswalk, exact4dca5a1 migration-only CLI, idempotency, aggregate FK/media-reference checks and original-unchanged proof. Keep baseline/original snapshot distinct from migrated export. Until receipt, DATA_RESTORE_VERIFIED=false.
3. Consume active **exact-image SMTP runtime gate** receipt, including readiness, actual index/registerRoutes lifecycle and healthy-DB shutdown. Active is not PASS. Existing adapter/unit/local-route lifecycle tests are not substitutes; DB-stall8s forced exit remains a limitation, not clean-shutdown acceptance.
4. Assemble private transfer bundle only from verified original/baseline/migrated-export identities and paired media/config requirements; require replay evidence for migrated export and a clearly scoped pre-upgrade rollback tuple. Do not publish payloads or report latest-data completion from checksum preflight alone.
5. Record unresolved target prerequisites explicitly: architecture/engine/disk/volumes, domain/TLS/access, SMTP/provider/sender configuration and permitted external test, private secret/key handoff, creation entitlement if enabled, backup destination/retention/operations. No defaults promoted to owner decisions.
6. Final manifest links exact software identities + opaque private bundle/snapshot IDs + actual restore/runtime receipts + runbook/config version. Only mark ready for authorized transfer when required gates/prerequisites are resolved. Upload/deploy remains separate authorization.

## Checkpoint

Changed only this document, no commit. Verification: read accepted image manifest and safe production-recovery preflight; download completion and worker activity are root-reported status. No private payload/credential read, original mutation, tests, server operation, upload or deployment. Next action: package owner updates software skeleton while migration and exact-image SMTP owners finish their current finite gates.

## Root assembly checkpoint — 2026-10-09

- Revision: candidate `4dca5a19d3b6b7ca17464825b893dfc276185462`; documentation HEAD `ce796a6`.
- Changed private staging: copied only server/web image archives and accepted build manifest; updated pending manifest with image/tree/archive identities and completed download/decryption facts. Readiness stays false for software runtime acceptance, semantic data restore and transfer.
- Corrected template SMTP names to `ACCOUNT_MAIL_SMTP_*`, including `USERNAME`, and added required production `GM_ACCESS_TOKEN` placeholder. No real secrets were read or written.
- Verification: both source and staged image archives SHA256 match accepted manifest; all runtime example variable names exist in current server env schema; positive seven-member list records sizes/SHA256 in private `software-members.json`.
- Blockers: exact-image SMTP runtime pool and production-derived migration/replay remain active. PostgreSQL image archive, compose structural validation, operator runbook/attribution, target configuration and private operational provisioning are still pending.
- Next: consume connected gate receipts, then complete software-only archive and config validation. No remote action, upload, push, merge or deployment.

### Assembly review follow-up
- PostgreSQL cached image exported locally (exit 0), with separate archive size/SHA256 receipt. No container/network mutation.
- Disabled-mail template fields now empty: placeholder keyring/SMTP values could otherwise fail validation even when runtime disabled.
- Astra found remaining concrete configuration gaps: no API/WebSocket TLS gateway, internal network blocks SMTP egress, hardcoded Compose false values need explicit activation override, and operator instructions must restore verified named volumes before normal server startup. These are open package tasks, not successful deploy evidence.
- Recovery failure reclassified by worker: isolated harness supplied the wrong connection username; no dump role defect established. Worker corrects only harness connection against a new empty DB; no roles/dump rewritten.

## Connected recovery/runtime stage — 2026-10-09

- Candidate product unchanged: 4dca5a1; documentation HEAD 28a8ce3.
- Production-derived worker completed baseline restore, migration twice and fresh migrated export replay. Original 155 files unchanged. Baseline 55/55 count entries and ledger 45/45 match; migrated ledger 54/54 and all 55 existing counts unchanged, 10 new tables empty; fresh replay 65/65 counts match. Validated 140 FK and 65 CHECK constraints. All 151 media references verified, zero missing/unsafe/size/hash mismatches. This is database/file integrity acceptance, not all-user gameplay.
- Exact-image SMTP A/B/C/D2 gate complete and scoped checkpoint committed 28a8ce3: synthetic signup/SMTP/verification/replay/login and graceful held-DATA shutdown; no provider inbox/browser TLS or socket-close-before-complete claim.
- Package config static/parser gate passed; Astra found sensitive upstream rewrite404 despite syntax PASS. Root repaired explicit /index.html? upstream target and switched gateway to packaged web image. Focused actual request/privacy validation and member rehash active; old 13-member hash is superseded, not final.
- Old link hash records preserved, but hashes alone cannot supply raw bearer URLs. Bounded known-project credential lookup/private hash-match allowed; no password store, desktop or history search. Runtime re-entry pending genuine backed link input; no credential replacement to manufacture PASS.
- 2GB purchase gate: bounded Astra plan ready; Luna prepares synthetic 7-client workload. Benchmark starts only after accepted gateway receipt; no hardware/VPS guarantee, no multiple-server purchases.
- Next: accept worker recovery checkpoint and finite gateway proof, execute constrained capacity gate, then aggregate immutable package receipts. Real host/domain/TLS/SMTP and transfer permission remain open.
