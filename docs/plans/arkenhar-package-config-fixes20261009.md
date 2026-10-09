# Package config fixes — bounded Luna handoff, 2026-10-09

## Scope / already fixed

Plan only. Root already corrected SMTP variable names, empty disabled-mail fields and required GM token placeholder; do not redo those changes. PostgreSQL archive exported:117826048 bytes, SHA256 `F3B3C1D6917B8D769B15447C94D8961777541C675688DEB9CB08BAC21D604BD5`; resolve its immutable image ID/name from root's final receipt, never infer ID from archive hash. Candidate software SHA remains `4dca5a19d3b6b7ca17464825b893dfc276185462` and accepted image manifest is authoritative.

## Exclusive next-worker ownership

> Own only `.data/qa-prep/new-server-package-20261011/` reviewed packaging templates/docs/manifest/member receipt and a compact packaging checkpoint assigned by root. No application source, dependency, image rebuild, private recovery payload, credential, owner stand or active image/migration/SMTP worker artifact changes. You are not alone; preserve other workers. No install/download/pull, service startup, provider/network/firewall/DNS changes, remote/upload/deploy. Static renderer commands use generated nonsecret fixture values only. Cached nginx parser container is optional and requires root's explicit one-shot authorization; no listeners/volumes/production env.

## Finite connected edits

### 1. Gateway contract, not invented deployment

Candidate web nginx is static-only; it does not proxy API/socket routes. Add a separate **template** gateway config plus documented service/override wiring, without editing the built image. Template routes approved public HTTPS origin to web:80 for SPA, server:4100 for `/api/` and `/socket.io/`; confirm protected-media route prefix from accepted source/known receipt and explicitly route it to server, never guess or expose raw media volume. Preserve WebSocket Upgrade/Connection headers and bounded appropriate timeouts. API health must be distinct from static web health.

Use REQUIRED domain/certificate/key path placeholders; private TLS material mounted read-only at activation, not included in software pack. No wildcard guessed hostname/provider. Forward Host/original scheme deliberately; do not expand Fastify proxy trust or change application secure-cookie/origin enforcement. Suppress full bearer-bearing `/gm`/`join` request targets, including malformed/encoded paths, in gateway access AND error logs; use existing accepted privacy policy as template input, not ordinary `$request_uri` logging. Referrer-Policy no-referrer at edge. No request/response bodies, Cookie, Authorization, query tokens or secret env in diagnostic format. Static parse does not prove runtime privacy or WebSocket routing.

Base config stays unexposed. Activation override binds only approved ports/address after owner domain/TLS choice; renderer fixtures may use `example.invalid` and synthetic paths, never claim that host is deployed.

### 2. Network is not public exposure

Keep PostgreSQL only on internal app network, no published PG port. Add a separate non-internal egress network **only to server** in an explicit activation override when SMTP is approved; gateway can have ingress/external reachability as necessary while reaching internal services. Do not attach PG to it. Docker network connectivity alone is not host publication; `ports` are separately gated. Do not claim an egress network limits traffic to SMTP host/port; implementing firewall egress allowlists is external operational scope. Disabled base needs neither SMTP egress nor public binds.

### 3. Explicit activation precedence

Current compose hardcoded false values override runtime.env. Preserve default-off base, but add an explicit reviewed activation override for registration policy/runtime/link flags, using fail-fast required booleans from private configuration. Explain compose precedence: changing env_file alone cannot activate masked flags. Keep campaign creation false unless separately approved entitlement. Do not bundle an auto-enable-on-up default override.

Prefer two clearly named command sets: private rehearsal/default-off versus explicitly approved activation. Both pin exact accepted server/web/PostgreSQL image IDs, `pull_policy: never`, no build or latest tags. `ACCOUNT_MAIL_RUNTIME_ENABLED=true` only with complete trusted config/keyring and passing mail readiness; provider approval/credentials are not invented. Retained links remain explicit independent setting, not account binding. No password/key/provider example populated with a real value.

### 4. Real volume restore before default CMD

