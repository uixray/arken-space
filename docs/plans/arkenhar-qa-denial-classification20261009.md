# ArkenHar QA denial classification — 2026-10-09

## Scope and decision

Read-only attribution of HTTP denials from the retained built-candidate smoke receipts. No replay, runtime, auth/session operation, DB access, product edit, Linear update, or evidence waiver was performed. The evidence supports classifying the unauthenticated bootstrap `401` as expected auth-gate behavior. It does **not** support assigning every built-smoke `403` to a specific endpoint or actor. Keep the built gate **PARTIAL**; do not call all 403s expected/clean.

## Revision and evidence

- Source examined at `7c71c3f9b24ade5e2b2e04f6f98b5b6544f2ed85` (read-only source attribution).
- Initial retained built receipt: `.data/qa-prep/arkenhar-built-candidate-691d352-20261009/browser-smoke/smoke-20261009T045328212Z.json`, SHA-256 `C4F8D903504F1EA09610E9C2716BF9F08CB0F3C11837A2423B077C0EFC3183F3`.
- Follow-up retained built receipt: `.data/qa-prep/arkenhar-built-candidate-691d352-20261009/browser-smoke/smoke-20261009T045550738Z.json`, SHA-256 `C536CC6B9EF308073405646D576C27C5455494C6DA4809945563A76B3E189307`.
- Existing P1 diagnostic used only for its sanitized endpoint-family/phase classification: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-missing-cases-20261009-042937736Z.json`, SHA-256 `9B845600F6302075B5D6D444766FE6C6119582D7499896B4C8386A3A1D117464`.

The built receipts retain `401 / bootstrap` and `403 / api`; path/resource type is intentionally absent for the 403. They also retain blocked nonlocal-egress events (including expected external-safe-request failures) and console-error events in the follow-up. Those remain evidence, not clean passes. The source imports Gravity UI fonts, whose stylesheet imports Google Fonts; this is a plausible source of the blocked external GET, but the sanitized receipt does not prove that exact URL/resource.

## Source attribution

1. `App.tsx` starts with `GET /api/bootstrap`; `401` is caught and switches to the auth gate. `routes.ts` protects bootstrap with `requireAuth`; `auth.ts` returns `401 AUTH_REQUIRED` for no session. This is the expected unauthenticated transition, not proof of authenticated app health.
2. After an authenticated snapshot is present, `App.tsx` invokes `fetchOperatorCapability()`. `operator-feedback.ts` maps that to `GET /api/operator/feedback/capability`. The server requires operator membership; `requireOperator` returns `403 OPERATOR_REQUIRED` if the authenticated membership ID is not in `OPERATOR_MEMBERSHIP_IDS`.
3. A sanitized P1 diagnostic classifies some GM smoke 403 callbacks as `api:operator/feedback`, phase `join-action`. This is a broad family and a response-callback label, not a request-start correlation or exact route. The built-candidate receipts do not carry that attribution. Do not infer that their 403s are the capability endpoint, or infer authorization policy for a specific test identity from GM/PLAYER role labels. Operator authorization is membership-ID based; the live allowlist was not inspected.
4. The client catches capability-fetch failure and leaves the operator-feedback capability disabled. `api.ts` records API failure in its in-memory diagnostics; this GET is not a mutation operation and does not itself produce a client mutation log. A smoke harness HTTP-failure event is also not equivalent to a browser JS console error; the retained console errors require separate triage and are not attributed here.

## Initiation vs response phase

The P1 helper labels HTTP failures when its `page.on('response')` callback runs, using mutable current `stage`/`authPhase`. Its request listener retained method counters, not a request-ID-to-phase correlation. Consequently, `join-action` records when the response callback was observed; it does not prove when the request began. The built receipt is even coarser (`api`). No phase or route attribution should be promoted beyond those limits.

## UI/noise assessment and next action

The source does not show an uncaught capability-fetch exception: the failure is caught and the feature is disabled. It does show an authenticated capability probe for any snapshot, with server-side membership authorization. That may create expected 403/network noise for non-operator members, but changing its timing or eligibility is a product decision. Role-only short-circuiting is not justified by current evidence because role is not the server's authorization predicate. If the owner later wants to reduce probes, assess a server-provided capability or lazy fetch on opening the operator area; do not change product behavior in this attribution pool.

No runtime was run for this pool. Existing smoke evidence remains **PARTIAL** due to retained blocked external safe requests and unclassified 403s (plus other recorded failures); auth is not registration, and this is not a publication-ready gate. Next action: root/QA owner may use this attribution when deciding whether a future, approved smoke should add safe per-request correlation or whether the owner wants a narrowly scoped UX/product decision. Preserve receipts unchanged.

## Later exact capability probe (root-run, 2026-10-09)

Root reports one separately authorized current-ACL probe completed with exit 0. Retained receipt: `.data/qa-prep/arkenhar-capability-denial-20261009.json`, SHA-256 `5BEF9FC2C1EF211E0348855EA37129B940230B57819E4F160D186E552EF7E49C`. The probe observed an authenticated GM session with bootstrap `200`, role/campaign match, and exact `GET /api/operator/feedback/capability` returning `403 OPERATOR_REQUIRED`; it recorded one natural QA auth session and zero domain writes. This directly confirms the expected membership-denial behavior for that specific probe identity and endpoint.

This new evidence does **not** retroactively identify the endpoint behind the older built-smoke `403`s, convert their broad `api` family into a precise route, waive retained external/other failures, or close a product issue. The aggregate built-candidate gate remains **PARTIAL** unless separately re-evaluated against its full criteria.
