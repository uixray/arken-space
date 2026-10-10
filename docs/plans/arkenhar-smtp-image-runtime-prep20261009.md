# SMTP exact-image gate — execution preparation, 2026-10-09

## Candidate and stop state

The approved target is product commit `4dca5a19d3b6b7ca17464825b893dfc276185462`. The exact-image plan is `docs/plans/arkenhar-smtp-image-runtime-plan20261009.md`. This preparation is **not execution evidence**: no candidate image IDs/manifest were accepted into this receipt, and no Docker resource was created or started. Gate status remains `WAITING_FOR_EXACT_IMAGE_MANIFEST_AND_CACHED_BASE_IDS`.

The preceding API-level lifecycle test (`apps/server/src/account-mail-smtp-lifecycle.integration.test.ts`) passed 1/1 with real loopback SMTP, same shared mail context for direct account-route registration and scheduler. It did not run the full production `index.ts`/`registerRoutes` process. That gap is exactly what this image-level gate is intended to cover; do not repeat the 54/65 release matrix or transfer direct-route evidence to image startup.

## Resource namespace, pending only

The isolated resource prefix reserved for this preparation is `arken-smtpimg-4dca5a1-20261009`. Planned unique names are:

- internal-only network `arken-smtpimg-4dca5a1-20261009-net`;
- isolated PostgreSQL volumes `arken-smtpimg-4dca5a1-20261009-pg-a`, `-pg-b`, and `-pg-c` (fresh DB per required arm; exact count finalized before start);
- app containers `arken-smtpimg-4dca5a1-20261009-a`, `-b`, `-c-no-ca`, `-c-ca`, `-d`;
- fixture container `arken-smtpimg-4dca5a1-20261009-smtp` and, if split into separate finite fixtures, `-smtp-no-ca`.

These are **proposed names, not evidence that names are absent or resources owned**. Before any create/start, inspect only these exact names for collision and refuse reuse. No root/owner stand, existing worktree resources, backup, image archive, or credentials are in the namespace. Candidate/bases are immutable image IDs only; `--pull=never` / `pull_policy: never`; no build, install, network fetch, or mutable tag substitution during the runtime gate.

## Fixed test design

Follow the four arms in the exact-image plan: (A) configured SMTP/key but runtime disabled; (B) runtime enabled without key; (C) no-extra-CA negative then strict-CA positive signup → real candidate scheduler → loopback TLS DATA accepted → explicit verification/replay denial → login/empty campaigns; (D) second accepted queue held at DATA during SIGTERM, with orderly socket close, queue retry settlement, exit zero and `shutdown_complete`. Use normal candidate CMD `pnpm db:migrate && exec node apps/server/dist/index.js`; if offline Corepack/pnpm package cache is missing, record a default-command runtime blocker without downloading or editing the image.

Use only synthetic email/account, generated key, generated SMTP credentials, self-signed test CA/leaf with SAN `smtp-fixture`, PostgreSQL and GM values; never print or store values in the receipt. Fixture and candidate share only the internal Docker network. Mount only the public CA certificate read-only in the candidate; private signing/SMTP key stays in fixture. Inject `NODE_EXTRA_CA_CERTS` only into the disposable candidate process. No TLS disable, trust-all setting, host trust-store mutation, public mail/debug endpoint, DB token extraction, external SMTP, provider credentials or inbox claim. Bind any host-visible API only to approved loopback or prefer an internal HTTP client.

No application payload, raw message, bearer token, email, password, key or environment dump belongs in the private receipt. Record safe booleans/counts/fixed failure categories, image/context identity, process exit/OOM/shutdown status, HTTP statuses, outbox states and exact owned resource IDs. Do not claim that account rows/counters equal production state.

## Go/no-go

Wait for root acceptance of the exact SHA/image manifest and cached PostgreSQL/fixture image IDs. After that, verify the specified image IDs and candidate `BUILD_REVISION`, check exact resource-name collisions, freeze the private execution ledger and run only the finite plan once. Stop before execution if the default CMD needs a package-manager fetch or if any image is missing. After execution, cleanup only exact owned IDs; preserve receipts, hashes and logs only after a secret-safe review. This pool proves local synthetic index/bootstrap lifecycle only—not external provider delivery, inbox receipt, browser cookie transport, DB-stall graceful shutdown, current production backup, or deploy readiness.

## Checkpoint

Created this compact prep document and a private empty execution-ledger template under `.data/qa-prep/smtp-image-runtime-4dca5a1-20261009/`. No product source changed; no image build/inspect, container start, network, database, provider or owner stand was touched. Next action: wait for exact candidate/base image IDs and root's manifest acceptance; then confirm names are free and run the finite gate.