Use explicit external existing-volume names (or equally fail-closed exact-volume binding) for runtime DB/media, with required identifiers. Avoid silent fresh volume creation on first `up`. Runbook order:
1. Verify/load archive IDs and hashes; resolve approved project/network/volume names.
2. Authorized recovery owner prepares/restores exact selected private DB/media tuple to those resources, mail/app stopped; validates baseline/schema/count/FK/media and migration receipt.
3. Operator confirms rendered runtime volume names exactly match recovery receipt. No `down -v`, broad prune or replacement of a populated volume.
4. Only then start server/gateway through authorized command. Default CMD migrates before index; document this explicitly. Starting with empty wrong volume must fail preflight, not silently create new installation.
5. Stop/rollback commands retain volumes; rollback selects pre-upgrade DB+media+config+compatible software tuple, never old image on new schema. Separate data-only rollback limitation if applicable.

These are executable operator instructions with fail-fast checks, not execution permission for this packaging worker. Keep production-data harness guard `syntheticOnly` intact; no bypass.

### 5. README / attribution / manifests

Replace stale “templates only/build pending” with observed staged software receipts while keeping runtime/data semantic/transfer readiness false until owners supply actual PASS. Include PostgreSQL archive identity/hash from receipt. Link active exact-image SMTP and production recovery gates; do not rerun old matrices or promote pending to PASS.

Add attribution inventory from accepted packaged dependencies/images and their existing license metadata (Nodemailer10.0.8 attribution included); no network research/install. Record unresolved redistribution information rather than guessing license terms. Attribute software, not private dataset ownership.

Rebuild positive member receipt after edits: enumerate exact approved image archives, templates/overrides, README, attribution and manifests; verify copied bytes/hashes. Expect nine or more members only if actually present—count is not the gate. No broad zip. Reject private DB/media/repositories/env/certs/keys/logs/test fixtures and unknown nested archives. Avoid self-hash recursion: software-members.json lists all other members; record its hash separately in final checkpoint/root receipt. Preserve previous receipt as superseded identity if root requires audit trail.

## Finite validation (no running application)

1. Render each intended compose combination with a temporary **synthetic, nonsecret** interpolation file and dummy runtime env containing no actual credentials; explicitly select project/file paths and synthetic required volume identifiers. Run `docker compose ... config --quiet`; if needed parse captured config privately and emit only assertion booleans/service/network/volume names. Never render real private env into stdout or retained diagnostics. Do not use `up`, create network/volumes or contact daemon merely to validate YAML.
2. Assert base flags remain off; activation override intentionally changes only allowed flags; creation still off. Exact candidate images preserved. No `build`, no pulls, PG no ports/no egress network, server no accidental public port, gateway-only approved placeholder binds, external volumes fail missing-name interpolation. Missing required activation values must fail rendering; all-disabled config with blank mail must render.
3. Render nginx template with `example.invalid` and synthetic paths. Check required API/socket/media routes, privacy directives and TLS mount contract statically. If root authorizes cached parser container: `docker run --rm --pull=never --network=none --entrypoint nginx <exact cached nginx image> -t ...` with only reviewed config + ephemeral generated test cert/key mounted read-only. Resolve upstream names via synthetic test-only host entries or equivalent parser-only fixture; do not weaken final routing or enable external DNS. No ports, daemon serving, real TLS key or host certificate changes. Missing parser/cert prerequisite is a bounded blocker, not permission to install.
4. Rehash all staged software members; assert private exclusions; read README command sequence for exact volumes/restore-before-start and no production defaults. Return paths, member count/digest, renderer/parser result scopes and remaining host/provider/data/runtime gates. Static success is not target-deployment acceptance.

## Checkpoint / stop

This plan changes only `docs/plans/arkenhar-package-config-fixes20261009.md`. No commands, parser containers or packaging edits performed by planner. Next action: root assigns packaging worker exclusively; it stops after finite config/member gate and returns unresolved values. Actual installation/upload and any new runtime QA need separate authorization.
