# Packaging configuration checkpoint — 2026-10-09

## Scope / revision

Bounded packaging/config pass in worktree `uix-293-catalog-20261007`, based on accepted image receipt at `4cb0041`. No commit. No product/source/dependency edits, image archives/build manifests, actual-stand data, private recovery payload, or active worker artifacts changed. Updated only package configuration/docs, staged recovery summary manifest, exact Nodemailer license, positive software receipt, and this checkpoint.

## Changed files

- `.data/qa-prep/new-server-package-20261011/compose.template.yml` — default-off, no host ports, immutable images, pull-never, exact pre-existing DB/media external volume names required.
- `.data/qa-prep/new-server-package-20261011/compose.activation.override.yml` — required explicit booleans, gateway-only approved bind, separate server SMTP egress; PostgreSQL internal-only.
- `.data/qa-prep/new-server-package-20261011/gateway.template.conf` — TLS placeholders, SPA/API/socket routing, explicit `/api/story/media/` protected story-media route, Upgrade headers, Referrer-Policy, query-free access log and raw-target `/gm`/`/join` suppression/error isolation modeled on accepted `infra/nginx/container.conf` policy.
- `.data/qa-prep/new-server-package-20261011/OPERATOR.md` — exact-volume restore-before-start/migration/rollback sequence.
- `.data/qa-prep/new-server-package-20261011/ATTRIBUTION.md` — local metadata and unresolved redistribution checks.
- `.data/qa-prep/new-server-package-20261011/README.md` — observed receipts and gates; explicitly NOT transfer-ready.
- `.data/qa-prep/new-server-package-20261011/software-members.json` — regenerated positive 14-member receipt, including Nodemailer MIT-0 license. Final SHA256: `83e095dacf82d959932fa2f69eaf28df9f0b1bb577b006fb79210a0fe35067e4`.

## Finite QA

- Docker Compose v5.4.0 `config --quiet`: base and activation render succeeded using synthetic values. Installed Node parsed rendered activation JSON and assertions passed: PG unpublished/internal-only; only server has smtp-egress; required external volumes; gateway is same exact web image; pull-never; approved campaign policy true with limit 3. Base remains default-off.
- Confirmed source route in `apps/server/src/story.ts` (`GET /api/story/media/:contentId`, line 812) and compiled accepted route in `apps/server/dist/index.js`; gateway explicitly routes that prefix to server.
- Exact cached web image one-shot `nginx -t` passed with synthetic self-signed test cert/key, read-only config/mounts, network none, no ports; test-only host entries resolved parser upstream names.
- Focused actual internal-network serving passed: normal/encoded `/gm` and `/join` returned 200 and byte-identical SPA; malformed `%ZZ` was rejected 400; synthetic API JSON, protected-media bytes and WebSocket 101 passed; gateway and web logs contained zero synthetic path/query tokens. No host ports or live process/resources remained after cleanup.
- No real env, credentials, production payload, uploads, remote activity or deployment used.

## Remaining gates / blockers

No resolvable local config blockers remain in this bounded scope. Still not transfer-ready: approved target/domain/TLS/bind, actual recovery volume restore and migration/replay acceptance, SMTP/provider readiness and egress controls, attribution redistribution review, and live gateway privacy/routing acceptance remain owner/host/runtime gates. No transfer/deployment/production start/merge is claimed.

`.data/` is intentionally Git-ignored; do not force-add image/private artifacts. Only this checkpoint is a tracked candidate change. Parent decides integration policy.

## Next action

Root integration: review tracked checkpoint and ignored package output; refresh the software member receipt if any package edits follow. Keep production recovery, exact-image SMTP, host exposure and runtime acceptance as separate gates.

## Follow-up pool — gateway runtime and approved entitlement

- Gateway configuration now sends bearer-bearing `gm`/`join` paths through a fixed safe `/index.html` upstream URI, including query stripping; the packaged web image is reused as gateway image, with a static upstream group and mapped safe URI. Edge access format contains no URI; edge error log goes to `/dev/null emerg` to avoid parser-level malformed-target leaks. Operational tradeoff: edge error diagnostics are intentionally lost.
- Focused actual serving test passed on exact cached web and Node images: normal/encoded `/gm` and `/join` paths all 200 and byte-identical to SPA; malformed percent path rejected with 400; API JSON, protected-media bytes, and WebSocket fixture 101 all passed. Both gateway and web container logs had zero synthetic bearer/query marker hits.
- Test used unique Docker `--internal` network and no host-published port; the engine did not expose port mappings on an internal network even with explicit loopback publishing. We retained stricter no-host-exposure test instead of switching to a public-capable bridge. All named test containers/network and temp fixtures were cleaned; no live QA process/resources remain.
- Owner-approved creation entitlement: verified accounts may create at most three campaigns. Activation override reflects approved policy, requires explicit enable choice and limit=3; base remains off. SMTP still default-off until provider/keyring/sender readiness.
- Production-derived data evidence now referenced in `manifest.pending.json`: semantic migration/fresh replay and DB/media pair are verified per `docs/plans/arkenhar-production-recovery-migration-checkpoint20261009.md`, opaque receipt identity `production-recovery-20261006-migration-20261009-r1`. Legacy runtime access remains pending valid owner-provided links; historical `auth_source=NULL` sessions are not authenticated. Transfer remains false.
- Local Nodemailer 10.0.8 metadata/license verified as MIT-0; exact notice added to package `licenses/`. Gateway reuses web image, no separate nginx image dependency.

Final 14-member software receipt SHA256: `83e095dacf82d959932fa2f69eaf28df9f0b1bb577b006fb79210a0fe35067e4`. No commit. `.data/` remains ignored intentionally; root integrates checkpoint only.



## Root integration — access scope superseded

Root independently rehashed all 14 listed members; final receipt SHA matches `83e095dacf82d959932fa2f69eaf28df9f0b1bb577b006fb79210a0fe35067e4`. Scoped internal gateway/config acceptance is accepted, not target TLS/network readiness. Owner subsequently approved replacement links and an additional PLAYER Илья, so waiting for raw old bearer URLs is superseded. Revised transfer-copy credential/runtime/export gate is active; original/B/M remain intact. This receipt still refers to earlier data identity until the revised tuple is accepted. No package readiness promoted; creation cap 3 approval stands.
