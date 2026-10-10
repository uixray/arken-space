# ArkenHar — scoped restored-app readability gate, 2026-10-09

## Decision / exact boundary

Plan only, execution NOT RUN. Worktree `D:\AI\personal\experiments\arken-space\.worktrees\uix-293-catalog-20261007`, inspected HEAD `691d352582961c16963a20c5f368e103bfc3180d`; last product source52013d4. Read paired/local recovery and release-evidence checkpoints before narrow source review. Paired checkpoint supersedes local note's earlier uncertainty about media-root provenance.

Test **only existing restored DB `arken_qa_pair_20261009_b10d6e69`, OID26493**, and its paired restored139-file snapshot `20261009-b10d6e697c264c3f83ebd577a058300d`. Neither original current QA `arken_qa`/OID16384 nor pre0047 rehearsal/OID24647 is the target. Proposed HTTP API `http://127.0.0.1:14185`, no Vite/browser needed. No restore/migration/import/seed/fixture creation, media reconstruction, production/remote or product patch.

Success means **scoped app-route readability of the restored139 global blobs**, not complete recovery, stock bootstrap, release artifact, rollback or deployment validation. Full recovery remains NOT PASSED: 173 absent referenced objects (141 campaign sticker media,31 chat uploads,1 feedback attachment). A successful GET139 cannot resolve that loss.

## Source-observed prerequisite: stock entry cannot meet this scope

`apps/server/package.json` dev is `tsx watch src/index.ts`; index unconditionally calls `ensureSeed(db)` and binds `host:"0.0.0.0"`. `env.ts` has PORT but no HOST/skip-seed option. Setting an invented HOST/SKIP_SEED does nothing. Do not run package dev, built index, or import index. Seed can insert/reconcile domain data; it is not a safe presumed no-op on this snapshot.

Root agreed a **separately reviewed ignored composition harness** is appropriate for route readability only. It must use checked-in `registerRoutes(app,db,io)`, authenticators, storage and real PostgreSQL; no mocked auth, test header, injected membership, in-memory DB or direct file server. If exact composition fidelity cannot be demonstrated, stop at that technical prerequisite. Stock startup/no-seed/loopback remains a separate source-observed gate, no product changes requested here.

## Luna ownership and preflight

Own a new ignored harness/immutable receipts under `.data/qa-prep/uix293-global-import-prep/restored-readability-20261009-<unique>/` and one new sanitized result checkpoint. You are not alone: root coordinates after browser pool; preserve others' files/processes. No commit/Linear changes. Planner has not opened private receipts or credentials.

1. Root supplies exact authorized ignored private inputs. Operator reads paired receipt with SHA `197d68dc313b4e36a2197e7dc0f50f967a7528a2ae99713e2b0d143cc9aa6141`, under known recovery snapshot directory, programmatically. Resolve **restored snapshot media path**, not current live MEDIA_ROOT or source prep folder. Compare containment, non-symlink/reparse resolution and manifest identity. Never print that private path/storage keys, manifests, DSN or credentials.
2. Existing PostgreSQL container is `arken-uix644-qa-db-20261008`, loopback14181. Do not alter container/volume lifecycle. Assemble DATABASE_URL privately with explicit host/port/database. Reject default/fallback URLs, currentQA name/OID, remote hosts and unexpected query parameters. Before importing routes/env or opening HTTP, use the SAME actual database client for `SELECT current_database(), (SELECT oid FROM pg_database WHERE datname=current_database())`; demand exact target name/OID26493. Also verify connection address/port against the intended local mapping (server-side port may be5432 inside container, not external14181).
3. Read-only baseline on target: journal count/latest/hash, domain table-count fingerprint,312-row storage-reference fingerprint; global2/139/139 and media manifest139/10,518,668 bytes/zero hash mismatch; membership/grant eligibility only metadata. Separate sessions and feedback audit tables from immutable domain fingerprint. Check expected values against paired receipt rather than silently updating baseline.
4. Root captures currentQA OID16384 journal/domain/storage fingerprint read-only before/after during a coordinated no-write interval, using a separate read-only control connection never passed to the harness. Active QA workers can legitimately change currentQA; if concurrency prevents equality, report that limitation and attribution, not a fabricated no-change proof. Harness itself has only the target DSN.
5. Verify14185 has no listener before start. Occupied => STOP, not kill/reuse. Verify active14182/14183 ownership unchanged. Root approves exact harness diff/composition and permitted target session writes before launch.

