# ArkenHar — isolated import fault rehearsal, Gate 2 evidence (2026-10-09)

## Status and boundaries

Gate 2 HTTP/API phases **PASS** on isolated F; its separate read-only media-delta proof is **PENDING CORRECTED ATTEMPT**. The first final delta attempt failed closed due to a helper field-name mismatch, not evidence of an application orphan. Root confirmed the owned F server was stopped and the listener absent. No Gate 3 / R restore / production action has run. Preserve all receipts; do not replay or mutate the F fixture.

This is a bounded local mechanism rehearsal against the Gate 1 disposable F only. It is not recovery of the missing historical 173 media objects, not acceptance of the original 24+115 PNG import set, not a full production rollback proof, and not production readiness. Existing protected DB OIDs 16384, 24647, and 26493 remain out of scope.

## Gate 1 binding

- F: `arken_qa_importfail_20261009_211bd455cd`, OID `28340`.
- B0: `gate1-b0-custom.pgcustom`, SHA-256 `73c8163a093042892f3746aa8bdf53d32fceee696c58cebcb6056b937f648b4f`, 366,374 bytes, TOC 523.
- Gate 1 receipt: `.data/qa-prep/import-rollback-20261009-211bd455cd/gate1-local-execution-attempt2.receipt.json`, SHA-256 `52da86cb74ad3b1d70cff53c6c554348125a1169181a2cf346cf9d4ce0b546e0`.
- Measured baseline: restore exit 0, 312 storage refs, 139 files / 10,518,668 bytes, 173 missing (campaign 141, chat 31, feedback 1). F and B0 media manifests matched; protected OID fingerprints matched before/after. Gate 1 documented 396 F sessions against 398 paired-source sessions; non-session rows/schema/journal/sequences/storage/media matched.
- Do not imply the historical missing-media gap is solved by this rehearsal.

## Frozen inputs and source

Private, ignored preparation root: `.data/qa-prep/import-rollback-fault-20261009-4de2d799/`.

- Intent: `gate2-intent.json`, frozen before any future request; F/OID/B0 and unique action IDs bound. Never reuse against another target.
- Canonical intent `gate2-intent-approved-inputs.json` (v2) binds two **byte-preserving copies of distinct stored WebP objects** from the exact Gate 1 verified 139-file F-media baseline; selection is by in-memory hash/format metadata only, source storage keys omitted from output. These are mechanism-test inputs, not original 24+115 PNG import acceptance. The earlier generated SVG fixtures and initial intent remain as superseded preparation evidence; driver pins only the v2 intent. Provenance is `gate2-entry-provenance-corrected.json` and includes the actual v2 intent hash.
- Derived F entry: `gate2-f-entry.mjs`, generated from the reviewed prior entry with target/media and path bindings. Its route/composition block is unchanged, but the installed dependency layout required a documented pino resolver adjustment via Fastify's package. It does not start by default and its `prepared_only` path does not listen. A default module-load check now succeeds without DB connection/auth/listener.
- Reviewed source entry: `.data/qa-prep/uix293-global-import-prep/restored-readability-20261009-691d352/restored-readability-entry.mjs`.
- Official route contract source: `apps/server/src/global-sticker-catalog.ts`, pinned Git blob `afa0c0d9ac2a0c8aceccc6cfe1398c4f16da1d11`.
- Gate 1 copied readonly media manifest receipt: `media-readonly-preflight.receipt.json`.

The ignored driver `gate2-driver.mjs` defaults to no-op. Future use requires root's exact phase/nonce/v2-intent hash authorization and the already-approved local GM auth input; it limits requests to loopback `127.0.0.1:14186`, exact GM/global-pack route families and allowed methods. It never starts the server. For item 1, response body is consumed and discarded and the phase-1 receipt records only an `ack: WITHHELD` audit marker, not the item response status/body/ID. No credentials, cookies, response payloads, or private asset content are emitted. Failure receipts retain only a bounded method/route-family/status audit and safe error codes; automatic retry is disabled.

The separate read-only `gate2-delta-readonly.mjs` has only before/final phases and defaults to no-op. It never starts a server, authenticates, or sends HTTP. Its before phase compares F full-row/schema/journal/sequence/session/storage fingerprints with Gate 1 and verifies the 139-file baseline plus absent intent actions. Its final phase consumes immutable before + Gate2 receipts, rechecks protected DB fingerprints, proves expected pack/sticker/media table deltas by full-row hashes, binds the new global-media storage reference to the single new WebP file, requires all 139 baseline media bytes/hashes unchanged, and rejects extra/orphan files, item2 action, schema/journal/sequence changes or unexpected domain rows. Important hash distinction: the official upload route writes `global_sticker_media.sha256` from the submitted source-buffer bytes, while stored WebP bytes can differ after conversion. Therefore DB media SHA is compared to the frozen item1 source hash for the new row; stored-file hashes are validated independently against the pinned Gate1 manifest aggregate and per-path files, never incorrectly compared to the DB source hash. Protected databases that lack a `sessions` table are allowed in the protected fingerprint path; the F fingerprint still requires it. Table digest order follows the same SQL `ORDER BY table_name` sequence as Gate 1. Expected natural GM session delta is exactly two; this is an explicit assertion, not a zero-session-write claim. It stores only aggregate counts/hashes and safe predicates, never row/storage key/path values.

