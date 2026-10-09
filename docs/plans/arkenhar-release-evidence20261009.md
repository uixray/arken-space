# ArkenHar release evidence index — 2026-10-09

Publication is **NOT READY / NOT ACHIEVED**. This index preserves full scope; local gates do not authorize remote/start/access, push/merge or deployment. Owner/friends service still requires proper public authentication at the owner-approved time, not secret-link substitution.

## Candidate identity
- Inspected HEAD `30bbb5b57456ce7f0345c44547bc46d2b084351c`, tree `4c0e4715a35a73e93fc83b7b079cd9bdff63e0fd`.
- Last product edit `52013d43e6f2fca1bb268c38608afde9cd76424a`; `git diff 52013d4..HEAD -- apps packages infra` has no changed paths. Later commits are documentation, not a newly built release.
- Live API14182 health200 reports `3ed0f51966e0c547b33311387c10e52f4e42391f`; frontend14183 `/healthz` is a proxy to that API, **not web identity**. Root verified no server/packages/infra source delta from that API revision to HEAD. This bridge is source equivalence, not proof of a fresh API image/build.
- Web is current-worktree Vite dev source, not the release build. Persistent session74117 verified live; PID11648 established by its launch and previous listener audit. No static built-candidate smoke yet.
- `.tmp/` and private ignored `.data/` are excluded from staging/release packaging. Existing export at f67e53b remains historical, not a current built package.

## Gate matrix / authoritative evidence
| Requirement | Evidence / remaining limitation |
| --- | --- |
| Candidate typing | Full root `pnpm typecheck` exit0 at857c426; all workspace packages and E2E/config TS compilation. No product delta to inspectedHEAD. Ignored log SHA `15F45213E8B93A800FF7243659DE09A6606990B635FF18C5BEBF5729E71CF3FC`. Not E2E execution. |
| Escape repair | Product52013d4; owned summary held/fresh Escape gate,25 tests/webtypecheck/4 browser cells/build0 in `uix644-global-manager-escape20261008.md`. Native OS popup passthrough only unit evidence. |
| UIX644 full controls | `uix-644-runtime-coverage.json`:50 buckets/92 occurrences; historical27PASS/2FAIL/21BLOCKED, overallINCOMPLETE. Scoped scene/character selection evidence in `uix644-select-contract-gate20261009.md`; intermediate keyboard focus and whole six-control/registry lifecycle unproved. P1 working checkpoint preserves harness failures, not product defects. |
| Causal ResizeObserver | Historical exact exports/locked offline install/own builds proved in `uix644-ro-preparation20261009.md`; single-case isolated comparison pending. Original FAIL not waived by NONREPRO. |
| Global24+115 catalog | A/B GM/PLAYER visibility and same-campaign realtime/image decode scoped proof in `uix497-crosscampaign-runtime20261008.md`. Creator mutation-denial runtime, human content acceptance and production import/publication remain separate. Prior429burst preserved. |
| Migration | Disposable pre0047 restore + official migration exit0, journal/constraints checked in `arkenhar-local-recovery20261009.md`. Historical wrapperexit1 cause unknown; successful disposable run does not rewrite old verdict. CurrentQA migration not retried. |
| Full paired recovery | Captured DB and139 available blobs restored faithfully;173 referenced objects absent from proven active root. `arkenhar-paired-recovery20261009.md`. No proven historical paired source; owner exact-source request pending. Full DB+media recovery NOT passed; no reconstruction/deletion to green. |
| App-readable restored service / rollback | Isolated app-level readability and complete failure/import rollback remain unproved; DB/file hash checks alone insufficient. |
| Native popup / true zoom / human GM+6 / content | `arkenhar-human-acceptance20261009.md`, allNOTRUN. Actual browser chrome/OS popup/humans required; compact emulation not substitute. Localhost is not remote friends access. |
| UIX318 operator trust | Live Linear InReview; dedicated ACL/privacy local evidence does not prove stopped production host identity. Independent host verification + explicit remote preparation permission required. |
| UIX473 real nine reports | Live Linear Backlog; real current production queue/triage not inspected. Historical issue text/synthetic QA is not evidence that actual reports were read or updated. |
| Proper public auth / first-run | Owner-deferred, not implemented/accepted. Legacy invite/member fixtures are QA access, not registration or MyCampaigns. |
| Main ancestry / package / production | Candidate not verified on main; last local ancestry failed. No fetch/push/merge permission. Fresh exact built artifact/server image/static smoke, trusted host/backup/rollback and separate deployment permission remain release gates. |

