# ArkenHar import rollback — Gate3 recovery preparation, 2026-10-09

## Current state

**Gate1 PASS; Gate2 PASS; Gate3 R-only restore PASS.** R was created, restored from B0, and its B0 media copied under the approved bounded gate. No API/auth/listener/operator or readability claim is included. This checkpoint owns only this new doc and `gate3-*` ignored files under `.data/qa-prep/import-rollback-20261009-211bd455cd/`; it does not edit Gate1/Gate2 helpers or product source.

## Frozen Gate1 target and B0

- Fault database F: `arken_qa_importfail_20261009_211bd455cd`, actual OID `28340`; retain it as failure evidence. Gate2 is not complete yet.
- Recovery database R: `arken_qa_importback_20261009_211bd455cd`; Gate1 recorded no R creation. Recheck R absence immediately before the future CREATE; Gate0 absence is not a reservation.
- Gate1 PASS receipt: `.data/qa-prep/import-rollback-20261009-211bd455cd/gate1-local-execution-attempt2.receipt.json`, SHA-256 `52DA86CB74AD3B1D70CFF53C6C554348125A1169181A2CF346CF9D4CE0B546E0`.
- B0 archive: `gate1-b0-custom.pgcustom`, SHA-256 `73C8163A093042892F3746AA8BDF53D32FCEEE696C58CEBCB6056B937F648B4F`, 366,374 bytes, 523 TOC entries. Gate1's isolated B0 media is `gate1-b0-media`.
- Expected R pre-auth logical state from Gate1: domain rows `9ca2789bd8f1fa81d25ab3e4a0b6a3b2bd373f3a7548dcab3b736c12ddb576c4`; schema `6b0f305fd3262f94ce97c14d7c9eedce53f4f931eeface1d1c74a35a6e803243`; journal `b296d311af238551b96541047bd2346bb31a5eb68323f4d4954aa8021bfabd39`; sequences including `is_called` `d7601c150a6011303b12b2873b63ef4bdc51dbaa58c6021aa4eb57d537423dff`; sessions rows `2a0e877098d9d7baf4f88dc446f4f90effec03123363f049b2e33d04a4b07e92`, count 396; storage refs `de28f520f0584c08c18c2faf38b42bdf6be7ef4dbd3934f41ae2ab364b551386`, count 312; media 139 / 10,518,668 bytes, manifest SHA `17a8614e7e5039b0c0044968371ae7d9cc170462362b653d2dc1fd61671eb256`. Missing references remain campaign 141, chat 31, feedback 1.
- The helper derives the B0-media expected manifest only from the pinned paired-recovery receipt/manifest and verifies B0-media bytes against it before copy. It will copy from B0-media to a new exclusive Gate3 R-media directory; it never writes to F media, paired media or source snapshot.
- Protected currentQA OID 16384, OID 24647 and paired-restore OID 26493 are identity/fingerprint guarded. No operation targets them.

## Gate3 pre-execution evidence gates (now satisfied)

1. Gate2 API receipt is PASS at `.data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-final.receipt.json`, SHA-256 `2A58482D94B64B1E9FDD9686E4F27FDE9D6983D74B88CF4E376A9AB3968B7821`. It binds F/OID/B0 and predicates for persisted item1, stable replay IDs, one pack/sticker, conflict 409, rejected item2 with `SOURCE_SHA256_MISMATCH`, item2 absent, and DRAFT/no-publish. It makes no listener-stop claim.
2. The separately generated Gate2 DB/media delta is PASS at `.data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-delta-final-attempt2.receipt.json`, SHA-256 `98259D1EB2577DE8C9425338B82F8EFC3A92AF360C8907AC0F3B217AA2172B34`; immutable before receipt SHA-256 `8055F296D733D437043BFF60831015FF3D356746B7E476EC2A8BCCE1E92F24F6`. The final binds the exact before-receipt bytes, Gate1/Gate2/phase1 receipt hashes, F/OID/B0, aggregate before/after fingerprints and required one-pack/item/stored-media/file/reference, no-duplicate/no-orphan/item2-absent, unchanged-baseline and protected predicates. Actual receipts were validated in memory by the Gate3 exported consumer; only safe PASS booleans were emitted. The before receipt's `media.manifestSha256` is a distinct stored-inventory aggregate from Gate1's source-manifest SHA; Gate3 requires a valid bound aggregate, baseline file count/bytes, and separately verifies B0 media against its pinned manifest. It does not equate those hashes.
3. Root listener-stop proof is present at `gate3-listener-stop-root-receipt.json`, SHA-256 `AA8D4C8598BE91FD518B6FEBC1EDB535B9AE8107D5DF88B208D5EB47B8F07202`; it binds phase, port 14186, F/OID, Gate2 receipt SHA, owned PID/session handle, stopped/free booleans and timestamp. The consumer validates the proof and performs a fresh TCP probe immediately before CREATE; only `ECONNREFUSED` passes. This proof is prerequisite evidence, not authorization to execute.
4. With all frozen receipts and a new explicit root GO, recheck protected identities and exact R absence, B0 SHA/length/TOC, B0-media hashes and no pre-existing Gate3 outputs. Create only R, capture fresh actual OID, restore B0 with `pg_restore --exit-on-error`, copy B0-media to exclusive R-media, then compare full pre-auth rows/schema/journal/sequence state/sessions/storage/media against Gate1. Explicitly verify Gate2 pack and item1 IDs are absent in R. Compare F and protected DB before/after fingerprints unchanged.
5. Preserve F/R/B0/media evidence. Never auto-clean, retry or recreate R. Post-rollback API/catalog/media readability is a separate later gate requiring its own review/GO; this helper does no HTTP/auth/listen. Full recovery of the 173 missing objects and original PNG import acceptance remain NOT PASSED.

