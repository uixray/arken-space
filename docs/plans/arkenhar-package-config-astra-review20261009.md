# Package config Astra review — 2026-10-09

Bounded structural review only: staging compose/activation/gateway, README/OPERATOR/ATTRIBUTION, safe manifests/member receipt, and exact4dca5a1 web nginx. No containers/tests/private data/image payload reads or edits except this document.

## Disposition: static receipts valid in their scope, package has concrete blockers

**P1 — retained campaign links routed to an upstream internal-only URI.** Gateway rewrites sensitive targets to `/__arken_sensitive_index`, then its exact location uses `proxy_pass http://web:80` without replacement URI. The rewritten URI reaches web as a new external upstream request. Exact candidate web has that location marked `internal`, so it rejects it with404 rather than serving SPA. Map-regex and nginx -t success do not test this two-hop behavior. Fix gateway sensitive proxy to explicit safe `/index.html` with original query/bearer excluded; keep access/error suppression. After separately authorized local serving gate, assert GM/join ordinary+encoded paths serve SPA and logs contain no synthetic bearer. Do not weaken web internal guard.

**Offline assembly gap — gateway executable image missing.** Activation requires PACKAGE_NGINX_IMAGE_ID with pull_policy never, but positive package contains only server/web/PostgreSQL archives and attribution explicitly says gateway image unbundled. Add approved exact cached gateway archive/identity/hash/attribution, or deliberately validate/reuse bundled web image as gateway with configuration override. Do not rely on an unrecorded image already present on the new host or silent pull.

**Attribution consistency correction.** ATTRIBUTION calls Nodemailer10.0.8 MIT; accepted SMTP worker checkpoint records MIT-0. Reconcile exact installed/package license metadata before redistribution; do not guess or replace required upstream notices with this table.

## Confirmed structural improvements

Base is default-off/no ports, PostgreSQL internal-only, server-only additional egress, exact pre-existing external DB/media volumes required. Activation explicitly overrides env-file-masked flags; creation is an explicit owner-required setting, not implicitly enabled. OPERATOR correctly requires restored-volume identity match before default migration CMD and preserves rollback tuple. Readiness manifest stays false; no provider/target/runtime success invented. External-volume presence alone does not prove correct contents; documented recovery receipt check remains essential.

Images are required via variable placeholders; compose itself does not validate that supplied strings equal accepted immutable IDs. Operator comparison with manifests remains required, not parser-proven identity enforcement. SMTP egress network is not an egress destination firewall. Gateway TLS/domain/public exposure still intentionally unresolved.

## Receipt verification

Reviewer independently hashed software-members.json: `A7A01470C4E64B1B24E905497A9A7932141F119DD11CE21BA1CF733F6892C2C5`,13 members. All10 non-tar structural members match recorded bytes/SHA256. Three image payload archives were intentionally not reread/rehashed here; rely on root assembly receipt. Worker-reported compose render/assertions, nginx -t and9 regex cases are accepted as finite structural evidence only; not independently rerun or expanded to live routing/privacy acceptance.

Next: repair sensitive proxy destination, resolve missing gateway image and license discrepancy, regenerate positive member receipt, then root decides a narrow two-hop routing/privacy runtime gate. No broad product/auth/recovery rerun requested. Changed only this review checkpoint.

## Root fix follow-up

Root reports sensitive exact location now proxies explicitly to `http://web:80/index.html?` to discard original bearer/query, and gateway uses PACKAGE_WEB_IMAGE_ID (bundled exact web/nginx image) rather than a missing separate archive. Treat both findings as **fix applied, focused runtime verification pending**, not original defects still open and not runtime PASS. Packaging worker must regenerate member receipt after edits; the13-member hash above identifies pre-fix review bytes only. Attribution discrepancy remains to reconcile. No additional runtime was run by reviewer.
