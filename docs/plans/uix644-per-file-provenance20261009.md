# UIX-644 — per-file provenance prep (2026-10-09)

## Checkpoint / scope

This checkpoint records preparation and one subsequently root-authorized additive empty test DRAFT. No browser cell, upload, publish, delete, campaign member/character/scene mutation, Linear update, commit, or service restart was performed. Source baseline is product commit `52013d43e6f2fca1bb268c38608afde9cd76424a` (worktree HEAD at inspection: `691d352582961c16963a20c5f368e103bfc3180d`). Current browser/Select gate has already established four GM contexts for native DOM select changes; do not replay it here.

The approved B-fixture GM session-only login and read-only inventory have run: auth `200`, session cookie established, `GET /api/gm/sticker-packs` `200`, zero packs in the fixture campaign. No A credential was read. Receipt `.data/qa-prep/uix644-per-file-provenance-20261009/inventory-2026-10-09T04-34-45-034Z.json`, SHA-256 `4d1d545defd4a2c89b18fdd1d108fd7f45ed068ccda6378c904f9746fff52d96`, stores campaign/pack IDs privately and only aggregate pack lifecycle/subject/sticker counts; stdout contained counts only. No campaign content mutation occurred. This confirms there is no owned DRAFT candidate to reuse in this fixture campaign.

## Source-derived handler and persistence map

Reviewed exact sources and SHA-256:

| File | SHA-256 |
|---|---|
| `apps/web/src/StickerPackManager.tsx` | `c47d19388472117b0b58635ce1b0537677513f478554e60f818fb7e114285549` |
| `apps/web/src/sticker-pack-api.ts` | `ee098ae2c40631e6654e330865cb3b523af46cc7c7a55e88444fb7f7991fb02` |
| `apps/server/src/sticker-pack-admin.ts` | `99da9d2ea87f2dfff4d389ca4c86870447f37119fda1417ef26ff65a0d63a96a` |
| `apps/server/src/routes.ts` | `44117f61bc3324b32f044e4f5a3dc931756abdb3d94c97e44978373f29b4285` |

`StickerPackManager` is GM-only. On mount it loads `GET /api/gm/sticker-packs`; each listed item’s button calls `resumePack(id)`, which issues `GET /api/gm/sticker-packs/:id` and restores uploaded stickers as `status: "uploaded"` with `file: null`. Uploaded rows are deliberately immutable/disabled. Thus resuming an existing pack is not sufficient to exercise per-file provenance editing unless it has a safe pending file state; existing uploaded files must not be altered or re-uploaded.

The empty draft form defaults to `subject: CHARACTER`; `NPC` is a supported branch and requires a non-empty `subjectLabel` (max 80 chars). A valid `createDraft()` sends exactly `{name, subject, subjectCharacterId, subjectMembershipId, subjectLabel, audience, sendPolicy}` to `POST /api/sticker-packs`; this creates a persisted DRAFT (revision returned by API). This is a domain write and requires explicit authorization. The one allowed write is recorded below. If any future response is uncertain, do not retry; refresh/read list first. Use only clearly synthetic label and GM-only visibility/send policy; no human likeness/consent dependency.

After root’s explicit authorization, one additive synthetic empty NPC DRAFT was created with a single official `POST /api/sticker-packs`; no retry was attempted. The exact request and response metadata, including private campaign/pack IDs, are retained only in ignored intent/result receipts listed below. Immediate pre-write list was freshly rechecked at `200` with 0 packs. POST returned `201`; subsequent read-only list returned `200` with exactly one matching pack; detail returned `200`, lifecycle `DRAFT`, revision `0`, 0 stickers. The DRAFT is retained; no delete/rollback is authorized or performed.

The file chooser accepts PNG/JPEG/WebP, multiple. `addFiles()` creates a local pending draft (`status: pending`, `file` populated, `provenanceType: IMPORTED`, empty source/author/license fields). The wrapping `label` is `Добавить изображения`; each file row is `.sticker-pack-file` with legend from the selected local filename. The row’s nested wrapping label prefix `Происхождение` owns one native select with `IMPORTED`, `ORIGINAL`, `COMMISSIONED`. Its `onChange` calls `updateFile()` in React state only; it is not an API mutation. Selecting `ORIGINAL`/`COMMISSIONED` hides the imported-source subfields; restoring `IMPORTED` restores them. Use a generated generic filename and do not persist/print the browser’s filename in receipts.