## Prepared helper and offline checks

- `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-restore.mjs` SHA-256 `2659D25C5A44015F38DDE9D6000F6A825E812F769BAB447322E88CDC2BFDD61F`. It is default-no-op unless the explicit root flag and exact receipt/hash arguments are supplied. It reads only whitelisted Docker PostgreSQL fields in memory; secret, DSN, fixture rows and media contents are not emitted. Failure leaves any created R/media intact and writes a sanitized immutable outcome; no automatic cleanup. Consumer was corrected against the actual immutable Gate2 before/final and root listener receipts.
- `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-restore.test.mjs` SHA-256 `C80C837D9E6EB03022F520E28FA124729505588DFA1E09E0D45268441007E4F7`, including actual-receipt validation that outputs no payload.
- `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-plan.json` SHA-256 `6D415CA6EB108019550057939F5B865B905643EE1E203141DB147E476224020F`, pinned to the attempt-2 delta receipt path.
- Frozen Gate1 adapter source SHA rechecked as `E30518919EAE475A9C87558D4A8261A45503E52FB8D40D1C8CB9359D660DB856`. The Gate3 helper carries its reviewed identity/row/schema/sequence/media fingerprint approach into an R-only execution; this does not replace the future actual R fingerprint comparison.
- `node --check gate3-restore.mjs` passed. Latest focused test run: 7/7 passed (approval parsing, Gate2 receipt binding, Gate2 DB/media delta binding and +1 asset invariants, listener proof fields, actual immutable Gate2 receipt validation, full-baseline equality including sessions, and default no-op). Tests are offline; no R restore or Gate3 runtime was exercised.
- The default invocation had printed `prepared_only` during preparation, with zero DB writes/restores/media copies and no listener. After the separate root-approved Gate3 execution, R now exists as documented below. No private credentials were emitted.

## Actual Gate3 restore result

- Root executed the frozen helper SHA above under the explicit Gate3 gate. Immutable result: `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-restore-receipt.json`, SHA-256 `832890D179D94BA6622297ECDC024A949BE273F916F8EE921BDE77C60BE1561E`; `phase=gate3-r-only-restore`, `status=PASS`, restore exit 0.
- Recovery DB R was created at OID `30186`; fault DB F remained at OID `28340`. The receipt confirms B0 SHA `73c8163a…648b4f`, Gate1/Gate2 receipt binding, R matches Gate1 fingerprints (58 domain tables / 879 rows, 396 sessions, 312 storage references, 139 media files / 10,518,668 bytes), and Gate2 item IDs are absent in R. F and protected DBs remained unchanged during this gate.
- The receipt explicitly records `apiAuthMigrationSeed=false`, `listenerStarted=false`, `operator=false`, `full173ObjectRecovery=false`, `automaticCleanup=false`. The 141 campaign, 31 chat, and 1 feedback missing references therefore remain; this does not establish full 173-object recovery or original PNG/import acceptance.
- **No R readability/API/browser work was performed by this gate.** Root assigned a separate R-readability preparation-only pool; require that pool's own frozen proof and explicit authorization before any readability action. Do not expose credentials or modify R here.

## Blockers and next action

- Gate3 restore is complete. The remaining next gate is separately owned R-readability preparation/review; it is not included in this restore receipt and must not be inferred from the successful restore.
- Preserve R, F, B0, and media evidence; no automatic cleanup or Gate2 replay. Additional API/auth/listener changes require a separately scoped explicit approval.
- This checkpoint author made no additional DB/runtime changes after root execution. No import, auth, API, migration, seed, remote action, Linear update or commit was performed here.

## Compact checkpoint

- Decision: Gate3 R-only restore is PASS; retain its evidence. R readability remains a separate gate and is not implied.
- Revision: current checkout `e86302cc16ec56c799aadb1f265cd231aa8241c5`; product source remains the pinned Gate1 source.
- Changed files: this new plan; ignored `gate3-restore.mjs`, `gate3-restore.test.mjs`, `gate3-plan.json` only.
- Verification: helper syntax and 7/7 offline tests pass; actual Gate2/delta/listener receipts passed consumer validation; root's frozen Gate3 execution returned PASS and exact R baseline equality.
- Blocker: R readability is a separate gate; no API/auth/operator/full-recovery claim.
- Next: R-readability owner prepares its separate bounded gate; retain R and all restore artifacts unchanged.
