# SMTP candidate image runtime gate — 2026-10-09

## Checkpoint
- Candidate: product SHA `4dca5a19d3b6b7ca17464825b893dfc276185462`, tree `c4a3112e3a821d92a4304882a371641dfe792ff1`.
- Immutable server image: `sha256:be8464f516e027f24424f4f7c0a16fdfe7c7278eea714c64395ee221365257ff`; cached PostgreSQL image: `sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193`. Pull policy was `never`; candidate ran the default `pnpm db:migrate && exec node apps/server/dist/index.js` entrypoint.
- Four bounded arms completed against disposable synthetic data: A runtime disabled and B missing mail key each fail closed (capability false, registration 503/no-store, no SMTP connection or DB writes; clean SIGTERM). C strict-TLS negative rejected without added CA; positive generated-CA path accepted synthetic mail through SMTP, verified and replay-rejected the action token, logged in, and confirmed no campaigns/memberships. D SIGTERM while SMTP DATA held exited 0, OOM false, with shutdown-started/complete markers; held message was not accepted and socket ultimately closed.
- **Ordering limitation:** socket closure was not sampled relative to `shutdown_complete`; do not claim close-before-complete. D1's expired pre-signal barrier was discarded, not counted as a pass. No D3 was run.
- All accounts, credentials, certificates, messages, and database contents were synthetic. No provider inbox delivery, public/browser TLS, database-stall shutdown, or production readiness is claimed. No public receipt contains credentials or raw mail.
- Cleanup status: all owned containers stopped, candidate app exit codes 0, internal network has 0 attached containers and no host port bindings. SMTP fixture container returned 137 on its own `docker stop --timeout 20` (fixture-only stop timeout; no active process). Cleanup completed: exact nine owned containers, seven volumes, and detached internal network removed; private synthetic QA artifacts retained. Candidate images retained.

## Artifacts and changed files
- Detailed private execution state: `.data/qa-prep/smtp-image-runtime-4dca5a1-20261009/execution-ledger.json` (private harness materials live only under its `private/` folder).
- Harness outputs: same unique `.data/qa-prep/smtp-image-runtime-4dca5a1-20261009/` directory; no product source changes.
- This compact checkpoint is the only tracked file changed by this pool.
- Next: root review safe receipts; remove only this ledger's verified containers, volumes, and internal network; retain evidence as directed. No production activation/deployment.