Persistence boundaries: `uploadPending()` calls `POST /api/sticker-packs/:id/stickers` and persists media/sticker bytes plus metadata; `publish()` calls `POST /api/sticker-packs/:id/publish` and changes lifecycle. Both are expressly excluded. No submit/create/upload/publish/delete/consent action is part of the proposed local interaction. Local pending provenance change and restore should generate **zero domain HTTP writes**; auth/session writes and normal read-marker requests are tracked separately from domain writes.

## Safe image fixture

Created ignored engineering-only file `.data/qa-prep/uix644-per-file-provenance-20261009/qa-provenance-sample.png`, deterministic neutral 256×256 SVG rasterized with repository-locked Sharp `0.35.4` (resolved from `apps/server`, not installed into the repo). Metadata: 4,186 bytes, SHA-256 `783cdf4bb6e75731f52ab576f1c9a4b83d1432680a3c9f5145298b524ee5a7ef`. `git check-ignore` confirms it is ignored. It is not user artwork or a final sticker. The first attempt to resolve Sharp from repository root failed before creating any file; the explicit `apps/server` locked dependency resolution succeeded. Do not overwrite this fixture; create a new unique path if its bytes ever need replacement.

## Connected gate helper prepared, not run

Root authorized the single DRAFT already created. The current follow-up helper `.data/qa-prep/uix644-per-file-provenance-20261009/per-file-provenance-4cell.qa.mjs` has SHA-256 `740a45f3eb4419e72e9401c19cd2ac7c5909f918d9be0de3b90448e7017eeb68`. Its route guard allows only local reads, exact GM auth, `/api/chat/read`, and client-log requests; it blocks other origins and domain-write attempts before sending. It records blocked-request protocol/host/port/resource type/stage/family only, with URL path/query/fragment and bodies discarded. Per root’s instruction, blocked nonlocal safe GETs are retained as cell-level partial evidence but do not stop the independent follow-up cell; domain-write attempts or blocked nonlocal unsafe methods stop. Offline tests pass 9/9 (`request-guard.test.mjs` and `matrix-mode.test.mjs`; guard module SHA `80d089d415897a1353c4681b2ee2e6abbf286ff24379895f6009c104d1181b2a`, guard tests SHA `e75f6b41fba23ddfa85dbcc163fce65aac444c6a09e9c1287c6525a4cfdc68a9`, matrix module SHA `52c20d79f72b615b29cb0bcaafe237b60370a1b90fd36b396590a8306f2a98ce`, matrix tests SHA `db9899bb7ae4ce9481fb6d505a1d1de4e2bc5c215724cb89288d3be028f73689`). It refuses every mode except `--chrome-compact-only`, which runs only the previously blocked Chrome compact cell; tests verify no accepted cell is replayed. Source-exact list readiness waits for the manager's `Загрузка списка…` marker to detach, then waits for the target button event if no empty-list signal exists; this replaces the previous immediate count race and uses no fixed sleep/retry. It checks the server DRAFT remains revision 0 with zero stickers, opens Files, selects only the safe generated PNG, counts all direct `Происхождение` label captions in the manager (must be exactly one), asserts focus, changes the select `IMPORTED` → `ORIGINAL` → `IMPORTED`, verifies pending status/imported-field restore, then uses the source-defined local-only “Убрать из списка” action. A final read-only detail GET checks DRAFT/revision0/zero stickers. No upload/publish/delete API is allowed. `setInputFiles` exercises the browser file input, not the native OS file chooser.

1. In GM Chrome desktop, Firefox desktop, Chrome compact, Firefox compact, open/reuse only the confirmed owned DRAFT. If no safe empty DRAFT exists, stop until root separately authorizes its one-time creation.
2. Choose the generated PNG using `Добавить изображения`; verify exactly one local `.sticker-pack-file` row and status pending.
3. Resolve the source-wrapping `Происхождение` label (direct label text prefix, then nested select; do not use exact accessible-name including option text). Record selected enum only. Change `IMPORTED` → `ORIGINAL` → restore `IMPORTED`; assert row remains pending and controls enabled after each step. Do not enter provenance text and do not click any mutation action.
4. Audit network per cell: separate GETs, auth/session, and read-marker writes from domain mutations; stop immediately if any domain write occurs. Capture status/method/resource family only, no raw URL/query, file name, body, token, pack name or private text.
5. Reload/reset UI state only if it does not create a domain write; before leaving, ensure no pending file bytes are uploaded. Retain DRAFT unchanged. The local File object is ephemeral and should disappear when navigating away. Do not delete the DRAFT or cleanup fixture unless root requests it; preserve private receipt for audit.

There was no pre-existing pack/DRAFT in the fixture campaign; the authorized empty NPC DRAFT is now the sole test candidate. This operation is a domain write that was explicitly approved and recorded. Do not infer registration/auth readiness. This pool cannot resolve the separate known absence of 173 legacy media bytes or claim historical media recovery.