## Exact source composition / environment contract

Environment must be set **before dynamic import** of `env.ts` or modules that import it (`env.ts` parses process.env on import). Use sanitized explicit allowlist plus needed OS runtime variables, not arbitrary live process-env copying. Secrets only child environment/in-memory inputs, never arguments or stdout. Required explicit settings:

| Key | Value / rule |
| --- | --- |
| NODE_ENV | `test` (valid env enum; cookie Secure=false on local HTTP is a declared difference from production) |
| DEV_DATABASE_DRIVER | `postgres`, never pglite |
| DATABASE_URL | exact isolated DB, programmatic private value |
| PORT | `14185`; explicit harness listen host `127.0.0.1` |
| MEDIA_ROOT | absolute verified restored snapshot directory from private receipt |
| BUILD_REVISION | actual inspected full source SHA, not inherited live build revision |
| SCHEMA_VERSION | `2`; verify restored journal independently—health constant alone is not schema proof |
| APP_VERSION | recorded source-compatible version; label this composition harness, not release build |
| WEB_ORIGIN / PUBLIC_URL | `http://127.0.0.1:14185` |
| GLOBAL_STICKERS_ENABLED | `true` |
| GM_ACCESS_TOKEN | private explicit valid-length value only if required by reviewed composition; it is NOT used to seed or grant access. GM login checks restored gm_access_credentials hashes, not this env shortcut |
| SESSION_COOKIE_NAME / SESSION_TTL_DAYS | source defaults `arken_session` /30 unless exact recorded test config requires another; client cookie jar isolated in memory |
| OPERATOR_MEMBERSHIP_IDS | only restored, provenance-verified authorized synthetic operator membership IDs, loaded privately; never add a GM merely to make a denied route succeed |
| RATE_LIMIT_MAX / OPERATOR_FEEDBACK_RATE_LIMIT_MAX | source defaults600/min and120/min, do not raise to green the test |

Source defaults for quota/audio/image limits can remain; record nonsecret effective numbers. No uploads are in scope. Do not claim operator ACL equivalence when the original operator allowlist is unavailable; operator arm BLOCKED.

Composition parity review against `apps/server/src/index.ts`:
- Fastify `trustProxy:true`, bodyLimit=`env.MAX_AUDIO_BYTES+1024`; same CORS origin/credentials, cookie, multipart attachFieldsToBody:false/files2, and rate-limit max/timeWindow registrations in source order.
- Same onRequest request/action-ID and unsafe-method origin check; same validation/error handling including campaign-guard handling. Do not omit security merely because most requests are GET.
- `createDatabase` uses exact locked workspace DB implementation; verify built workspace exports against source provenance or build required contracts/db/system into a separate source-export target. Do not rebuild shared active outputs while other workers run, do not use stale unverified dist.
- Construct actual Socket.IO server with source CORS/recovery settings and provide it to checked-in `registerRoutes`. Preserve required service DI; review `registerRealtime` side effects before choosing source-identical registration. No sockets opened by this HTTP gate; do not use a fake broadcaster to avoid an unresolved dependency.
- Omit only `ensureSeed` and stock wildcard listen by explicit harness design; install loopback listen14185 and graceful onClose (`io.close`, client.end). Record any additional intentional logging instrumentation differences. Avoid logging raw request/response bodies/URLs/headers. Source-compatible logger may use a private sink; outward summary is whitelist only. Root must see the source-vs-harness composition diff before start.
- No auto-start script/Compose/migration. Pnpm package scripts do not supply this harness; it is a new ignored test-only wrapper using existing source, not a product patch. If supported locked TS execution/import resolution cannot be established, BLOCKED before launch.

