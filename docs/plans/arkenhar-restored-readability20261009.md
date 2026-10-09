# ArkenHar — restored readability checkpoint, 2026-10-09

## Gate state

**Scoped restored readability gate passed on the exact local harness only.** After root reviewed the frozen source composition and launched it persistently on loopback 14185, the single authorized HTTP helper run exited 0. No browser, stock startup/seed, deployment, or production run was performed. Earlier mistaken session `42733` remains recorded below; root verified no listener after its interruption, and it was not retried by this agent.

## Scope and provenance

- Worktree: `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007`.
- Product source SHA: `52013d43e6f2fca1bb268c38608afde9cd76424a`; root full build at candidate `691d352582961c16963a20c5f368e103bfc3180d` exited 0, log SHA-256 `32cb6c0c2700e79b5ff7e62b6039502bd9aa9454536eee3633ded734334934e7` (large-chunk warning retained). No rebuild.
- Current HEAD was `1048256e3b77ee769ede6b643c4fb9cf57689f3d` at last check. Concurrent docs/checkpoint edits belong to other workers and are preserved.
- Paired recovery receipt SHA-256: `197d68dc313b4e36a2197e7dc0f50f967a7528a2ae99713e2b0d143cc9aa6141`.
- Authorized field-only Docker metadata inspection was used in memory for the known local QA DB container. The DSN/password was not emitted or persisted. The first credential-free client probe failed with PostgreSQL `28P01`; the later authorized identity-only preflight matched target DB/OID/role/port. No env-file or process-env search.

## Read-only baseline evidence

- Exact disposable target: `arken_qa_pair_20261009_b10d6e69`, OID 26493, via loopback 14181. Identity guard passed; no DB writes were performed.
- DB baseline receipt: `.data/qa-prep/uix293-global-import-prep/restored-readability-20261009-691d352/target-readonly-preflight.receipt.json`, SHA-256 `29cdad29306704e179db2f16f5e7ba1ec0fcb1943d85ff26b265d2dfb5637f90`. Counts/hashes only; 59 public base tables. Paired receipt’s `restoredRows=56` is a differently scoped metric; semantics remain unreconciled.
- Media preflight receipt SHA-256 `1b04102be2dd85717c8ce48b68a40513eb163b00b8988b45c1fadcc6865e791a`.
- Pinned per-file copy manifest was found by its SHA in the exact snapshot; all 139 manifest entries matched DB keys, byte lengths, and stored file SHA-256; WebP signatures passed. Total 10,518,668 bytes. Verification receipt SHA-256 `07B3F8E384BEAAA2803F5EB39141C9B1FE513E90AC6A83769C1A4492C648CD5F`. This proves those 139 stored objects only; 173 absent references remain unresolved.
- Existing matching credentials were checked read-only by token-hash eligibility: 3 GM candidates and 2 PLAYER candidates match existing records. No auth request has succeeded. Operator allowlist was not supplied, so operator arm is BLOCKED and must not be promoted.

## Harness readiness

- Root accepted the source-faithful composition: actual Fastify/plugins/hooks/error handler, actual PostgreSQL client, actual Socket.IO/realtime registrar and `registerRoutes`; only `ensureSeed` and wildcard bind are omitted, with loopback `127.0.0.1:14185`. OID guard precedes env/source import and repeats on app client. No mocks or alternate DB.
- Locked local executable `tsx v4.23.11` / Node `v24.15.0`; `pnpm exec tsx --version` hit sandbox EPERM, so the verified local executable is used. Syntax checks passed for entry, HTTP helper, and manifest verifier.
- Harness: `.data/qa-prep/uix293-global-import-prep/restored-readability-20261009-691d352/restored-readability-entry.mjs`, SHA-256 `5DA94AA8F7579EF61896B33A2912FD51E5D8C509DDC1F12F170985260E61CE92`.
- HTTP helper: same directory `http-readability-gate.mjs`, SHA-256 `7907A3BA411821CD0EDF424A3BDB698714276456EAED8FB674A0F69A0E210D3D`. After root review, it now captures in-memory SHA-256 fingerprints of all public domain rows except `sessions` immediately before and after the gate, plus verifies all 139 stored media hashes again after HTTP reads. Only hashes/counts are retained; row data is not emitted. It is prepared to exercise only matched existing GM/PLAYER access and read routes, with natural sessions expected; no invitation claim/member mutation/operator route. Do not run until root gate.
- Planned commands, **not approved for execution yet**:
  - `& .\\node_modules\\.bin\\tsx.cmd .\\.data\\qa-prep\\uix293-global-import-prep\\restored-readability-20261009-691d352\\restored-readability-entry.mjs --root-approved-launch`
  - `node .\\.data\\qa-prep\\uix293-global-import-prep\\restored-readability-20261009-691d352\\http-readability-gate.mjs --root-approved-http-gate`

## Runtime result (root-owned launch; one HTTP run)

- Frozen helper output receipt: `.data/qa-prep/uix293-global-import-prep/restored-readability-20261009-691d352/http-readability-gate.receipt.json`, SHA-256 `6105725CB802405FF273A718EC12E94248E0C2AF9AC9AC681E0D5DC15772A15E`.
- Result `scopedReadabilityPass=true`: health/build/schema guard passed; GM and PLAYER catalogs each returned 2 global packs (24/115 items) with the same 139 IDs; all 139 GM content responses and 2 PLAYER representative responses passed status, private/no-store cache headers, byte/hash equality to stored files, and Sharp decode/dimension checks; anonymous content returned 401.
- Only two matched pre-existing GM/PLAYER access paths were used. Exactly two natural session rows were added (396→398); normalized table-count fingerprint matched baseline. All 58 public domain tables excluding sessions (879 rows) had identical before/after full-row SHA fingerprint. Storage-reference fingerprint remained unchanged. All 139 media files still matched the pinned stored hashes after route reads.
- Operator arm was `BLOCKED_NOT_RUN`; no operator allowlist or promotion was asserted. No invite claim or membership/grant mutation was performed.
- Root stopped its own persistent listener after the gate; elevated check found 14185 free and current API/build 3ed0f5 unchanged. No further run is authorized or needed in this pool.
- This proves only the scoped restored harness routes. It does not prove stock startup/seed behavior, public authentication/registration, deployment readiness, or full recovery. The 173 missing referenced objects remain unresolved/not passed.

## Decision / next action

- Keep operator verification blocked; no GM promotion or allowlist inference.
- Root must first confirm whether session 42733 transiently bound and that 14185 is free. Then provide explicit GO for the one bounded local launch and HTTP gate. No retry before that.
- Do not describe this as restored-route pass, full recovery, or release readiness. The 173 missing references remain NOT PASSED.

## Compact checkpoint

- Decision: bounded restored GM/PLAYER global-public route gate passed; production/full-recovery gates remain open.
- Revision: source `52013d43…`; build candidate `691d352…`; current docs HEAD `1048256e…` at last check.
- Changed files: this checkpoint; ignored harness/receipt files under the path above. No product source/data changed.
- Verification: target identity + read-only fingerprint; exact 139-file manifest/hash/decode checks; root-reviewed harness source composition; one root-owned launch and HTTP gate passed with immutable receipt; post-gate authoritative listener cleanup verified.
- Blockers: operator arm lacks allowlist evidence; 173 missing referenced media objects remain unresolved; stock startup/deploy and human acceptance were not tested.
- Next: root integrates this scoped evidence at the stage gate; no runtime rerun or product change in this pool.