## Next connected work / checkpoint
- Root integrates Luna P1 offline bookkeeping repair before another runtime gate; no more blind locator retries. One RO comparison remains separately owned and mocked/fail-closed.
- After browser/source pools freeze: fresh exact full build/package and served built-candidate smoke; restored app readability/rollback; then concrete owner decisions on missing media, human/auth timing and later main/remote scope.
- Changed only this index. Verification: current Git/tree/source deltas, live API/proxy whitelisted revision and persistent frontend handle; prior exact receipts linked without transferring broad acceptance. No data/remote/product/source/deploy action here.

## Current gate update (supersedes pending statements above) — HEAD1048256
- Fresh full workspace build at691d352 exit0, retained 23distfiles/archive roundtrip hash-equal. ArchiveSHA4AE3392A21F536A202EE7B7080350961289207EDFCBCE4704556D55A81258AC0; manifestSHA D612D53B76084F151AA1E60EFA483C3FFB83CFD3C7809E6ECE23EF3C37B8DA4B. Private diagnostic package, NOT deployimage/share-approved artifact.
- Served retained web static bytes: all11files200/hash/size/MIME matched;3HTMLreferences verified; no source/HMR entry. ReceiptSHA c095ff92ab899069120b9b868fd97b506dfb34ef51ba90d89c7694fa29fc64b0. Isolated preview14233 closed; authenticated built-browser smoke still NOTRUN. Current dev Vite remains separate.
- Native DOM selects:24/24 across four GM Chrome/Firefox desktop/compact cells, sixcontrols each; receiptSHA9B845600F6302075B5D6D444766FE6C6119582D7499896B4C8386A3A1D117464. Not native OS popup/keyboard/zoom acceptance; operator403/bootstrap401 not waived.
- Paired historical RO comparison actually completed: focused first-open NONREPRO (botharmsPASS), receiptSHA F8F7D758599F18B7F0934FC7358727C87FB9AD024B340E35AF1B82CAA3A72949. Original ROFAIL remainsOPEN, no one-line causal inference. Comparison listeners stopped.
- Per-file provenance initial browser: Chrome desktop localfile/change/restore/focus/cleanrow/serverunchangedPASS; wholepoolSTOP1/4 on blocked nonlocalGET, receiptSHA29C9CD3FCCD6FFDFD704ACB9603D49E3E7DF0063FE2E18E0741ADEF0BD148658. Remaining3cellsNOTRUN;0domainwrites/attempts. One retained syntheticNPCemptyDRAFT createdofficial201; fresh prewrite backup missing (postwrite validated archive cannot substitute).
- Restored target sameclient identity read-only preflight matched exactdisposableOID26493; eligible existingGM/PLAYER grants found privately. Media hash/composedharness readiness in progress; no APIlisten/auth/sessionwrites yet, operatorallowlistmissing. Fullrecovery173missing unchanged.
- Goal ACTIVE / publication NOTREADY. Current all-evidence scope is not fullreleaseacceptance; properauth/human/remote/main/rollback remain outstanding. Latest entry checkpoint is arkenhar-goal-checkpoint20261009.md; following Astra built-candidate and restored-readability plans. No production/push/merge.

## Served built-browser evidence update — 2026-10-09
Actual retained built candidate (691d352/product52013d4) now has4/4namedcore checks in GM/PLAYER Chrome/Firefox desktop via the explicitly adapted local Origin edge. Auth/bootstrapexistinggrant identity, global24/115representative image decode, Socket.IO serverconnectack, GMheld/freshEscapeparentcontract and PLAYERpicker139focus/Escape/reopen are proved by union receipts C4F8D903504F1EA09610E9C2716BF9F08CB0F3C11837A2423B077C0EFC3183F3 (acceptedFirefoxPLAYER) and C536CC6B9EF308073405646D576C27C5455494C6DA4809945563A76B3E189307 (remaining3cells). Overall browsergate PARTIAL due blockedexternalfont and retained401/403/error evidence; no actualnative/zoom/human/publicauth/productionCORS proof. Ownedpreview14233 closed;0domainattempts infollowup. See arkenhar-built-candidate-smoke-prep20261009.md. Fontsource located at GravityUI remoteInter import; owner fontcontract choice pending. RollbackGate0 preparation onnewtargets next, currentQA andrestoredOID26493 retained.
