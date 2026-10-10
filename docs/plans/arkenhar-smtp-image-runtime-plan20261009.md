# Exact-image SMTP bootstrap gate plan — 2026-10-09

## Scope and prerequisites

Target product SHA `4dca5a19d3b6b7ca17464825b893dfc276185462`. Plan only: no execution, source changes, secret/private-fixture reads, remote or owner-stand activation. The 15-test adapter/runtime receipt and separate 1/1 HTTP lifecycle receipt do not exercise the complete production index/registerRoutes process. This finite gate fills that gap, not the old 54/65-case release matrix.

Required before dispatch:
- Root accepts exact-SHA candidate build manifest: server immutable image ID, context/tree/lock identity and build receipt. Do not substitute moving tags/current worktree. Image must include Nodemailer and bundled index at this SHA.
- Already cached PostgreSQL image ID and Node-capable fixture image ID (the candidate server itself can run fixture Node scripts with overridden command). All starts `--pull=never`/`pull_policy: never`; no installs, rebuilds, downloads or Corepack fetching during gate. Default candidate CMD is `pnpm db:migrate && exec node apps/server/dist/index.js`; if migration command cannot run offline, record a blocker rather than change dependencies or silently bypass the intended process.
- One uniquely named Docker **internal** network, isolated new PG/media volumes, synthetic database/GM/mail/keyring material, disposable harness directory. No shared/owner DB, real env, credential store, shared backup or existing stand ports. Resources named in private execution ledger before creation; cleanup only exact owned resources after approved retention.
- Cached/local OpenSSL or equivalent existing generator for ephemeral CA and SMTP leaf cert with SAN `smtp-fixture` (internal Docker DNS name). Node fixture uses only built-in tls/net/fs; no smtp-server dependency. CA public cert mounted read-only at `/run/qa-ca/ca.pem` into candidate; private signing/server key mounted only into synthetic SMTP container. Do not print keys/passwords/tokens or keep message bodies in public artifacts.
- SMTP fixture exposes deterministic accept/hold/release and socket-close observations to harness only, not production HTTP. Keep control endpoint on internal network or private harness IPC; no published SMTP/control ports. API port, if published for host assertions, binds only `127.0.0.1` on an unused root-approved port. Internal-node HTTP client is preferable. No host gateway/external SMTP required.

## Strict trust without product changes

