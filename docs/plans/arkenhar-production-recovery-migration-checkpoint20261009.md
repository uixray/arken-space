# Production-derived restore and migration checkpoint — 2026-10-09

## Result and exact candidate

**PASS, limited to the local production-derived database migration and fresh replay gates below.** This is not application/runtime, browser, deployment, legacy-link, or full operational-recovery acceptance.

The migration was run against candidate source commit `4dca5a19d3b6b7ca17464825b893dfc276185462`, tree `c4a3112e3a821d92a4304882a371641dfe792ff1`, using server image `sha256:be8464f516e027f24424f4f7c0a16fdfe7c7278eea714c64395ee221365257ff` (linux/amd64). The earlier frozen candidate `2c35435643e09a4dbbcb041889dbc727070536f0` was **not** the source used for that image/migration. An internal Git-blob comparison found all **54** `.sql` files under `packages/db` identical between the two commits (54 in each; zero changed/added/removed). This supports equivalence of the migration SQL set only; it does not claim the whole application source is identical. The private migration receipt records the source/tree/image identity.

Source is the owner/root-supplied Restic snapshot `0b1b0140` (captured `2026-10-06T10:03:48.737168028Z`) restored to the private local tree `D:\AI\personal\experiments\arken-space\.data\recovery\restored-20261006`. Restore preflight verified the paired dump checksum, media checksums, and 55 aggregate-count labels. No dump payload or personal database rows were opened for this checkpoint.

## Migration and fresh replay evidence

- Baseline B custom export: **2,281,878 bytes**. Its private SHA-256 is retained in the private receipt/logs, not reproduced here.
- B restored to a fresh PostgreSQL 17 volume: baseline counts matched **55/55**. Baseline Drizzle ledger matched immutable candidate SQL blobs **45/45** (IDs, timestamps, hashes).
- Candidate migration-only CLI (`/app/packages/db/src/migrate.ts`) ran twice successfully; the second run was the idempotence check. No application, index/bootstrap, `ensureSeed`, signup, campaign creation, mail runtime, or external provider was started.
- After migration: **65/65** tables covered; all 55 existing table counts unchanged; 10 new tables empty. Candidate Drizzle ledger matched immutable Git blobs **54/54** (IDs, timestamps, hashes).
- Constraint aggregate: **140 foreign keys + 65 CHECK constraints**, none unvalidated.
- Migrated M custom export: **2,318,395 bytes**. Its private SHA-256 is retained in the private receipt/logs, not reproduced here.
- M export restored into a third fresh PostgreSQL 17 database: **65/65** table counts and **54/54** migration ledger entries matched M/candidate. Constraint aggregates matched. This is the fresh replay gate, not an old-binary rollback test.

## Preserved-data checks

- Source tree contained 155 files / 90,959,325 bytes. Original source files were re-hashed after the work: **0/155 changed**.
- B→M and M→replay ephemeral-key HMAC comparisons matched for 11 bounded data sets: GM credential, player grant, legacy invite, game session, membership, character owner/portrait reference, character-controller relation, asset storage references, feedback attachment, chat-upload reference, and sticker storage reference. HMAC keys were ephemeral, not persisted, and are not included here.
- Migrated counts: 1 GM credential, 6 player grants, 0 legacy invites, 115 game sessions, 7 memberships, 8 characters, 6 controllers, 147 assets, 1 feedback attachment, 3 chat uploads, 0 sticker-media rows. GM/grant revision aggregates and revoked-grant count were preserved (all zero in this snapshot).
- `memberships.user_id` non-null count is 0. All 115 historical sessions retain `auth_source=NULL` and no account/link provenance. Rows are preserved, but these sessions are not automatically authenticated in account mode.
- The 151 media files (88,665,896 bytes) matched all 151 database storage references. Missing, unsafe, duplicate, unreferenced, size-mismatched, or stored-hash-mismatched files: **0**. Fresh replay independently matched all 151 references and digests.

## Access hold and boundaries

- The restored data contains credential/grant hashes, not recoverable bearer links. No prior raw GM/PLAYER link was found in the specifically authorized local runtime/config candidates. The local root `.env` GM token did **not** match the preserved GM credential hash; it must not be substituted or treated as a valid old link. Player bearer URLs cannot be derived from stored hashes.
- Therefore legacy GM/PLAYER runtime re-entry remains **on hold** pending owner-provided valid links through a private local input path. The historical 115 `auth_source=NULL` sessions will not continue automatically; valid campaign-scoped links may permit re-entry without claiming account ownership, subject to the separate approved runtime gate.
- No app or old binary was launched; no owner stand, remote endpoint, production provider, SMTP, or deployment was touched. This gate does not prove browser/TLS behavior, full runtime preservation, or operational rollback to the old binary.
- Private DB containers/volumes and logs were retained intentionally. Do not broad-clean them. Exact resource IDs and private export/checksum material remain at `D:\AI\personal\experiments\arken-space\.data\qa-prep\production-recovery-20261006-migration-20261009-r1\private-resources.json` and adjacent private receipt files; do not copy secrets, raw logs, dump contents, bearer tokens, or private hashes into tracked documentation.

## Next action

Root reviews this scoped migration/replay receipt. Do not start the legacy runtime gate until valid owner-provided link material is available and the separate runtime plan is approved. No product source changes are part of this checkpoint.
