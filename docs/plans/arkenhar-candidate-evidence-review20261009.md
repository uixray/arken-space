# Astra candidate evidence review — 2026-10-09

## Scope / verdict

Read-only bounded audit of `.data/qa-prep/release-gate-2c35435-20261009/`: build manifest/checkpoint, server/web context manifests and archive metadata. Reviewer owns this document only; no build/container/source/network/DB action. Runtime worker is active separately; `runtime NOT RUN` in build receipt describes the build pool, not a permanent current project status.

**Identity/context/build-artifact evidence is coherent. Runtime/recovery/publication acceptance remains separate.** No reason to rebuild/re-export unchanged candidate merely to repeat approved checks.

## Independently checked here

- Both manifests name SHA `2c35435643e09a4dbbcb041889dbc727070536f0` and tree `07f69e1d38559679df649de7415cdd55ed726bbe`.
- Exported positive path arrays exactly equal approved source reconciliation arrays: server192/web316 (508 records total); forbidden test/spec/pg-probe/test-support/fixture/env/key patterns absent. New auth/runtime/contracts, migrations0049–0053/journal, local WOFF and guide assets included by approved lists. No dirty-source overlay or mixed ACA component indicated.
- Saved archive sizes match manifest: server191324672 B, web23671296 B.
- Read tar `index.json` and digest blobs **without extracting files or loading containers**. Server archive references OCI index `sha256:a62a4c574f8f625f073c701a3c1b1d64ec6ace25b2405578c23d6ae605fda151`; web references `sha256:64aa62e1424005314b81d2af78385ab522d42077bbd92a8ca1aae7796b1b3c5e`. Both referenced index blobs hash to those exact IDs. Docker compatibility manifest has one image entry and RepoTags=null (saved by immutable ID); config digest differs from OCI index ID as expected, not identity mismatch.

Root's separate evidence is relied on, not rerun here: `root-context-verification.json` records every508 exported file byte/hash match; `root-server-image-verification.json` records Docker image ID/size inspect; root reports both archive SHA256 checks PASS. This reviewer did not repeat full508 hashing or large archive hashing.

Authoritative archive hashes from machine manifest/root receipt:
- Server: `5d535d7cef294d2ba81f1ae9c11555ac3559e8a7c6975a588b65bb273ca0e757`.
- Web: `408cc1092cd1c38ef2838244d7811f88aa4aa5dfbdb295a610ba86a795aaeb5d`.

These identify retained immutable bytes; any replacement requires a new artifact identity, not overwriting this receipt.

## Build/network truth

First server `--pull=false --network=none` probe failed: Corepack pnpm10.12.1 was not cached and registry DNS failed. **Fully offline build did not pass.** Root subsequently authorized bounded existing Corepack/frozen-lock dependency downloads inside two image builds, and both completed with pull=false/no host install/no dependency or lock changes. Correct description is **cached base images + separately authorized network-enabled frozen-lock build**, not offline build or zero network use. RUN network was enabled in the successful build; manifest records purpose authorization, not packet-level proof that only package hosts were contacted.

Checkpoint's final blanket “Production, external network, provider and deploy: NOT RUN” is overly broad when read literally. Interpret/correct documentation to **external runtime/provider/production/deployment NOT RUN; dependency network used under separate authorization**. Also “only server attempted/no image exists” paragraphs describe historical failed probe; later success supersedes them. Machine-readable manifest correctly distinguishes both attempts.

Vite >500KB advisory remains; successful build is not performance acceptance. Build manifest records exits/package counts, but raw successful build logs/log SHA/timestamps are not present among inspected root files. If durable command provenance is required, retain sanitized existing execution receipt/log identity; do not rebuild only to manufacture a retrospective log. Source manifests + image archive linkage are established; bit-for-bit rebuild reproducibility/SBOM/vulnerability acceptance are not claimed.

## Privacy boundary

Positive contexts exclude private runtime DB/media/env/keys/test fixtures; removed historical test-support paths stay excluded. Retained server seed implementation is existing required source, so account-mode startup/no-seed must be proven at runtime. This path audit is not a comprehensive semantic secret scan of every code/string or dependency layer, nor authorization to publish source/image archives. No DB dumps or keyring files belong in shareable image manifest; recovery evidence remains private separately. Current archives retain dependency/source layers per frozen Dockerfiles; source-context privacy and public redistribution approval are distinct.

## Concrete next runtime evidence (avoid redundant checks)

Use these exact image IDs, no rebuild or broad regression rerun:

1. Fresh disposable PG migration ledger through0053 and explicit account-mode/no-seed: zero campaign/member/user fixture counts before synthetic insertion; actual API DB health revision, not nginx static health.
2. Synthetic fixture-provisioned account/campaign/scene/media FK/outbox; real account login/select/bootstrap and A/B denial. Fixtures marked directly verified do not prove external mail verification. Actual TLS/browser Secure-cookie flow separate from HTTP cookie replay API proof.
3. Upgrade from ACA migration-only0048 without index/seed: stable legacy IDs/ownership, nullable account binding unchanged, historical sessions denied under new mode.
4. Quiesced post-upgrade DB+media snapshot, restore into another fresh volume, full ledger/count/reference/media digest comparison including users/account/outbox; known/unknown-key behavior with fake-only mail, no real provider.
5. Stop/restart exact current image and restore persistence; SIGTERM exit/OOM/shutdown evidence. DB-stall fallback must not be described as guaranteed graceful shutdown.
6. Pre-upgrade tuple restore for rollback. Old binary on upgraded auth schema is not accepted rollback. Old-runtime startup seed-safe strategy remains an explicit limitation; do not infer rollback from restored DB count or candidate restart alone.
7. Built web static assets + real browser/account/socket/media smoke on approved local TLS/gateway; queued wording/no-store observable. Source/component mocks and earlier PG tests cannot substitute for current image runtime.

No repetition needed: prior allowlist reconciliation, every508 exported-byte checks, exact archive hashes, identical image rebuild, or full backlog audit. Repeat only affected gate after changed bytes/config/fixture, identifying new receipt. Root/runtime worker supplies named PASS/PARTIAL/BLOCKED results; runtime facts were not verified by this audit.

## Checkpoint

Decision: artifact identity audit accepted at bounded evidence tier; successful build was network-enabled under separate dependency authorization. Changed only `docs/plans/arkenhar-candidate-evidence-review20261009.md`. Verification: local manifests/path equality/archive OCI metadata+digest, root byte/hash receipts relied on explicitly; no containers/build/DB. Blockers: runtime worker outputs pending, actual recovery/rollback/browser/mail/provider/production gates not established by image build. Next: integrate runtime receipts against exact pair and preserve historical ACA artifacts; no publication/deploy approval follows.
