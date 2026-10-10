# ArkenHar import rollback — Gate0 preparation, 2026-10-09

## Status

**Gate0 target-name absence: PASS at a single read-only observation. Gate1 DB/media baseline: PASS on F only; Gate2: NOT RUN.** Both unique F/R names were absent in the root-authorized elevated read-only preflight; this was not a reservation or concurrency guarantee. Root’s Gate1 run created/restored only F and copied its 139-file media set/B0; current QA and paired source remained fingerprint-identical. No API/listener/HTTP/auth/import/migration/seed ran. No production or remote action occurred.

This preparation follows `docs/plans/arkenhar-import-rollback-plan20261009.md`. Prior recovered global139 evidence remains partial media recovery only; none of the 173 historically missing objects were reconstructed or deleted.

## Gate0 targets and protected state

Unique nonce: `211bd455cd`.

- Fault target F (proposed): `arken_qa_importfail_20261009_211bd455cd`.
- Recovery target R (proposed for later rollback gate): `arken_qa_importback_20261009_211bd455cd`.
- Actual OIDs remain unset until separately approved CREATE; no guessed OID is used.
- Protected: current `arken_qa` / OID `16384`; OIDs `24647`, `26493`; paired restore `arken_qa_pair_20261009_b10d6e69`; current QA/live media and paired 139-file source media.

### Absence read evidence

Root supplied the exact field-only Docker credential mechanism and approved one stage-instrumented same-client preflight. Two earlier sandbox attempts are preserved and were not authoritative: first sanitized `UNCLASSIFIED`; second failed at `docker-field-inspect` before DB connection. Root then ran the same targeted helper under the approved elevated context. Receipt:

- `.data/qa-prep/import-rollback-20261009-211bd455cd/readonly-absence-root-receipt.json`
- SHA-256 `00A66845C6706171D68123DCF1C1C329B6F64E5648F76467183930079AFB81BA`
- Exact control identity `arken_qa`, role `arken_qa`, PostgreSQL server port 5432, OID 16384 matched.
- Both proposed F/R names absent; protected OIDs 16384, 24647, 26493 observed.
- 0 database writes, no HTTP/auth/listener, no credential material persisted.

### Gate1 attempt 1 (closed before credential access)

Root invoked the approved adapter once, but it stopped at `argument-gate` with `FROZEN_PLAN_OR_PREFLIGHT_CHANGED` because lowercase computed SHA-256 values were compared case-sensitively to uppercase constants. This was a local validation defect, not a database/backup/restore failure. The immutable failure receipt is `.data/qa-prep/import-rollback-20261009-211bd455cd/gate1-local-execution.receipt.json`, SHA-256 `3A61E866AFDC1FA38E67124F615D9D56AADA698FED735CEA0855D0FA2B5E577C`. It failed before Docker credential inspection or database creation; F and B0 were not created. The receipt is retained unchanged. The adapter now compares canonical lowercase hashes and uses a separate attempt-2 receipt path; the next execution, if root authorizes it, still starts with all pinned file checks.

The preflight uses only whitelisted `POSTGRES_USER`/`POSTGRES_PASSWORD` fields in memory and the built `@arken/db` client to read `pg_database`; the values/DSN/raw errors were not recorded. An observation does not reserve names; Gate1 runner rechecked immediately before CREATE.

### Gate1 attempt 2 — root-run DB/media baseline PASS

Root ran the corrected adapter under explicit Gate1 authorization. Receipt `.data/qa-prep/import-rollback-20261009-211bd455cd/gate1-local-execution-attempt2.receipt.json`, SHA-256 `52DA86CB74AD3B1D70CFF53C6C554348125A1169181A2CF346CF9D4CE0B546E0`.