## Proposed root-run sequence (not yet authorized/executed)

1. Start only the frozen source-faithful entry against F, with exact DB/OID/media/port guards verified before listen. Root must retain the exact owned process handle. No current/protected DB access, seed, migration, import script, or full E2E.
2. `fault-item1`: normal GM auth; create one new owned DRAFT pack (expect 201); read back empty DRAFT; upload synthetic item 1. The client fully consumes then intentionally withholds/discards the response status/body/ID and exits. This models **client-local lost acknowledgement after server response**, not packet loss, server crash, or spontaneous outage. Immutable phase-1 receipt records the private pack ID and withheld-ack fact only; independent reconciliation in phase 2 must prove commit.
3. `resume-replay-reject` in a fresh process: authenticate; read own list/detail and reconcile exactly one pack and one committed item; identical pack and item replays must return stable IDs; changed pack name and changed item metadata must each return 409 `ACTION_ID_CONFLICT`; synthetic item 2 upload uses deliberately incorrect declared source hash and must return 400 `SOURCE_SHA256_MISMATCH`; final read-only detail/list must show exactly one owned pack, exactly one item, no item 2, and DRAFT lifecycle. No publish or delete.
4. Root records natural auth/session deltas separately. The driver does not assert zero session writes. Expected domain delta is one pack, one sticker, one media metadata row/storage reference, and one valid item-1 file; rejected item 2 must add no DB row or media file. The phase-2 final receipt is emitted only after all predicates and is immutable.
4a. The separate root-run read-only delta helper emitted `.data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-delta-before.receipt.json`. Its first final attempt failed closed and is retained immutably. A corrected root-reviewed run, if authorized, writes a unique `.data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-delta-final-attempt2.receipt.json`, bound through `beforeReceiptSha256` and exact Gate2 receipt SHA. Gate 3 consumes a successful delta receipt; HTTP-only assertions are insufficient proof of exact media-file delta.
5. Root separately stops only its owned F server and verifies fresh loopback port-free state. **That is a distinct root-owned receipt** bound to the final Gate 2 receipt hash, F name/OID, actual process handle/PID and port check. Neither Gate 2 receipt nor this plan claims the listener has stopped.

## Exact Gate 3 consumer receipt contract

Canonical path: `.data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-final.receipt.json`.

Required successful HTTP/API shape:

```json
{
  "status": "PASS",
  "target": {
    "database": "arken_qa_importfail_20261009_211bd455cd",
    "oid": "28340",
    "baseBackupSha256": "73c8163a093042892f3746aa8bdf53d32fceee696c58cebcb6056b937f648b4f"
  },
  "packId": "<stable private ID>",
  "item1StickerId": "<stable private ID>",
  "item1ActionId": "<frozen intent ID>",
  "checks": {
    "item1CommittedPersisted": true,
    "packCreateReplayStableId": true,
    "item1ReplayStableId": true,
    "exactlyOneOwnedPack": true,
    "exactlyOneSticker": true,
    "changedActionConflict409": true,
    "item2Rejected400": true,
    "item2Error": "SOURCE_SHA256_MISMATCH",
    "item2AbsentFromDetail": true,
    "lifecycleDraftNoPublish": true
  }
}
```

IDs remain in ignored private receipts only. The consumer schema intentionally has no server-stopped/listener field. A failure or uncertain phase remains a separate immutable failure receipt; never overwrite it or claim PASS. Gate 3 additionally requires the separate delta-final receipt and its before-receipt hash. Root's server stop/listener proof is a third distinct root-owned receipt bound to the Gate2 receipt hash and F identity; it must not be inferred from these receipts.

Read-only delta receipt paths and schema: `gate2-delta-before.receipt.json` contains the exact F/OID/B0, Gate1 and intent hashes, full public table row count/hash map, sessions/schema/journal/sequences/storage hashes, 139-file aggregate, absent-action assertion, and protected full fingerprints. `gate2-delta-final.receipt.json` contains status PASS, the same target, Gate1 SHA, `beforeReceiptSha256`, `gate2ReceiptSha256`, `phase1ReceiptSha256`, before/after full aggregate fingerprints, table-count deltas, natural session delta, protected-before/after equality, and true predicates for exactly one new pack/sticker/global-media object/file, intact baseline139, item2 absent, reference/file consistency, and no duplicates/orphans/unexpected domain rows. No raw identifiers/keys/paths/rows are emitted.

