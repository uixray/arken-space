# ArkenHar local build candidate — 2026-10-09

## Status
Private local **interim diagnostic bundle only**. Not deployable; not a production/release gate. No deployment, remote operations, DB credentials, or auth were used.

## Build evidence
- Workspace command: `pnpm -r --workspace-concurrency=1 build` (root `pnpm build`).
- Result: exit 0; full build log: `.data/qa-prep/release-candidate-20261009-current/build-full.log` (SHA-256 `45E600F0C85EB61CD829B13D6B9AB805E7E0C7B63F21851B37EE6608C839EDAC`).
- Build included web, server, contracts, db, and system workspaces. Vite emitted the existing large-chunk advisory (~1.16 MB JS).
- Initial launch was at baseline `abbfa7d`; root subsequently committed docs-only `6634d65`. At capture, current HEAD was `6634d65c11cf17c0abbc93342a43baf35c5c2590` and tracked `packages/db/src/schema.ts` is now modified (SHA-256 `9B36C9373ECD777F65F0C0F68E5BA26D4E79720CB1775B6320A455EE92C5958E`). Current status: ` M packages/contracts/src/index.ts
 M packages/db/drizzle/meta/_journal.json
 M packages/db/src/schema.ts
?? .tmp/
?? packages/db/drizzle/0048_terrain_stamp_instances.sql`.
- Therefore this is **not asserted to represent an exact clean 6634d65 source boundary**. Backend work is in-flight; no final candidate claim.

## Retained artifacts
- `.data/qa-prep/release-candidate-20261009-current/artifacts/` contains web/server/contracts/db/system distributions and package/workspace metadata; `artifacts-manifest.json` SHA-256 `8C5160D5A6341AD77E2615C51D26824F741DC185CD96234BDEF2088A97064621`; files: 32.
- ZIP: `.data/qa-prep/release-candidate-20261009-current/candidate-artifacts.zip`; SHA-256 `E1F3A781DB752B5F1CDA6912DA7D87E5591695EED86F482081DE7107200B43FC`; bytes 4634734.
- Archive extraction comparison: PASS, 32 files SHA-256-equal; receipt `.data/qa-prep/release-candidate-20261009-current/archive-roundtrip-receipt.json`.
- Sandbox attempt failed on PNPM managed-version junction EPERM; the successful existing-dependency build used the approved elevated local command. No install command was run.

## Limitations / next action
This bundle preserves successful build output and roundtrip evidence, but its source boundary is invalidated/uncertain due concurrent backend edits. Do not use it as a current-source candidate. After the backend owner declares a short freeze, run one clean build/capture with tracked source start/end hashes and produce a separately named final interim bundle; never overwrite this archive. Later product integration will invalidate that candidate and require another build for release use.

