# ArkenHar local build candidate — 2026-10-09

## Identity and scope

- Source revision: `76fc9cccaafe5dd6795fb4f7c33344990d39eed0` (`git tree 9c3d53904ce32d90bb74615cc7d5218ce3dedf47`).
- Captured the already-built outputs after the owner-authorized gate; **no rebuild** was run during capture.
- Source state was identical at capture start/end: same HEAD/tree and `git status --porcelain` (`.tmp/` and untracked `apps/web/src/renderers/map-ping-motion.ts`). The latter is an unrelated, unintegrated file and was not included in the bundle. No other source changes occurred during capture.
- Local capture directory: `.data/qa-prep/release-candidate-76fc9cc-20261009/`.
- Archive: `.data/qa-prep/release-candidate-76fc9cc-20261009/release-candidate-76fc9cc.zip`.
- Capture inventory and state: `.data/qa-prep/release-candidate-76fc9cc-20261009/capture.json`.

The payload contains 119 files (28,344,277 bytes): `apps/web/dist`, `apps/server/dist`, protected `apps/server/assets`, `packages/contracts/dist`, `packages/db/dist`, `packages/system/dist`, the full `packages/db/drizzle` migration history (SQL, journal and snapshots), root/package manifests, `pnpm-lock.yaml`, workspace metadata, and the web/server Dockerfiles. The archive is 13,317,150 bytes, SHA-256 `6202693dc2bd98764a60d816ef8bedd6a9999f89db7da366f16254d240f82acc`.

The archive was extracted to `roundtrip/`; all 119 relative paths and SHA-256 values matched the captured payload (`ROUNDTRIP SHA_MATCH=True`). `payload/MANIFEST.sha256` holds the per-file checksums. Start/end source identity comparison passed.

Protected built-in asset hashes in the captured server assets:

| Asset | SHA-256 |
|---|---|
| `terrain-stamps/clouds.png` | `33bfb93b976b037c210168f8a06dfae85cad66cb943a949c82b363d29e0a8c68` |
| `terrain-stamps/forest.png` | `57c842857c679b9f35be627fadf0af66fad83c0b89dde16c8b54d05dfa51ef66` |
| `terrain-stamps/mountains.png` | `11e99bfa773f7e1fd72e67b76d9dc79180ac9de93d7ddb935ca4e472e7080f6c` |

## Verification evidence

Root-reported connected verification on this source revision: the previously failing Firefox guide navigation cell passed on replay (1/1); full-workspace/config typecheck and full-workspace build passed (terminal session `86727`, exit 0). The earlier 30/30 unit run and 19/20 browser receipt belong to `bf64877` and are intentionally **not** relabeled as complete same-SHA coverage here. Only the failed Firefox cell was replayed on `76fc9cc`; a new 20/20 browser run on this exact revision is not claimed.

## Boundary

This is a local source/build-artifact bundle, not a deployable container/image and not evidence of a live server, production database migration, or production behavior. No server was started, no DB was migrated, and nothing was deployed. The archive does not contain private fixtures, `.env` files, QA databases, or `.tmp` contents. The older `release-candidate20261009-current` archive was left untouched.
