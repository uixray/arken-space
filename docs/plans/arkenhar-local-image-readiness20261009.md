# Local image readiness — ArkenHar — 2026-10-09

## Result

**Local Docker image build and isolated runtime-preparation gates passed** for the exact `76fc9cc` contexts. Docker is installed and the daemon is available via approved elevated access. No image was pushed and no remote or production server/database was accessed.

- Docker Desktop `4.87.0 (236836)`, Engine `29.7.2`, `linux/amd64`.
- Unprivileged `docker version/info` could not open `dockerDesktopLinuxEngine`; elevated read-only `docker version/info` succeeded.
- `nginx:1.27-alpine` resolved to `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`; `node:20-bookworm-slim` was pulled during the explicitly authorized local builds and resolved to `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`.

## Dockerfiles and exact-SHA contexts

Inspected `Dockerfile.server`, `Dockerfile.web`, root workspace/lock metadata, server environment schema, and the Nginx config. Prepared two context archives and extracted context directories solely from committed source SHA `76fc9cccaafe5dd6795fb4f7c33344990d39eed0` (tree `9c3d53904ce32d90bb74615cc7d5218ce3dedf47`). The live checkout had advanced to `094824eef0d6d68f54a31e62ba26f3b6b9cf1b58` with UIX-264 edits in progress; those edits were not read into or copied into the frozen context.

Location: `.data/qa-prep/local-image-readiness-76fc9cc-20261009/`

| Context | Dockerfile | Files | Bytes | Archive SHA-256 |
|---|---|---:|---:|---|
| `server/` / `server-context.tar` | `Dockerfile.server` | 173 | 15,691,444 | `6047bcba2de7ee5cd52421a2aff76cb8bcb81e0b9a4e5ed28f0f6de0bd86bafa` |
| `web/` / `web-context.tar` | `Dockerfile.web` | 309 | 4,660,032 | `d7051fa96d3d8b665d5ca94cefd3ae28f64e36a3e23083f9bae22b33f1ba9671` |

Per-file SHA-256 manifests are beside each context (`server-context-manifest.sha256`, `web-context-manifest.sha256`); context metadata and source identity are in `context-metadata.json`. The server context includes protected terrain-stamp assets and the complete DB migration SQL/journal/snapshot set. The web context includes the local font, public UI assets and `infra/nginx/container.conf`.

The contexts were allowlisted from `git archive` and checked for private/test paths: zero `.env`, `.tmp`, `.data`, test, fixture, storybook, `.pem` or `.key` paths were present. The full workspace, QA data, private fixtures and current uncommitted UIX-264 changes were not passed into either context. The package lock/workspace manifests are included. The context directories are the future `docker build` roots; the adjacent `.tar` archives are retained provenance copies, not build inputs.

## Local image build and static contents

Both local image builds completed with exit 0 from the contexts above:

| Tag | Image ID | Image size | Build wall time | Saved Docker archive / SHA-256 |
|---|---|---:|---:|---|
| `arken-qa-web:76fc9cc` | `sha256:e6749f37484461a3f9960f825805f95d542e9eddcfdd0e3a2d8aac9adad4e9f1` | 25,006,838 B | 80.02 s | 25,027,072 B / `6583b4b689acfb5398c95da053ebffaa9ee35d91bd037b1ce7601fd1590f1260` |
| `arken-qa-server:76fc9cc` | `sha256:f551e09e7ffaa31a7c5ecf05d45e2efdf166ff40d8e1ff9ea72c1796a57e9ec2` | 191,092,033 B | 121.05 s | 191,117,312 B / `d0a28f5351c0ae33a0d8aeb01e78596f266b3187ff11095c922604ee4efcb212` |

Docker build logs are `logs-web-build.txt` and `logs-server-build.txt`; `images/docker-save-receipt.json` records IDs, archive sizes, hashes, and save durations. Images were saved locally only; no push. The web build emitted the existing Vite warning that a minified chunk exceeds 500 kB.

Read-only copies from the built images matched the exact-context files by SHA-256:

- Server-protected PNGs: forest `57c842857c679b9f35be627fadf0af66fad83c0b89dde16c8b54d05dfa51ef66`, mountains `11e99bfa773f7e1fd72e67b76d9dc79180ac9de93d7ddb935ca4e472e7080f6c`, clouds `33bfb93b976b037c210168f8a06dfae85cad66cb943a949c82b363d29e0a8c68`.
- Web font `pragmatica-next_vf.woff`: `7b4e50ec50c782077ee147ca5d8db8c4843bc7dd72ff8f133c2458e45347252d` (343,264 B).
- Copies and hashes are retained under `.data/qa-prep/local-image-readiness-76fc9cc-20261009/image-content/`.

## Isolated runtime, migration, backup and routing checks

Only uniquely named local resources were used. PostgreSQL had no host port; app ports were bound only to `127.0.0.1`. A synthetic random DB password and GM token were used; their temporary `.env` files were removed after the run. No production/retained QA credential or data was used. All created containers are stopped but retained; own networks, volumes and images remain. No unrelated container or volume was changed.

