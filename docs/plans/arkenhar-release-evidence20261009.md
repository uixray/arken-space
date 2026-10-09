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