Set `NODE_EXTRA_CA_CERTS=/run/qa-ca/ca.pem` **only when starting the disposable candidate process**, before Node startup. This adds the generated trust root; adapter retains `rejectUnauthorized:true` and verifies host `smtp-fixture` against leaf SAN. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized:false`, product trust-all env or global OS/browser trust changes. Never mount private CA key into candidate. A no-extra-CA negative below proves the candidate is not accidentally trusting the fixture.

This is API/bootstrap evidence. Production sets Secure cookies; the harness may manually replay Set-Cookie values in an HTTP client on the isolated network, but must label that API authorization proof, not browser cookie/TLS proof. No web image/browser is needed to close the specific index/bootstrap gap. Optional actual browser TLS gateway is a separate approved resource/gate, not grounds to downgrade cookie security here.

## Executor ownership / fixture setup

Next Luna owns only a disposable runtime harness/compose override and safe receipt/checkpoint, not application code. Preserve music_mixer image outputs and item worker recovery artifacts. Start from `docker-compose.restore-candidate.yml` conventions but render a separately named gate: no editing/reusing the actual recovery project. Use exact image IDs, internal network, fresh volumes, SQL migrations from image and normal candidate CMD. Account mode must be true so index skips beta seed; verify fresh campaign/membership counts zero. No direct user/verification/outbox inserts are needed.

Synthetic process config: NODE_ENV production; account auth/registration/policy-approved true; campaign creation/policy false; legacy alias auth false; mail runtime as matrix; complete synthetic SMTP host/port/username/password/from; generated 32-byte active mail key; WEB_ORIGIN and PUBLIC_URL fixed valid synthetic origin. Supply explicit synthetic DATABASE_URL and GM token to satisfy production validation. No real provider or owner stand values. Keep malformed config tests out of shell output.

Use normal process entrypoint, not import registerAccountAuthRoutes in test. Record image ID + exact SHA + process invocation without env values. Health/meta BUILD_REVISION is corroboration, not sufficient image identity proof. Runner default idle poll is 30s and batch one; allow 70s maximum per mail event without modifying product timers. Overall gate bounded to 10 minutes, excluding separately reported image prerequisite wait.

## Minimal assertion matrix / ordered execution

### A. Runtime off with transport/key configured (fresh DB; <=60s)

Start normal candidate image with SMTP/key complete but ACCOUNT_MAIL_RUNTIME_ENABLED=false. Wait API health then assert registration capability false; POST register with valid origin/synthetic identity yields 503/no-store and no new users/action tokens/outbox/memberships. SMTP fixture must observe no connection. Stop process with SIGTERM; capture exit0 + shutdown_complete, no timeout/failed category. This proves full entrypoint does not enable routes from adapter.ready alone.

### B. Missing encryption key (same empty isolated DB; <=60s)

Restart same immutable image with runtime true/SMTP complete, both keyring fields absent. Capability false; direct register503/no-store; tables still unchanged, no SMTP connection. Stop cleanly. Omit a redundant all-config-absent arm: adapter/runtime source suites already cover it. Partial malformed config need not be reproved unless image bytes differ.

### C. Strict TLS negative then positive signup (<=160s)

1. Start with runtime/key/SMTP complete but **without NODE_EXTRA_CA_CERTS**; signup returns accepted202 because configuration is ready, not provider reachability. Await fixture handshake/rejected connection and safe queue state showing retry rather than ACCEPTED. Do not expect capability to dynamically turn false. Capture only booleans/counts/fixed failure categories. Stop and dispose this arm's isolated DB/volume, so pending retry cannot contaminate the next identity.
2. Fresh DB; start normal exact image with CA mount/env. Health ready; registration capability true, campaignCreation false; fresh campaigns/memberships zero. POST signup (no invite) →202/no-store, unverified login401. Actual runner sends to TLS fixture; wait for final DATA250 and DB outbox ACCEPTED within70s. Fixture holds accepted message privately in memory; harness extracts verification fragment, never DB token lookup/public debug endpoint.
3. Confirm via actual `/api/account/verification/confirm` POST →200; replay400. Login→200; use returned cookie values privately to GET `/api/account/campaigns` →empty. Assert users verified, zero memberships/campaign ownership and creation capability still false. No claim of provider inbox delivery or browser transport. Do not alter campaign/link source or repeat existing link matrix.

### D. SIGTERM while SMTP DATA is pending (same positive-arm DB; <=100s)

Configure fixture to hold its final DATA response, register a second synthetic identity through HTTP, await fixture's DATA barrier (<=70s). Send **SIGTERM**, not immediate kill or docker stop's short fallback. Let supervisor wait >8s (e.g.15s) before any explicit failure cleanup. Capture: fixture socket closes, process emits shutdown_started then shutdown_complete, exit0, no OOM/killed/timeout; connection closes before process completion. With DB still healthy, inspect queue via independent connection: no false ACCEPTED for held message, lease cleared into bounded retry state; no raw payload/token in receipt. Wait one poll interval or confirm process/container fully exited and no sockets remain: no continued scheduler activity. Compare safe DB session observations if available; absence of source-level DB-close instrumentation must not be claimed as exact causal timing proof. End-to-end clean process completion plus queue settlement/socket closure is the observed boundary.

If abort/DB settlement fails or process exits1/timeout, report FAIL with fixed diagnostic category and retain isolated artifacts; do not turn an 8s forced exit into graceful PASS. A hung DB claim/ack can exceed8s: current server then intentionally exits1. This matrix does **not** fault-inject a stalled database or prove clean DB-stall shutdown. An optional future DB-stall arm may demonstrate the failure bound/recovery, not close the clean-settlement limitation. No old auth/security/regression matrix rerun is required for this gate.

## Receipts and stop conditions

One safe JSON/Markdown receipt: full source SHA/tree, immutable server/base IDs, manifest link, resource names, each arm's start/end/status, HTTP codes/capability booleans/no-store, zero/matched table counts, SMTP accepted/rejected/socketClosed booleans, outbox state counts, process exit/OOM flags and shutdown categories. No env dump, Docker inspect Env, mail transcript, token/session/password/key, raw email or body. Private synthetic material remains outside image/export/evidence allowlists and is disposed under owned-resource cleanup policy.

PASS means actual candidate index/registerRoutes readiness + queue→synthetic SMTP acceptance→verification/login + healthy-DB shutdown demonstrated. It does not mean provider activated, inbox delivered, browser TLS tested, DB-stall gracefully handled or backup restored. Stop after finite local gate; no deploy/remote/owner environment change.

## Checkpoint

Planning source reads used immutable4dca5a1 index/runtime/graceful-shutdown/env/Dockerfile and restore template only. Changed only this plan. Candidate image availability is prerequisite; root dispatches harness after manifest acceptance and resource authorization. All gates above remain unexecuted by reviewer.
