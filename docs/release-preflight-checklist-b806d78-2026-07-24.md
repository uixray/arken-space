# RC production preflight checklist - feature base `b806d78` - 2026-07-24

Use with [`release-candidate-b806d78-2026-07-24.md`](./release-candidate-b806d78-2026-07-24.md). This checklist does not claim anything about production until an operator records the evidence.

## Identity and rollback

- [ ] `RELEASE_SHA` is the final clean 40-character commit containing feature base `b806d78` plus UIX-271 release-control changes; checkout is exactly that SHA and clean.
- [ ] `PREVIOUS_SHA` is a recorded, validated live 40-character SHA.
- [ ] Before-change `/healthz`, Compose status, free disk and `postgres`/`server`/`web` image digests (or immutable IDs) are recorded.
- [ ] Migration ledger is expected to cover `0000..0021`; application schema API is `2`.

## Backup and recovery

- [ ] `restic check` passes with root-owned credentials.
- [ ] Fresh backup completed; exact `VERIFIED_BACKUP_SNAPSHOT_ID` is recorded and is not `latest`.
- [ ] Isolated restore rehearsal passed for that snapshot and candidate SHA; `test-results/restore/runner.json` is retained.
- [ ] Restore evidence confirms checksums, a valid pre-migration ledger prefix, counts, media, cleanup, the exact post-migration ledger `0000..0021`, health and schema API `2`.

## Deploy and readiness

- [ ] `EXPECTED_BUILD_REVISION`, `RESTORE_REHEARSAL_REVISION` and `EXPECTED_SCHEMA_VERSION=2` are exported.
- [ ] `build-and-start.sh` completed successfully.
- [ ] Bounded readiness polling confirms healthy services plus authoritative `/healthz` at candidate SHA and schema API `2`.
- [ ] After-change image digests/IDs, `/healthz`, diagnostics and migration evidence are recorded.

## Human gate and decision

- [ ] Auth, player authorization, realtime, uploads, restart persistence and core gameplay/token flows pass.
- [ ] Named GM + 6 rehearsal (30�45 min; Chrome, Firefox, Edge) passes.
- [ ] Rollback plan is actionable with `PREVIOUS_SHA`, exact snapshot and image evidence.
- [ ] Named release owner records explicit **Production GO** with timestamp and all evidence references.

**No unchecked item may be waived by a PR merge or a historical report. No Production GO means no deployment.**
