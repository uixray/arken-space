# Account SMTP adapter pool checkpoint — 2026-10-09

## Decision and scope

- Added Nodemailer `10.0.8` as an exact server dependency (MIT-0, Node `>=20`); workspace lock integrity is pinned. Production code delegates SMTP protocol/message composition to Nodemailer; no SMTP protocol parser was added to application code.
- Added a single shared account-mail context used by the runtime and auth routes. It constructs one adapter and one parsed keyring; `registerRoutes` keeps a context-from-environment default for existing direct callers. Production bootstrap validates the transport/key configuration before opening the DB connection.
- SMTP defaults remain absent/off. `ACCOUNT_MAIL_RUNTIME_ENABLED`, `ACCOUNT_MAIL_ACTIVE_KEY_ID`, `ACCOUNT_MAIL_KEYRING`, `ACCOUNT_MAIL_SMTP_*`, and account registration retain their existing explicit opt-in/default-off behavior. A complete SMTP config alone does not start mail or enable registration; readiness still requires explicit runtime enablement plus adapter and active key. No provider, `.env`, external email, mail credentials, or delivery endpoint was read or used.
- Transport is non-pooled implicit TLS, auth required, `rejectUnauthorized:true`, no opportunistic/downgrade path, no Nodemailer logging/debug/transaction log. Hostname verification stays enabled. Connect/greeting/socket limits are parsed and bounded below the current runtime send deadline. Adapter abort destroys the active TLS socket; connection setup has its own callback-settling timeout. SMTP errors are reduced to fixed categories with no provider response/body/credentials attached.
- `tlsCa` and `onSocketCreated` are in-memory test seams only; neither is an environment setting. Certificate trust is never disabled. The test CA is generated under OS temp and removed after the run.

## Frozen source and changed files

- Git HEAD during the gate: `d539b3520e6360999c716d764ac3076f4c8fdc9d`; no commit made for this pool.
- Source/config files owned by this pool:
  - `apps/server/package.json`
  - `pnpm-lock.yaml`
  - `apps/server/src/account-mail-smtp.ts` (new)
  - `apps/server/src/account-mail-context.ts` (new)
  - `apps/server/src/account-mail-smtp.test.ts` (new)
  - `apps/server/src/env.ts`
  - `apps/server/src/index.ts`
  - `apps/server/src/routes.ts`
- Unrelated dirty work preserved: `.tmp/`, `apps/web/src/renderers/map-ping-motion.ts`, and concurrent harness/reviewer docs/test file. They are not included in this pool's receipt.

## Verification receipts

- Focused connected command: `node node_modules/vitest/vitest.mjs run apps/server/src/account-mail-smtp.test.ts apps/server/src/account-mail-runtime.test.ts` — **2 files / 15 tests PASS**. The first sandbox run hit Windows temp rename EPERM; the approved elevated local run passed.
- Test gate includes: absent/partial/malformed config fail-closed; shared context has runtime disabled even when injected transport config is complete; trusted loopback TLS success and stable queue Message-ID; untrusted CA and hostname mismatch rejection; stalled pre-TLS handshake timeout settles and the actual client TLS socket emits `close`; 4xx retryable vs 5xx permanent error classes; ambiguous post-DATA disconnect preserving the stable Message-ID; abort during DATA closes the active TLS client socket. Existing runtime tests remain passing.
- Server typecheck: `node node_modules/typescript/bin/tsc -p apps/server/tsconfig.json --noEmit` — PASS, elevated after a sandbox-only Drizzle duplicate-path noise. The first elevated pass exposed an unrelated worker-owned `Crypto.randomBytes` typing in its new integration test; owner fixed it before final PASS.
- Server bundle: from `apps/server`, `node node_modules/tsup/dist/cli-default.js src/index.ts --format esm --clean --sourcemap` — PASS.
- No actual external provider delivery is claimed. The focused gate is a local synthetic fake SMTP/TLS endpoint plus the previously existing runtime tests. No deploy/reload/remote/push/merge occurred.

## Follow-up disposable lifecycle integration gate

- On the frozen product bytes, `item_instance_fields` ran `node node_modules/vitest/vitest.mjs run apps/server/src/account-mail-smtp-lifecycle.integration.test.ts --reporter=dot` — **1/1 PASS**; its server typecheck `node node_modules/typescript/bin/tsc --noEmit -p apps/server/tsconfig.json` exited 0.
- The harness used a real loopback Fastify HTTP listener and direct route registration, passing the same shared context to auth options and the real scheduler. It covered signup → queued scheduler delivery → accepted local loopback TLS SMTP message → verification using the accepted message → login → empty campaign list. It did not invoke full `index.ts`/`registerRoutes` production bootstrap, Socket.IO, or a production provider; do not claim those scopes.
- The harness was synthetic/disposable (PGlite and generated local TLS artifacts removed) and wrote no account/token/key into its private receipt. No inbox placement or actual mail delivery claim.
- Rechecked all eight owned source/config SHA-256 values after the harness; they still match the hashes below. The new integration spec and its private receipt are owned by `item_instance_fields`, not included among this pool's changed files.

## Hashes (SHA-256)

```text
apps/server/src/account-mail-smtp.ts a60a10369a79ef20f71f2f25ac1b29be2d317f079360553aa4ea30690b303edb
apps/server/src/account-mail-context.ts d9e325eafbe7c9f0f4a5343892e5bf44a85e9c6a3b284c33ecea22f6d0c6db46
apps/server/src/account-mail-smtp.test.ts cc94665beaa4d1a754f2fb92acf6418be11eb4ec9143e8eadb92ba17707a62a9
apps/server/src/env.ts 3697f477fbbea3f96e8dbf0239bf067e2ea9394a8e84219e19bc1f69bfb81bf0
apps/server/src/index.ts a138a04a2bb2200d02ff9c282b00850c1a1db52f3956d2362bb58a0bbb327d10
apps/server/src/routes.ts 3402afc58ae6fdd5b5b8581deb7a49966af5764d028a776b1fcb7a03e62c9387
apps/server/package.json 0a310d97ad538e96235d29670cf849ab1aebec1095411d3d58c2339282923665
pnpm-lock.yaml 129d0571ba15e6fecdd6a8630d6abf44e50e67bd939f3dd9107db8c8dc19ef29
```

## Remaining gates / next action

- Remaining: operational SMTP credentials/provider/domain and delivery acceptance remain unconfigured/unapproved; separately review retry semantics (the existing outbox currently retries transport errors, so the adapter's SMTP 5xx permanent category is not yet a terminal outbox policy) and prove the complete server graceful-shutdown path against active socket/DB work. Production registration remains disabled by defaults.
- Root owns integration/candidate construction. No further changes in this pool after the source freeze; any fix requires a new test/build gate and new candidate fingerprint.
