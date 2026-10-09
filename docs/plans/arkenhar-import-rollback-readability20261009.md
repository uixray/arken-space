# ArkenHar — R-only restored readability prep (2026-10-09)

## Stage checkpoint

**PREPARED, NOT RUN.** This is the isolated R-only post-restore readability gate after root's actual Gate 3 restore. No auth, HTTP, app listener, DB write, migration, seed, import, publish, or cleanup was performed during preparation. A future runtime needs a separate explicit root GO. Preserve F/R and all receipts; do not rerun Gate 2 or use any protected/current QA target.

## Authoritative restore evidence

- R: `arken_qa_importback_20261009_211bd455cd`, actual OID `30186`.
- Root Gate 3 receipt: `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-restore-receipt.json`, SHA-256 `832890d179d94ba6622297ecdc024a949be273f916f8ee921bde77c60be1561e`; status PASS, restore exit 0.
- Source B0: Gate 1 archive SHA-256 `73c8163a093042892f3746aa8bdf53d32fceee696c58cebcb6056b937f648b4f`; Gate 1 receipt SHA-256 `52da86cb74ad3b1d70cff53c6c554348125a1169181a2cf346cf9d4ce0b546e0`.
- Root verified R baseline matches Gate 1: 396 sessions, 312 storage refs, 139 media files / 10,518,668 bytes, 58 domain tables / 879 rows, missing campaign/chat/feedback objects 141/31/1. Gate 2 IDs absent in R; F and protected DBs unchanged. The 173 missing files remain unresolved.
- R-media copy is the exact bounded root `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-r-media`; no media files were changed by this prep.

## Frozen prepared artifacts

Ignored directory: `.data/qa-prep/import-rollback-20261009-211bd455cd/gate3-readability/`.

- `gate3-r-entry.mjs` is a source-composed delta from the accepted F entry: only R DB/OID/media path/receipt bindings and nested package-relative root were changed. It pins source revision `52013d43e6f2fca1bb268c38608afde9cd76424a`, checks Gate 1 and Gate 3 receipt hashes/contracts and R media before env/routes/listen, requires exact `arken_qa_importback_20261009_211bd455cd`/OID `30186`/PostgreSQL port identity, and refuses mismatched target. It reuses the reviewed server composition/plugins/auth/error/realtime routes, has no migration/seed/ensureSeed call, and defaults to `prepared_only` without connecting to DB or listening. The existing exact `local-auth.json` GM fixture is read only after the explicit launch switch and never emitted.
- `gate3-r-http-gate.mjs` is a bounded R-only HTTP driver. It defaults to `prepared_only`; explicit root approval is required before any runtime. Before auth it verifies exact Gate 1/Gate 3 receipt hashes and R identity, full domain fingerprint against Gate 1 (58 tables/879 rows), 312 storage-reference hash, 396 sessions, exact 139 media files against the pinned stored-WebP manifest, and R DB media mapping. It then uses only the existing GM fixture, makes one normal GM login (expected natural session delta +1), reads `/api/stickers` and all 139 content routes, verifies the 24+115 catalog split and unique DB/catalog IDs, status/content/cache headers, byte length/hash against stored manifest, and Sharp decode/dimensions. Anonymous content must return 401. Post-read domain/storage/media fingerprints must equal pre-auth values; session delta is reported separately. It never calls PLAYER auth/invite, import/upload/publish/operator or mutation endpoints. Stored WebP hashes are compared to stored bytes; the DB `global_sticker_media.sha256` source-input hash is intentionally not treated as stored-byte hash.
- Pass receipt is exclusive-create at `gate3-r-readability.receipt.json`; failed attempts use unique safe-code receipts. Values, tokens, URLs, names, row payloads and storage keys are not printed.
- `gate3-r-readability.test.mjs` covers exact F→R receipt binding, entry/gate default no-op module-load paths, and source guards for the narrow target/GM-only/read-only contract.

## Offline verification only

Root's first explicitly approved entry launch exited 1 during startup with `ENOENT`, before credential/DB setup; no listener started. Source diagnosis found the R-derived entry incorrectly looked for the pinned media preflight receipt inside the new R bundle, where it was not present. The entry now reads the exact existing Gate 2 media preflight receipt by fixed path and verifies its already-approved SHA-256; no copy or data change was made. A regression now checks both path selection and actual pinned file availability/hash. This launch failure is retained as a real source-preflight failure; the corrected entry is frozen for root review and has not been launched again.

Commands run:

```text
node --check .data/qa-prep/import-rollback-20261009-211bd455cd/gate3-readability/gate3-r-entry.mjs  -> exit 0
node --check .data/qa-prep/import-rollback-20261009-211bd455cd/gate3-readability/gate3-r-http-gate.mjs -> exit 0
node --test .data/qa-prep/import-rollback-20261009-211bd455cd/gate3-readability/gate3-r-readability.test.mjs -> 4/4 pass
node gate3-r-entry.mjs -> prepared_only, listenerStarted=false, envImported=false, targetDbConnected=false
node gate3-r-http-gate.mjs -> prepared_only, apiCalls=0, authWrites=0, listenerStarted=false
```

No API health check or database connection was made by these commands. This proves the default no-op/module-load path and static/pure contract guards, not the R HTTP readability result. Root should inspect the frozen source/diff and only then decide whether to authorize one run.

Frozen artifact SHA-256: corrected entry `37c438e8ae91e4874e6ee44d31e0ce2df7afe9d32ab1a3c586bcbcb990e7ec8a`; HTTP gate `8920d4d93731710a6cadf509283b7e3f12ff9c08606ec7cd2e703a0fd40d63bb`; offline tests `07b0d627db902445415c2530a3129d2867c9dc52905d9d5589a991d3e898c173`. The storage-reference fingerprint deliberately follows Gate 1's exact `WHERE storage_key IS NOT NULL ORDER BY storage_key` semantics; 312 expected refs/hash remain unchanged. Test 4 checks this predicate and the actual pinned media-receipt path/hash.

## Next action / open limits

Root review the source-composed R entry and helper, then separately GO or decline the R-only readability run. If approved, require listener ownership/stop evidence and immutable receipt. Gate 3 restore PASS is not application readability PASS. Full 173-object recovery, original 24+115 source-PNG acceptance, production rollback, user/browser/device acceptance, and authentication product implementation remain outside this gate.

## Root actual R readability — PASS (2026-10-09)
Root reviewed correctedentry37C438.. +HTTP8920D4.. and independently4/4offlinePASS, then launched exactR30186/loopback14186 PID22776/session80685. Actual HTTP gate exit0; receiptSHA5084ADE20B9D07C8768B75CA23F4C4F8461C2D7D2C237CEDB6AA3EA49186160F. Health/auth200, catalog2/24+115/139uniqueIDs, all139fullpayloads10518668bytes matched storedmanifest hashes/header/Sharprawdecode/dimensions, anon401. Full58domainTables879rows/storage312refs/media139 exact before-after unchanged. One naturalRauthsession396→397 separately recorded, no PLAYERclaim/import/publish/seed/migration.
StoppedONLY owned80685 viaCtrlC terminalwrapper1; HTTPexit0 preserved, elevated14186listener0. F/R/B0/media retained. PriorENOENTlaunch retained, correctedmissingdependency no productsource changes.
Bounded actual failure→new-target exactB0restore→139appreadability mechanism PASS. NOT proof of production image rollback, originalPNGimportacceptance, complete173historicalmediarecovery, browser/native/human/auth/publication readiness.