- Disposable PostgreSQL `postgres:17-alpine` became healthy in 8.19 s on a private QA Docker network. Server image startup migrated its fresh database; `/healthz` returned 200 (`database=ok`, revision `76fc9cc`) in 10.59 s. The database contained 49 Drizzle migration rows and 59 public base tables.
- One synthetic campaign row was added to the disposable DB. Custom-format `pg_dump` took 0.82 s (244,896 B, SHA-256 `b0139233ef04a9afa2b56c2bce84d6398ec621bea05a39977d40cac27712024f`). Restore to a second fresh disposable DB took 2.90 s; it matched 49 migration rows, 59 public base tables and the one synthetic row.
- A 113-byte synthetic file was written through the original dedicated media volume, copied out, ZIP-archived/extracted, then copied into a separate restore-server media volume. SHA-256 matched at every step: `9039ffddfeb960bc946485baadf50feaca53dfd2ec085b38b8679597043b2a44` (ZIP SHA-256 `8e813be6ce1ef484403600b2a2a34e6deb00c7ffe72d685678fcdc0fbdb06977`).
- The server image then started on the restored DB with the distinct restore media volume. It reached `/healthz` 200 (`database=ok`) in 6.29 s, with 49 migrations / 59 tables / the same one synthetic row; startup did not add migration rows. This proves recovery into a fresh DB/volume, **not** a schema downgrade or migration rollback.
- Standalone web container checks: `/healthz` and `/` returned 200; the Pragmatica WOFF returned `200 font/woff` (343,264 B). Its `/api/bootstrap` path returned SPA HTML, not a proxied API response; the standalone web Dockerfile is static-only.
- A dedicated loopback-only edge container used the exact-commit `infra/nginx/e2e-edge.conf` mounted read-only (SHA-256 `353075783ee0576fb51a208e617ae3fc315d4aa390c1f9ddab0a1e4e06d5996e`). At `127.0.0.1:14376`, edge `/healthz` returned 200 with revision `76fc9cc`, `/` and the WOFF returned 200, no-auth `/api/bootstrap` and `/api/terrain-stamps/assets/forest` returned JSON 401, and a Socket.IO polling handshake opened (HTTP 200; session ID redacted). This validates the local test gateway topology, not a deployed edge/proxy.
- The static web asset path for terrain stamps falls back to SPA HTML, not image bytes; the protected server asset route denied unauthenticated reads with 401. No authenticated GM/PLAYER content request was made.
- Startup initially returned transient curl empty replies while the restored server was warming; it reached health 200 without restart. Probes were local HTTP only; no browser/human test was run.

Runtime receipts/logs are in the `.data/qa-prep/local-image-readiness-76fc9cc-20261009/` folder (`server-runtime.json`, `restored-db-runtime.json`, `backup-restore/receipt.json`, `backup-restore/media/media-backup-receipt.json`, `http-static-auth.json`, `edge-runtime.json`, redacted server log). Reports do not contain credential values. The local stopped containers retain only synthetic environment values in Docker metadata; the temporary local env files were removed.

## Build/run constraints observed

- The server image builds contracts/system/DB/server and copies `apps/server/assets`; its container command runs `pnpm db:migrate` **before** starting the server. Image creation alone does not establish migration safety or runtime readiness.
- The web image builds the SPA, then copies it into Nginx. The Nginx config serves static files/SPA fallback and `/healthz`; it has no server API proxy route in that file.
- Runtime configuration uses names such as `DATABASE_URL`, `GM_ACCESS_TOKEN`, `WEB_ORIGIN`, `PUBLIC_URL`, `BUILD_REVISION`, and `MEDIA_ROOT`. Values were random synthetic runtime-only data, not shown in output or reports; temporary env files are removed.
- The standalone web image is static and needs a separately provisioned edge/reverse-proxy topology for same-origin API and WebSocket routing; the test-only E2E edge config passed the local proxy checks but is not an approved production gateway configuration.

## Still required before any deployable-image claim

1. Resolve server lifecycle shutdown: both server containers returned exit 137 on `docker stop` with `OOMKilled=false`. Read-only inspection showed PID 1 as the image entrypoint running `sh -c "pnpm db:migrate && node apps/server/dist/index.js"`; graceful SIGTERM is not established. The combined stop call took 7.3 s. Root has assigned a source-level diagnosis; do not claim shutdown readiness until separately verified.
2. Production/target topology and gateway configuration need explicit review; the E2E edge config used here is test-only. Add deployment-specific TLS, domain, health, limits and WebSocket behavior gates without exposing the local QA listener.
3. Repeat auth/content checks with synthetic GM/PLAYER principals to prove authorized content and cross-campaign denial; the current runtime gate checked only unauthenticated rejection. Keep no-auth denial separate from full ACL proof.
4. Migration compatibility, rollback/downgrade, and restore rehearsal against representative disposable prior-schema state remain untested; this pool tested a clean initial migration and backup restore into a second fresh DB.
5. Container vulnerability/SBOM scan, browser/human acceptance, production operations/backup policy and owner approval remain separate gates. None were attempted.
6. Separate owner approval and gates for any remote host, deployment, auth activation or production DB action. None are authorized or evidenced here.

The images and test receipts are **local QA artifacts, not a deployable release or production evidence**. Candidate `76fc9cc` remains immutable. A later server-only shutdown-fix candidate and probe are recorded separately in [arkenhar-shutdown-fixed-aca1436-20261009.md](arkenhar-shutdown-fixed-aca1436-20261009.md); that does not change the 76fc9cc web image or retroactively change its prior shutdown result.
