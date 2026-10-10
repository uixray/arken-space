# Backup source guard checkpoint — 2026-10-10 08:08 MSK

- Revision: based on 94a8511; backup pool remains uncommitted pending independent review.
- Decisions: owner permits current release deployment after completed gate, without repeated consent. Old review stand removed on owner request; retained volumes/media/backups.
- Changed files: infra/backup/{SERVICE-SNAPSHOT.md,LOCAL-RECOVERY.md,capture-service-snapshot.sh,test-capture-service-snapshot.sh,copy-snapshot-local.ps1,test-copy-snapshot-local.ps1}; scripts/{restore-rehearsal-core.mjs,restore-service-snapshot.test.mjs}.
- Root repair: access-only Windows ACL handling and exact sole-owner ACL validation; counts SQL resolved/validated before API stop, explicit missing override cannot fall back; cloned-review source ancestors reject symlink/junction aliases.
- Verification: fake Compose/cloned-review capture success/refusal/restart tests passed; missing counts SQL negative regression passed before stop. Fake local Restic copy/receipt ACL passed. Manifest adapter 5 passed, 0 failed, 1 skipped (file symlink creation unavailable), Windows directory junction rejection passed. Backup diff check passed. No real Docker or Restic service invoked by these harnesses.
- Timing: root continuation repairs/tests 08:05–08:08 MSK; overall integration forecast30–45min still open. Do not treat this small source check as completion of restore work.
- Blockers/remaining: independent review of guard repair; actual encrypted capture, independent recovery and rollback proof remain unverified; latest product workers not yet integrated.
- Next: reviewer findings, exact-file backup commit, fresh bounded candidate/runtime recovery gate. Never reuse old5fb package as latest candidate.

- 08:17 MSK integration: compose validates effective API DATABASE_URL host on shared PG network and database against PG configured DB; all dump/count/version/ledger use explicit database. Private config staged before quiesce. Fake mismatch/staging assertions passed (worker gate ~20s). Arbitrary extra receipt SID refusal regression passed before any Restic call. Local Restic0.19.1 executable verified available; archive SHA matches supplied SHA256SUMS. Runtime recovery still pending; source runner wiring assigned separately. Independent review pending before promotion.