## Write and backup evidence / limitations

- Intent receipt (written before the request): `.data/qa-prep/uix644-per-file-provenance-20261009/draft-intent-2026-10-09T04-35-53-987Z.json`. It contains the exact synthetic payload and campaign identifier privately; no token/session cookie is stored.
- Result receipt: `.data/qa-prep/uix644-per-file-provenance-20261009/draft-result-2026-10-09T04-35-53-987Z.json`, SHA-256 `b97675ea6f53d987e39f725c764ced705644e88fb55d0d849fbb4baed0fd3f10`.
- Historical backup verified before the write: `.data/qa-prep/uix293-global-import-prep/backups/uix293-arken_qa-20261008T164747Z.pgcustom`, 311,439 bytes, SHA-256 `578beb0d6024798010722ef8c6691287fb4407ea3eda826bed147773c8077295`; prior evidence reports `pg_restore --list` exit 0 and 503 TOC entries. This was **not** a fresh rollback baseline for the 10/09 write.
- Root later required a fresh pre-write snapshot; that condition was not met because POST had already returned 201. This is a recorded limitation, not retroactively corrected by the post-write snapshot. No restore/delete/repair/retry was done.
- Post-write snapshot helper command `node .data/qa-prep/uix293-global-import-prep/backup-confirmed-local-qa.mjs` exited 1 during its validation pipe because it passed a `ReadStream` to `child.stdin.end()` instead of piping it. The helper had already created `.data/qa-prep/uix293-global-import-prep/backups/uix293-arken_qa-20261009T043628Z.pgcustom` (370,239 bytes, SHA-256 `f896ac40ac44bcfca82b336f95233cc04a628a5f73be454485e319b7ca549ef6`). A corrected read-only `pg_restore --list` confirmed exit 0, 523 TOC entries and archive-header marker. Sanitized receipt `.data/qa-prep/uix644-per-file-provenance-20261009/postwrite-backup-verification-corrected-2026-10-09.json`. This snapshot is explicitly post-write and **not** a pre-write rollback point.

## Verification / blockers / next action

- Source review: complete for the four files and SHA values above.
- Ignored deterministic fixture: generated and verified dimensions/hash/ignore status.
- Existing B campaign inventory: session auth POST 200 and read-only list GET 200, zero packs before create; see sanitized inventory receipt above.
- Authorized DRAFT creation + read-only verification: POST 201; list/detail 200; one DRAFT, revision 0, 0 stickers. No retry.
- Backup: pre-write rollback baseline limitation recorded; separate post-write archive validated successfully as detailed above.
- Browser/runtime gate: root ran one GM Chrome desktop cell; three remaining cells are not run. No service start/restart. The authorized local API and DB were reached for scoped auth/list/create/detail and snapshot operations described above.
- Next action: root reviews the remaining-three helper and accepts the backup limitation before its controlled run; do not replay the accepted Chrome desktop cell.

## Root per-file cell outcome and blocked-resource follow-up

Root ran the original four-cell helper once; it completed only the first ordered cell, GM Chrome desktop. Immutable receipt `.data/qa-prep/uix644-per-file-provenance-20261009/per-file-provenance-4cell-20261009-044131982Z.json`, SHA-256 `29c9cd3fccd6ffdfd704acb9603d49e3e7df0063fe2e18e0741adef0bd148658`.

- Chrome desktop named per-file interaction **PASS**: one local file row; unique `Происхождение` direct-caption count 1; focused before change and restore; IMPORTED → ORIGINAL → IMPORTED; imported subfield label count 3; pending status remained; local row removed; final detail GET 200 and server pack remains DRAFT revision 0 with zero stickers.
- Audit: 21 API GETs, 4 frontend GETs, 1 auth write, 1 read-marker write, 0 domain writes, 0 domain-write attempts, 0 client-log posts, 0 page errors. Four Chrome console errors were counted without raw text. HTTP events retained as two bootstrap GET 401 and operator/feedback GET 403 during route-login; these remain distinct and are not waived.
- A single blocked GET was recorded only as `GET:nonlocal:nonlocal-or-unclassified`; the immutable receipt did **not** preserve protocol, host, port, resource type, or phase, so the resource cause cannot be retroactively identified. It is not evidence of a product defect or of a safe local preview.
- Exact `StickerPackManager.tsx` source and stylesheet have no `URL.createObjectURL`, `blob:` or image-preview element. There is no source proof that selecting this fixture creates a local blob/data preview request. Therefore no blob/data exception or external-host allowlist was added; external requests remain blocked.
- The ignored helper was revised offline to classify a future blocked GET by protocol/host/port/resourceType/stage/family only, discarding path/query/body; pure redaction tests cover external HTTPS, `blob:` origin and `data:` payload stripping. The helper now refuses to start unless invoked with `--remaining`, and that mode runs only Firefox desktop + Chrome/Firefox compact, never accepted Chrome desktop. It continues after blocked safe-read attempts, reports them as blocked-resource evidence, and stops before any domain-write attempt. Node syntax check and guard tests 6/6 passed; browser run awaits root review.