- F `arken_qa_importfail_20261009_211bd455cd`, actual OID `28340`; source archive restore exit 0; source TOC 523.
- 312 storage references, 139 verified files / 10,518,668 bytes; missing remain 173 (campaign 141, chat 31, feedback 1). No original 24+115 PNG acceptance.
- Fresh B0 archive SHA-256 `73c8163a093042892f3746aa8bdf53d32fceee696c58cebcb6056b937f648b4f`, 366,374 bytes, TOC 523. B0 media copy independently has 139 files / 10,518,668 bytes. Full pre/post B0 fingerprints equal.
- Restored F has 396 sessions; paired source OID 26493 has 398. All non-session rows/schema/journal/sequences/storage/media compare equal; the documented two-session difference is excluded only from source logical comparison. Protected OIDs 16384/24647/26493 are equal before/after.
- No R was created; no auth/API/import/seed/migration ran. Attempt-1 receipt remains immutable; no retry/cleanup is implied.

## Frozen private preparation files

Ignored directory: `.data/qa-prep/import-rollback-20261009-211bd455cd/`.

- `intent.json` — unique create/item1/item2 action IDs and explicit sequence: commit item1 → withhold client acknowledgement → independently prove committed → identical replay → changed-intent 409 → reject item2 via source-hash mismatch → compare/restore exact B0 into new R. Item source hashes/metadata remain null until root-approved transformed source bytes are copied and hashed. `runtimeAuthorized:false`, `runtimeExecution:NONE`.
- `rollback-prep.mjs` + `rollback-prep.test.mjs` — pure nonce, OID/name, proof-presence, fault-order, and no-runtime guards.
- `gate1-plan.json` — exact Gate1 scope and ordered actions; current SHA-256 `0B45674A7FF1ABDEC4AB057AE2F2030B660E8D1D31EA17E9228B175310AB750F`.
- `gate1-runner.mjs` + `gate1-runner.test.mjs` — retained earlier orchestration prototype with fake adapters only; its 5 passing tests are not Gate1 execution evidence and it is superseded for implementation review by the local adapter below.
- `gate1-local-adapters.mjs` + `gate1-local-adapters.test.mjs` — executable local DB/media adapter, prepared but NOT executed. Root reviewed the first draft and identified six defects; the current offline correction addresses them: plan/preflight are read after regular-file validation; pinned receipt distinguishes source DB `arken_qa` from paired restore DB/OID; protected fingerprints work without a media manifest; schema fingerprint canonicalizes only known dump-version/time banners and randomized `\\restrict` guards; sequence fingerprint adds `last_value` and `is_called`; media verification rejects extra/missing/non-regular/reparse files. Default CLI is a no-op. The only execution path requires exact `--root-approved-gate1`, nonce, frozen plan SHA and Gate0 receipt SHA. It whitelists Docker credential fields in memory; uses built `@arken/db` identity/OID checks before target operations; pipes the pinned archive into `pg_restore --exit-on-error`; hashes rows, canonical schema, journal, full sequence state, sessions and storage references; copies only pinned 139-file media to new exclusive output trees; creates fresh exclusive `-Fc` B0 plus verified `--list`; and records a sanitized immutable receipt. It creates F only; it never creates R, performs importer requests, starts HTTP/auth/listener, migrates, seeds, cleans up, or mutates current QA/paired source. Protected OID 24647 is fingerprinted without assuming Arken session/journal tables. Runtime still requires root review and separate GO.
- `readonly-absence.mjs`/receipt and `readonly-absence-stage1.mjs`/receipt — preserved failed sandbox attempts.
- `readonly-absence-root-receipt.json` — root-run elevated success above.

`gate1-plan.json` binds the import route review to source revision `52013d43e6f2fca1bb268c38608afde9cd76424a`, `apps/server/src/global-sticker-catalog.ts` blob `afa0c0d9ac2a0c8aceccc6cfe1398c4f16da1d11` (same blob at current HEAD when checked). It references the known source archive SHA `b28e1975c63bd87a2fa5c0e881650bfac6dafed669f46898733e1fe8e0926dab`, 523 TOC entries, and the exact paired 139-file source snapshot `20261009-b10d6e697c264c3f83ebd577a058300d`. Original PNGs were not present in the earlier audit; these stored-WebP inputs cannot pass original 24+115 PNG import acceptance.

