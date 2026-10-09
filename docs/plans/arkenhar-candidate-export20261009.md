# ArkenHar candidate source export — 2026-10-09

## Immutable local source artifact (not release acceptance)
- Candidate commit: `f67e53b7453a79230624d1ca2e228e5f3b35d928`.
- Git tree: `589d9c899996f60b094ebdcdaafbf694a7d790f5`.
- Product evidence source: `52013d43e6f2fca1bb268c38608afde9cd76424a`; `apps/`, `packages/`, `infra/` have zero changes from that source to the archived commit. Subsequent work in this pool is documentation/QA helpers only.
- Command: `git -c core.fsmonitor=false archive --format=tar --output=<ignored artifact> f67e53b7453a79230624d1ca2e228e5f3b35d928`.
- Artifact: `.data/qa-prep/rc-source-f67e53b7453a79230624d1ca2e228e5f3b35d928.tar`, 26,705,920 bytes, SHA-256 `9B9C24AD95F56ABE93F5DB490AE3DA6EF6CFE84346225835D70260431C547579`.
- Archive listing checked: 1,335 entries; zero `.data/`, `.tmp/`, `.git/` or `node_modules/` entries. Only committed files are included. Private QA credentials, receipts and unrelated dirty/untracked work are not packaged.

## Evidence limits and concrete release blocker
- This is an immutable source export, not an independently installed/built release artifact or clean production checkout. It does not package ignored sticker/media data or database rows. Those require a separately tested import/recovery gate.
- Local tracking ref `origin/main` currently resolves to `9d441bdfca9325ca1b0de273f5b40360821df53d`. `git merge-base --is-ancestor <candidate> origin/main` returned exit 1: candidate is NOT included in that local main ref. No fetch, push or merge was performed. Current remote state is not independently verified.
- Production release tooling's main-ancestry criterion is therefore not satisfied. Do not amend that criterion silently, bypass it, or request deployment as though it passed.
- Known exact-source focused tests/typecheck/build and A/B browser evidence remain indexed by the continuation checkpoint. Full legacy E2E is owner-excluded, not green; native/human, complete registry, recovery/migration anomaly and deferred authorization remain separate gates.

## Checkpoint
- Decisions: source-only, immutable/exclusive artifact; no private files; keep release gate unaccepted.
- Changed files: this new note; ignored archive only.
- Verification: archive creation exited 0, exact commit/tree/hash/size/list checked, source delta empty, local ancestry check exit 1.
- Blockers: accepted RC-wide QA/recovery/auth and main ancestry; external publication/remote/deploy authorization absent.
- Next: consume the bounded scene diagnostics and disposable recovery receipts, then assemble the release dossier. Push/merge and remote work remain separate owner-authorized gates.