## Authentication and allowed writes

Use only existing restored synthetic identities with root-authorized private token artifacts. Snapshot time matters: a token rotated after capture may not match restored hashes. Determine compatibility in memory using existing hash/equality code and restored rows; record only eligible/mismatch/absent booleans. Never print hashes/values, read old seed source as a fallback, create membership, rotate/reissue token or modify grants.

- GM: existing valid token → real `POST /api/auth/gm` body `{token}`. Source matches `gmAccessCredentials` plus GM membership, then inserts a session. Invalid token gives403 `INVALID_MASTER_TOKEN`; do not label it recovery corruption automatically.
- PLAYER: `POST /api/auth/invite` is safe for this scope ONLY after proving token matches an existing **nonrevoked playerAccessGrant**, not an unclaimed invite. Send no displayName. The alternate unclaimed-invite branch may create/claim ownership and is prohibited here. If only unclaimed invite available, player arm BLOCKED. Do not use beta `/api/auth/player/:handle` shortcut.
- Keep Set-Cookie/cookie jar only in memory/private ignored artifact if needed. Actual requireAuth resolves hashed session plus expiry/membership. Never insert a synthetic session directly or pass `x-test-auth`.
- Allowed writes: new sessions produced by those official logins in disposableOID26493. Operator attachment success can insert `feedbackOperatorAudits` via actual route; root must expressly include this narrow natural audit effect before execution, otherwise do not execute successful operator read. Missing-file response occurs before its audit call. No feedback state change/reveal/export, bootstrap/ensure helpers, chat read cursor, POST send or lifecycle mutations. Record exact created session/audit delta privately; no blanket table cleanup afterward.

No valid target credentials => auth-dependent readability BLOCKED. Disk/hash restore evidence remains valid but cannot replace authenticated HTTP evidence.

## One connected HTTP/payload gate

### A. Target and catalog

After guard, call `/healthz`; require200/databaseok/reported revision and schema2. Compare against same-client identity/OID guard; health does not expose DB identity and alone cannot prove isolation. Keep private request audit restricted to this origin/port, reject redirects to other hosts/ports.

Authenticate one eligible GM (plus PLAYER if eligible) through official route. `GET /api/stickers` returns both campaign/global packs; select `scope===GLOBAL_PUBLIC`, require exactly intended active two packs24/115 and139 distinct global sticker IDs. Compare joins/IDs against restored DB in private evidence. Never infer global catalog by filesystem count alone.

For each of139 catalog-returned `/api/global-stickers/:id/content` URLs, sequential full GET **without Range**, bounded pacing below600/min, no mocks/retries masking error:
- actual HTTP200, MIME image/webp, private/no-store, Content-Length equals received buffer length and restored-media expected size;
- SHA256 of received bytes equals the **restored stored-WebP manifest hash** for its exact DB storage-key mapping, not `global_sticker_media.sha256` source-input hash;
- validate WebP signature and decode received buffer fully using the already-locked server Sharp into raw pixels in memory; metadata alone is not full decode. Match decoded dimensions to restored row. Never write/re-encode source/media or output pixels to public logs;
- immutable receipt aggregate139/139, status distribution, byte/hash/decode mismatches and role. Repeat representative24/115 content as PLAYER for role readability if eligible; do not imply139 PLAYER fetches when only two sampled.

Anonymous real request to representative global content should yield401 `AUTH_REQUIRED`, not bytes. Nonoperator eligible GM/PLAYER to `/api/operator/feedback/capability` should be denied by source ACL; authorized operator capability arm requires proven allowlist/session. This is scoped read ACL, not all creator-mutation security or cross-campaign regression.

