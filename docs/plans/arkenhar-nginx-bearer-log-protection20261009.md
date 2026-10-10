# Nginx campaign-link bearer logging checkpoint — 2026-10-09

## Pool decision

Legacy `/gm/:token` and `/join/:token` links remain usable. At each owned Nginx edge, classify the **original** `$request_uri` for access logging before URI normalization, and route sensitive targets to a private internal location before normal location selection. Sensitive locations and internal targets suppress access/error logs and return `Referrer-Policy: no-referrer`; ordinary request access logging remains enabled. The old-domain redirect still preserves the requested URL for compatibility, while its Nginx access log filters raw bearer paths.

The raw-target patterns are case-insensitive and cover repeated/encoded leading slash, encoded `g`/`m`/`join` letters, encoded slash delimiter, query and path suffixes, including dot-segment paths. URL fragments are not sent in HTTP requests. Parsing errors rejected before Nginx selects a virtual server/location cannot be safely scoped to these route log directives; external proxies/CDNs and upstream systems outside these four configs are also outside this proof.

## Revision and files

- Git HEAD at checkpoint: `5a9766b` (no commit made for this pool).
- Changed:
  - `infra/nginx/container.conf`
  - `infra/nginx/e2e-edge.conf`
  - `infra/nginx/arken-khar.space.conf`
  - `infra/nginx/arken.uixray.tech.conf`
  - `scripts/test-nginx-bearer-log-protection.mjs`
  - `.tmp/nginx-bearer-runtime-20261009/index.html` (synthetic runtime fixture only; no build/download)
  - this checkpoint
- Existing unrelated dirty work is preserved. No frontend/backend code, production service, or persistent container was changed.

## Verification

- `node scripts/test-nginx-bearer-log-protection.mjs` — PASS; 7 protected route blocks across 4 Nginx configs, raw `$request_uri` filters, internal targets, no-referrer headers, redirect preservation.
- `docker run --pull=never --rm ... nginx:1.27-alpine nginx -t` — PASS for `container.conf`, `e2e-edge.conf`, and combined canonical/legacy domain vhosts with synthetic local TLS files. Combined vhost check retains the pre-existing duplicate `.arken-khar.space` warning; syntax test succeeds.
- Cached-image, disposable loopback `container.conf` runtime — 5 path/query/dot-segment probes returned 404 with `Referrer-Policy: no-referrer`; marker absent from container logs and ordinary request logged. This early run used an empty static fixture and is superseded by the happy-path gate below.
- Cached-image, private-network edge→web happy-path using edited edge/container configs and a synthetic local `index.html` — final clean-exit test passed 12/12 `curl --path-as-is` variants: GM/join, case/query, encoded letters/delimiters, repeated slash, encoded leading slash, and dot-segment paths. Every response was HTTP 200 with the expected fixture body and `Referrer-Policy: no-referrer`; an ordinary route was also HTTP 200 with the fixture body. The ordinary request appeared in both edge and web access logs; synthetic marker was absent from both logs.
- A first edge runtime attempt omitted the `server` network alias referenced by the existing edge config and returned an empty response; this was corrected by providing both `web` and `server` aliases. A subsequent plain-web-only upstream logged its request marker, as expected without the edited web-container policy; final edge→edited-web run showed neither edge nor web log contained it.
- Happy-path QA exposed that rewriting to the private target alone did not stop the original query being forwarded to the web log. The edge and canonical HTTPS proxy now terminate query args in the internal rewrite (`rewrite ^ /__arken_sensitive_index? last;`) and proxy the SPA root. This preserves the browser's old URL while the upstream receives no bearer path/query.

## Tooling incident / boundary

One earlier diagnostic `docker run node:20-bookworm-slim` omitted `--pull=never`; Docker pulled that image before the command was interrupted. The image is left cached and was not used as QA evidence or removed. All Nginx checks above used the already-cached `nginx:1.27-alpine` with `--pull=never`. A PowerShell array cleanup initially failed to remove temporary resources; I inspected the exact resources' mounts (all pointed to this worktree's owned configs/fixture) and then removed 22 individually listed test containers and their 10 private networks. The unrelated existing database container was not touched. No production reload, deployment, remote access, or service restart occurred.

## Residual / next action

This closes only the owned Nginx log/referrer boundary for syntactically accepted HTTP requests and proves synthetic SPA delivery through the edge→web hop. Malformed request-line/parser errors occurring before route selection, external reverse proxies/CDNs, and upstream services are not covered; inspect those layers separately before making a global “bearer never logged” claim. Root owns integration and any subsequent changes.
