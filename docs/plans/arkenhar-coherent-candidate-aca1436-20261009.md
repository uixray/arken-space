# Local coherent component candidate — ArkenHar — 2026-10-09

## Result

Built a matching **local QA web + server image pair** from frozen source commit `aca14360c5033844ba3cfea9d87b8d48e6d07b0b` (tree `b429e9cf9446860b6f4eef3c6d6d1b4c0c5539c7`). This pair includes UIX-264 and the server shutdown fix. Images were not pushed and no remote deployment was attempted.

Component identity and saved archive SHA-256 values are in `.data/qa-prep/arkenhar-local-release-components-aca1436-20261009.json`:

- Web `arken-qa-web:aca1436`, image ID `sha256:7ae94cdea784203ecf8ce5af936c7dcf4a4241e0b8d1a383208e2b0d1fff3a61`; archive `web-aca1436.docker.tar` (25,035,776 B), SHA-256 `c92d1a84d4026ebd64dbc9e854b3ab3dc8611c78454e85deaf54f462fabf8100`.
- Server `arken-qa-server:aca1436`, image ID `sha256:e91b854539a1dea8e929d66dcc9796e104aca0ccd4f2fc1a8b6a49333ef0f09a`; archive `server-aca1436.docker.tar` (191,119,360 B), SHA-256 `1aa9641018759b1d26b38b132f76c58a3ccd263f5598bf38b4d8610aef4af897`.

## Web image context and smoke

The web build used a 312-file Git archive allowlist from the same commit: the earlier approved web context plus the three UIX-264 product files `apps/web/src/WorldContentInstancesPanel.css`, `apps/web/src/WorldContentInstancesPanel.tsx`, and `apps/web/src/world-content-instances-client.ts`. Test files and private paths were excluded. Context tar SHA-256: `d8d1492d47be902ee91819f45a808baa28d8a3762f233bf9f056b2a7f5346fb4`.

One loopback-only static-container smoke returned HTTP 200 for the index, JS, CSS, and local Pragmatica WOFF. Font SHA-256: `7b4e50ec50c782077ee147ca5d8db8c4843bc7dd72ff8f133c2458e45347252d`. The web container stopped with exit 0 / `OOMKilled=false`. Receipt and per-file manifest: `.data/qa-prep/local-image-readiness-aca1436-20261009/web-smoke-receipt.json` and `web-context-manifest.json`.

The server-only image had already been built from the same source SHA and passed the single fresh-disposable-DB startup/health/shutdown probe documented in [arkenhar-shutdown-fixed-aca1436-20261009.md](arkenhar-shutdown-fixed-aca1436-20261009.md). The server build was not repeated for this web pairing.

Root and the implementation agent recorded UIX-264 unit 5/5 and mocked Chromium 3/3 on the pre-commit slice, then full workspace/config/E2E typecheck and build on unchanged 0476865. Those receipts are not relabeled exact-aca1436 tests. The intervening aca1436 product change is server shutdown only; its focused tests 3/3, server typecheck, image build/start/stop are separate receipts. No prior unit/browser gates were rerun in this image-building task. The static smoke does not exercise the UIX-264 workflow, authenticated API, or cross-role access. This is a local image-pair artifact, not a deployable release or production evidence. Prior mixed-revision bundle (`web 76fc9cc + server aca1436`) remains unchanged and historical.