### B. Existing173 missing references — targeted diagnosis, not recovery

Use private restored reference manifest/SQL joins, no content dumps. Reconfirm category counts141/31/1 absent in restored snapshot. Media rows and HTTP route IDs differ: map campaign media to a real sticker ID; chat upload to real attached contentId/thread; feedback attachment to its reportId+attachmentId. Do not fabricate links for unattached uploads.

Probe at most one **proven authorized/reachable** representative per category initially; record remaining not-probed count. If no representative with the needed restored identity/visibility exists, mark HTTP arm BLOCKED rather than treating an anonymous/ACL404 as missing-byte proof.

| Category | Actual route / source semantics |
| --- | --- |
| Campaign141 | `/api/stickers/:id/content`: requireAuth, campaign/pack lifecycle/consent/visibility or historical-message ACL, then file read. Missing file returns404 `STICKER_NOT_FOUND`; same404 can mean denial, so independently establish authorized DB predicates |
| Chat31 | `/api/chat/attachments/:contentId/content`: requires joined chatAttachment/upload/thread and campaign plus uploader/DM-participant access; missing file404 `NOT_FOUND`. Unattached upload has no route reachability and remains filesystem-only missing evidence |
| Feedback1 | `/api/operator/feedback/:id/attachments/:attachmentId`: requireOperator, exact report/attachment, MIME allowlist and safe basename; missing file404 `ATTACHMENT_NOT_FOUND`. Unsupported MIME415 or unsafe path500 is a distinct earlier gate, not file absence; do not waive it |

Report HTTP expected-unavailable as **observed missing content**, never “recovery PASS”. Record status/error code/eligibility truth values with pseudonymous IDs; no report text, storage keys, contact data or attachment bytes. Actual500/unexpected200 requires stop/diagnosis; do not mutate records or synthesize matching files. Preserve total173 unresolved even if only3 representatives were reachable/probed.

## Process ownership, invariants and result

Only after root reviews and assigns execution: launch the ignored harness hidden (`Start-Process -WindowStyle Hidden`), environment supplied programmatically, exact cwd/command without secrets, private logs and unique receipt. Capture PID/start time/entry hash; verify ONLY127.0.0.1:14185 listener belongs to it, not0.0.0.0 orIPv6 wildcard. On mismatch, close only that owned process; never stop14182/currentDB. Fail-closed startup must run targetOID/media guards before listen or any write.

At end/failure, graceful harness close → io/client shutdown → verify14185 listener gone. If grace timeout, verify original PID+creation time+entry identity before terminating that exact owned process only. No blanket node/taskkill/process-name cleanup. Retain disposableDB/media/receipts; do not drop/delete them. Verify restored manifest unchanged, domain/journal/storage fingerprints unchanged, only authorized sessions/audit delta; record currentQA controls per coordinated window. A mismatch invalidates isolation/readability gate pending diagnosis.

Checkpoint must contain: actual source/export identity and composition hash/diff; targetguard PASS; exact process lifecycle; env-policy nonsecret summary; catalog count;139 body/hash/decode results; auth ACL counts; missing-category eligible/probed/blocked counts; invariant deltas; logs/receipt hashes; no raw secrets. Final verdicts separately: `scoped restored global139 readability PASS/FAIL/BLOCKED`; `173 recovery NOT PASSED`; `stock-entry/bootstrap NOT TESTED`; `production/release NOT READY`. Root reviews once at connected gate and alone updates Linear.

## Planning checkpoint

Changed only this new plan. Verified read-only: paired/local recovery and release evidence, current HEAD, env/index/seed/auth/storage/routes/global catalog/operator route sources. No private input read, launch/browser/install/data mutation/Linear/commit/remote. Concrete next prerequisite: root-reviewed fidelity composition + existing restored-identity authorization and target/media guards, then one Luna HTTP/payload pool. No generic auth implementation or broad new E2E suite.