## Gate1 procedure (executed by root; result above)

1. Repeat read-only identity and F/R absence query immediately before any creation. Confirm protected current-QA and paired target remain untouched.
2. Verify known source archive hash and `pg_restore --list` exit 0 / 523 TOC entries. Verify exact approved 139-file source manifest without broad search.
3. Create only F after explicit root Gate1 GO; capture its actual OID. Restore into empty F with `pg_restore --exit-on-error` and retain direct command exit status (no masked pipeline).
4. Copy source's approved 139 stored-WebP files into unique isolated F-media; compare every key, byte length and SHA-256. No live/snapshot directory is served or modified.
5. Capture all public base-table rows as deterministic per-table/full-row hashes; schema, constraints/indexes, migration journal, sequence/identity state, sessions separately, storage-reference and media fingerprints. Expected storage references 312, present 139, missing 173 categorized 141/31/1. Counts alone are insufficient; no claim of historical media recovery.
6. With F quiesced and no auth/session writes, take an exclusive fresh `pg_dump -Fc` pre-import B0. Record direct exit, exact bytes/SHA; run `pg_restore --list` exit 0. Snapshot F-media to a new B0-media tree with complete per-file manifest and matching hashes.
7. Repeat full fingerprints after backup; require exact equality. Keep F, B0 and media evidence. Do not continue to importer/HTTP/auth in Gate1; stop for root review and separate Gate2 GO.

This DB/media-only Gate1 scope intentionally takes B0 before any test authentication so all restored rows, including sessions, are captured without new session traffic. It is a preparation scope for this disposable test, not the production recovery plan. Any adapter implementing process/Docker/SQL steps must be reviewed before root executes the runner; current abstractions alone are not runtime proof.

## Verification and remaining gates

- Offline pure guard tests: `node --test .data/qa-prep/import-rollback-20261009-211bd455cd/rollback-prep.test.mjs` — previously 5/5 pass.
- Legacy Gate1 runner tests: `node --test .data/qa-prep/import-rollback-20261009-211bd455cd/gate1-runner.test.mjs` — previously 5/5 pass with fake adapters only; not runtime evidence.
- Local adapter offline checks: `node --check` passed; adapter tests 8/8 and Gate0 tests 5/5 passed; default invocation exited 0 in `prepared_only` with no writes/restore/dump/media copies. Root ran the actual Gate1 under separate authorization and captured the immutable PASS receipt documented above. This agent did not execute the runtime adapter.
- `gate1-local-adapters.mjs` SHA-256 `E30518919EAE475A9C87558D4A8261A45503E52FB8D40D1C8CB9359D660DB856`; test SHA-256 `AAF3071501607A7EA0C322F4AD61B90162524BD2E5E30565E97127DA329C1F32`. Plan SHA-256 `0B45674A7FF1ABDEC4AB057AE2F2030B660E8D1D31EA17E9228B175310AB750F`; Gate0 receipt SHA-256 `00A66845C6706171D68123DCF1C1C329B6F64E5648F76467183930079AFB81BA`. Attempt-1 failure and attempt-2 success receipts remain separate and immutable. No product edits, no Linear update, no commit.

Remaining: Gate0 absence was point-in-time only; no concurrency reservation exists. Gate1 F/B0/media baseline is PASS as scoped above. Gate2 importer failure/replay/conflict/item2 rejection has NOT RUN; Gate3 restore to new R and post-rollback readability have NOT RUN. The 173 missing objects and original PNG import acceptance remain unresolved. Gate2 requires its own later root review/GO and safe no-writer window. No cleanup or promotion is implied by this checkpoint.