## Gate 2 execution checkpoint

- Artifacts: canonical v2 intent and two approved WebP copies, the superseded initial intent/SVGs, derived entry + corrected provenance, source guards, `gate2-driver.mjs`, `gate2-delta-readonly.mjs`, `gate2-approved-input-copy.mjs`, their tests, and the copied readonly-media receipt are all under the ignored root above.
- Root runtime evidence: before-delta receipt PASS (SHA prefix `8055F296`); owned F entry on loopback 14186 (PID 34028, session 74073); phase-1 ack-withheld PASS (receipt SHA prefix `4870c06`); phase-2 HTTP/API PASS (receipt SHA-256 `2a58482d94b64b1e9fdd9686e4f27fde9d6983d74b88cf4e376a9ab3968b7821`). Phase 2 established the intended one pack/item state and was not replayed afterward.
- The first read-only final delta attempt exited 1 with `MEDIA_DELTA_OR_ORPHAN`; immutable failure receipt SHA prefix `ff68e647` remains retained. Source review found the SQL result exposed `size_bytes` while the predicate read `media.sizeBytes`, so the check compared a valid stored-file size against `undefined`. This is a helper defect; it does not establish an actual orphan. Corrected helper now aliases `size_bytes as "sizeBytes"`, normalizes both driver spellings, and has an offline regression assertion for actual query alias/use. It emits a distinct attempt-2 final receipt path and cannot overwrite the first failure. No runtime rerun was performed by this agent.
- Root stopped only its owned F server; the owned process handle terminated with code 1 and an elevated fresh listener check returned 0. No R database was created and no Gate 3/restore occurred.
- Current offline verification after correction: `node --check .data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-delta-readonly.mjs` exit 0; `node --test .data/qa-prep/import-rollback-fault-20261009-4de2d799/gate2-delta-readonly.test.mjs` 7/7 pass; `git diff --check` exit 0. Frozen hashes: helper `42fdebdf9c6c0eae14866f669ddc3d9872ad02ebbe0f81fffab092437f7cf13c`, test `3a03d5a9000713ec1e014a52f3d7510ab806482c07e8a1a6c311cdbb4d57a251`, this plan `79043899f5578c7145272a7c4be8fb734d1f9b58e031583f57221af9b1f8a7aa`. These offline checks do not replace the pending root-run corrected read-only delta.
- Prep failures preserved: the first guard test resolved fixture names without `inputs/` (`ENOENT`); corrected. First derived-entry review exposed wrong package relative depth and undefined media path; corrected to the exact worktree package/media locations. The first actual no-op module load failed because `pino` was not directly resolvable from `apps/server/package.json`; corrected to the locked Fastify dependency resolver and the load then returned `prepared_only`, DB disconnected/listener false. The first delta-helper review found and fixed final-receipt phase1 hash binding, optional sessions-table handling for a protected non-Arken DB, SQL table-order preservation, and source-vs-stored hash semantics; regression cases now exercise those branches. Root's first actual read-only `before` attempt exited 1 at `BASELINE_MEDIA_DB_BINDING` before writing a before PASS receipt; root retained immutable failure `gate2-delta-before-failure-6fda1b5a…`. This was a false equality assumption: source inspection confirms DB `sha256` is source-input hash, while stored-byte hashes are independently proven by the Gate1 manifest. The corrected helper removes only that mistaken comparison; it retains exact file count/size/bytes/hash checks and is awaiting root review. No auth, HTTP, listener, or DB writes occurred. This was a diagnostic helper failure, not a product failure or Gate2 runtime attempt.
- Remaining: root review corrected helper and immutable attempt-2 path, then decide whether to run its read-only phase against the unchanged F. Gate 2 HTTP/API is PASS; Gate 2 media delta remains pending. Gate 3/R recovery remains unrun; original PNG acceptance and 173 historical missing objects remain unresolved.

## Root actual final delta — 2026-10-09
Corrected helper42FDEBDF9C6C0EAE14866F669DDC3D9872AD02EBBE0F81FFFAB092437F7CF13C independently7/7focusedtestsPASS. Root actual elevated attempt2 read-only final exit0, receipt98259D1EB2577DE8C9425338B82F8EFC3A92AF360C8907AC0F3B217AA2172B34. Full proof: exactly one ownDRAFT/item1/media/file delta, storage refs312→313, baseline139 byte/hash intact and total140, no item2/duplicates/orphans/unexpected domain rows, schema/journal/fullsequence equal, protected fullfingerprints unchanged; naturalGM sessions+2. Earlier failure preserved, no replay/auth/domain writes in attempt2. F harness already stopped and14186free; R restore/readabilityNOTRUN. This proves bounded Gate2 mechanism only, not production/originalPNG/full173recovery.