At that checkpoint the evidence was **one scoped cell PASS, three cells not run**. Never rerun Chrome desktop or infer unseen per-file behavior. The subsequent root three-cell outcome and current Chrome-compact-only follow-up are recorded below; external resources remain blocked.

## Root remaining-three result and current single-cell follow-up prep

Root ran the three eligible cells once. Immutable receipt `.data/qa-prep/uix644-per-file-provenance-20261009/per-file-provenance-4cell-20261009-044546591Z.json`, SHA-256 `f2f7d260d6faea125838ccdc2e1d1bd5dfd9b098927876de2a68c0c86d779108`:

- Firefox desktop and Firefox compact: scoped per-file assertions **PASS**; whole cell `PARTIAL_BLOCKED_SAFE_READ` because a nonlocal GET stylesheet from `fonts.googleapis.com` was blocked. It is an external font request; it remains blocked, not waived/allowlisted.
- Chrome compact: `BLOCKED_DRAFT_TARGET`, target list count 0. This is attributed to the source-list async loading race, not product defect. No per-file assertion ran in this cell.
- Aggregate audit: 61 API GETs, 1,220 frontend GETs, 3 auth writes, 3 read-marker writes, 0 domain writes/attempts, 0 page errors, 4 Chrome console errors. Each cell recorded two bootstrap GET 401s and one operator/feedback GET 403; raw messages/URLs remain omitted. External CSS may affect visual appearance; this is not a release-ready visual acceptance claim.
- The prior root receipt did not include safe network target metadata on the first run, but the remaining-three receipt identifies `https`, host only, `stylesheet`, stage, and family. No URL path/query/body was retained.

Offline update for the next **single Chrome compact cell only**: wait for source-rendered `Загрузка списка…` to detach and then wait for the uniquely named target button (event-driven, no sleeps or retries) before evaluating target count. This specifically repairs the harness race, not product source. Matrix mode now refuses any command except `node .data/qa-prep/uix644-per-file-provenance-20261009/per-file-provenance-4cell.qa.mjs --chrome-compact-only`. Node syntax check and offline policy/matrix tests pass 9/9. This helper has not been run; root must review/execute it. Do not re-run Chrome desktop or either Firefox cell.

## Root Chrome compact-only follow-up — final cell

Root executed exactly the remaining Chrome compact context, after the source-synchronized list-loading wait. Immutable receipt `.data/qa-prep/uix644-per-file-provenance-20261009/per-file-provenance-4cell-20261009-044823267Z.json`, SHA-256 `81b7ee7859d52afa2796d37749b53817e250482905f77db44a6805a9c271c12f`.

- Chrome compact scoped provenance assertions **PASS**: unique source-label caption count 1; focus verified before both changes; `IMPORTED` → `ORIGINAL` → `IMPORTED`; three imported-subfield labels visible after restore; pending row locally removed; final read-only detail 200, DRAFT revision 0, zero stickers.
- Whole cell is `PARTIAL_BLOCKED_SAFE_READ`: the HTTPS `fonts.googleapis.com` stylesheet read was blocked by design. No remote host or scheme exception was added.
- This closes the **per-file provenance DOM interaction assertions 4/4** across GM Chrome/Firefox desktop+compact. It does **not** make the whole four-cell browser pool a 4/4 PASS: Chrome desktop was whole-cell PASS in its earlier receipt; the other three whole cells are PARTIAL due the blocked external font GET. This is DOM/file-input evidence only, not native OS chooser, OS popup, visual-font, upload/publish, or release acceptance.
- Current cell audit: 21 API GETs, 407 frontend GETs, one auth POST, one read-marker POST, zero domain writes/attempts, zero client-log posts/page errors, four Chrome console errors. HTTP records: two bootstrap GET 401 and one operator/feedback GET 403. No raw messages or URLs were retained.
- The async list issue was harness-only and resolved by waiting for the source loading indicator and target button; no product code changed. Root instructed no more browser reruns; preserve receipts and proceed to root review/commit gate.
