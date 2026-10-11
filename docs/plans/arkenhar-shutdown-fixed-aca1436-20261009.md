# Local server shutdown probe — ArkenHar — 2026-10-09

## Result

**The server-only shutdown-fix image passed one isolated local startup/health/default-stop probe.** This is a bounded local QA result, not deployment or production evidence.

- Frozen source: commit `aca14360c5033844ba3cfea9d87b8d48e6d07b0b`, tree `b429e9cf9446860b6f4eef3c6d6d1b4c0c5539c7`.
- Image: `arken-qa-server:aca1436`; image ID `sha256:e91b854539a1dea8e929d66dcc9796e104aca0ccd4f2fc1a8b6a49333ef0f09a`, size 191,094,001 bytes.
- Exact allowlisted server context: 174 tracked files, archive SHA-256 `b6086df43f40b7d72d5d8d594127712abd525be35586dddb8cf0a75e53b9a246`. It used the previous server-context allowlist plus `apps/server/src/graceful-shutdown.ts`, which is newly required by this source revision. No tests, fixtures, `.env`, `.tmp`, `.data`, `.pem`, or `.key` paths were included.
- Build completed successfully. The first attempt intentionally exposed an incomplete allowlist (missing the new graceful-shutdown module); it was corrected before the successful build. No source edits were made for this capture.
- Local Docker save: `server-aca1436.docker.tar`, 191,119,360 bytes, SHA-256 `1aa9641018759b1d26b38b132f76c58a3ccd263f5598bf38b4d8610aef4af897`.

## Single runtime probe

Used a unique disposable PostgreSQL container, database volume, media volume, network, and server container; the DB was freshly initialized and server migration ran on startup. Credentials were synthetic and temporary env files were removed. No retained QA or production DB, remote host, or deployment was involved.

1. Server `/healthz` returned HTTP 200 with `database=ok` and revision `aca1436`.
2. One default `docker stop` completed in 0.56 s. Container state: exit code 0, `OOMKilled=false`.
3. Shutdown log contains both `server.shutdown_started` and `server.shutdown_complete` for SIGTERM.
4. Read-only inspect shows Docker PID 1 is `docker-entrypoint.sh` with `sh -c "pnpm db:migrate && exec node apps/server/dist/index.js"`; the `exec` handoff makes the server process receive the default stop signal directly after migration.
5. The disposable DB was stopped; the server remains stopped with exit 0. Unique QA resources and evidence are retained for review.

Receipt and context manifest are under `.data/qa-prep/local-image-readiness-aca1436-20261009/` (`server-shutdown-receipt.json`, `server-context-manifest.json`, `server-shutdown.log`, and `images/server-aca1436.docker.tar`). No credential values or database dump are included in the retained release bundle manifest.

## Candidate identity boundary

This is a **server-only** successor component. The prior local web image remains `arken-qa-web:76fc9cc`, built from `76fc9cccaafe5dd6795fb4f7c33344990d39eed0`; `aca1436` also contains UIX-264 source changes not represented by that older web component. Do not call this a uniform same-SHA full-stack release. The local component-bundle manifest is `.data/qa-prep/arkenhar-local-release-components-20261009.json`; it references the web and server image archives by path and SHA rather than duplicating them.

Remaining gates: repeat after any server source/config change; authenticated GM/PLAYER content authorization; target deployment gateway/TLS/topology review; migration compatibility/rollback; vulnerability/SBOM review; browser/human acceptance; and explicit owner approval for any remote or production action. None are implied by this stop probe.
