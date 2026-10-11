# Candidate package preparation — 2026-10-10

## Checkpoint

- Source: `4cf493269a97c48b9c848d50c9b822a7996f7cb6` (tree `a63b7baebf72a628e199637c32d29373deea6cb7`). Original application bytes are `8916874`; no source files changed in this package-preparation task.
- New ignored staging root: `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010`. It is ignored by Git; previous R5/package artifacts were left untouched.
- Server context: 203 positive Git-blob members; context digest `903302e7f855a2f8aae9c01464295cc614cbcd716a42ebd1b0541e80794bd26d`.
- Web context: 342 positive Git-blob members; context digest `1c12db08a77d99dafb5bb73ce485aa74bb061614aed9ff8ff01fac0feaa947bf`. One additional local-only Pragmatica WOFF is injected at `apps/web/public/assets/pragmatica-next_vf.woff` (343,264 bytes, SHA-256 `7b4e50ec50c782077ee147ca5d8db8c4843bc7dd72ff8f133c2458e45347252d`); it is not part of the Git member allowlist.
- Font equivalence: verified same Git blob `3a7db1567dce024533d70a33c0f9695b1609109d` in candidate 4cf and audited source `8916874946a55cc719fa72f301630aa1ec0dd706`; root-provided public export record says WOFF is excluded. No font was copied into tracked source or GitHub export.
- Allowlist basis: prior R5 exact context manifests plus the three newly added production files between R5 and 4cf (including migration 0057 and its Drizzle snapshot). All 16 changed test files in that delta are excluded; context helper exports immutable Git blobs only. No database/media dump, rendered env, private campaign payload, author fixture, or tests included.
- Public config templates: `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/public-config`; domain `andreykindesign.pserver.space`. Values staged: auth=true, registration=false, mail runtime=false, campaign link access=true, legacy dev auth=false, campaign creation=false (no new grant). TLS, host paths, private DB/volume values remain placeholders/unverified.
- Package status: **preparation only / NOT ready**. Image IDs unset; no Docker build, load, browser/host acceptance, restore rehearsal, deployment, push, or runtime validation performed here.

- Superseded after preparation: follow-up release-config/font-gate source edits make these exact source contexts stale for builds. The staged target hostname `andreykindesign.pserver.space` is also superseded by the owner's newer `arken-khar.space` decision (DNS A 51.250.26.16, no DNS change performed). Preserve this 4cf staging as historical; make a fresh context/package at the next frozen source SHA using `arken-khar.space`.

## Next bounded action

After owner/root releases the build gate, build sequentially from the staged contexts (no `--pull`, no source checkout build):

1. `docker build --pull=false -f Dockerfile.web -t arken-web:qa-4cf4932-20261010 .` from `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/web-context`.
2. Only after web build completes, `docker build --pull=false -f Dockerfile.server -t arken-server:qa-4cf4932-20261010 .` from `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/server-context`.

Then record immutable image/config IDs, export archive receipts, and keep readiness false until the separate approved load/runtime/host gates pass. No image identity is asserted by this checkpoint.

## Files

- `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/server-context` — server build context.
- `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/web-context` — web build context plus local ignored font injection.
- `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/server-context-manifest.json` and `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/web-context-manifest.json` — positive members and SHA-256/bytes.
- `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/context-preparation-receipt.json` — source/context/font/config status.
- `C:/Users/UIXRay/.codex/worktrees/uix-512-soundpad/arken-space/.data/qa-prep/new-server-candidate-4cf4932-20261010/public-config/` — compose, runtime-env example, and gateway templates only.

## Latest context refresh — 2026-10-10

- Source commit: `8ca8fccd2c9afe4481e9c948f87462733ca780da`; tree `fb28510022a1e3352f12c8453f02303ad0f95609`.
- New ignored candidate staging: `.data/qa-prep/new-server-candidate-8ca8fcc-20261010` (historical 4cf staging preserved).
- Server context: 203 Git-allowlisted files; context SHA-256 `b00fc7f227e702fc7ccff9fc69a7af7386608dcbe01de0cc29a0480bdc3c1828`.
- Web context: 343 Git-allowlisted files, including `scripts/font-release-preflight.mjs`; context SHA-256 `f884a0c4f1c65a1a6dac16f78dffdeacfa6e9e1fc6e4f68acbd830884e78e958`. Local-only font injection matches the audited Git blob: 343,264 bytes, SHA-256 `7b4e50ec50c782077ee147ca5d8db8c4843bc7dd72ff8f133c2458e45347252d`; excluded from public Git history/export.
- Fresh public configuration templates target `arken-khar.space`; auth enabled, registration/mail/legacy dev/campaign creation disabled, campaign-link access enabled. TLS, host, and database values remain placeholders.
- **Preparation only / NOT ready**: image IDs unset; no build, Docker, load, host/browser acceptance, restore, or deployment performed. Context receipt and member manifests are under the ignored candidate staging directory.
