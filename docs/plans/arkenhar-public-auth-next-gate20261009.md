# ArkenHar — public account/auth next gate, 2026-10-09

Status: PLANNING ONLY / HOLD. Publication NOT READY. This document does not authorize implementation, database changes, runtime launches, mail delivery, remote access or deployment.

## Basis and precedence

Read-only baseline HEAD `079c1f558893c410567b9e3a421b4561261dce1d`; latest root checkpoint reports product `52013d4`. Owner selected full authorization, then explicitly deferred implementation until remaining preparation is assembled. Preserve that ordering. Legacy brief/architecture exclusions of public registration are historical, not permission to narrow the new goal to GM secret links. UIX-657 is the locally recorded first-run/auth issue; root must refresh Linear at activation, not infer its current status from this document.

Latest checkpoint: rollback Gate1 fresh pre-write B0 passed in a disposable clone, not rollback as a whole; 173 historical media references unresolved; human/native, main/remote and publication gates remain open. Authentication must be implemented and separately accepted before publication. Completing earlier local prep cannot automatically activate auth work or waive missing-media acceptance.

## What exists, and what it does not prove

Source inspected, no credentials or private runtime evidence read:
- `apps/server/src/auth.ts`: sessions resolve directly to campaign membership; AuthContext is membership/campaign/role/displayName, not a service account. HttpOnly strict cookie with production Secure, expiry and hashed opaque token already exist; preserve these properties rather than replace them with browser token storage.
- `apps/server/src/routes.ts` near 995–1115: GM bearer login; reusable PLAYER grant or single-use invite claim; **temporary public-alias `/api/auth/player/:handle` shortcut**; logout deletes a session and disconnects its socket room. This alias route needs removal or an explicit fail-closed non-public development boundary before a public release. Hiding its UI is insufficient.
- `packages/db/src/schema.ts`: campaign membership, invites, playerAccessGrants and membership-bound sessions. Existing character ownership and campaign IDs are domain identity; migration must preserve them. No account email/password lifecycle found in the inspected schema/route surface.
- `apps/server/src/realtime.ts`: membership/session-based authentication and campaign/GM rooms. Account introduction must preserve per-campaign authorization and active-session invalidation.
- `apps/web/src/App.tsx`, `apps/web/src/LandingGuide.tsx`: existing application/landing, not evidence for signup, recovery or My Campaigns.

Existing GM/PLAYER QA fixtures and four-cell built smoke prove only named legacy access paths. They do NOT prove registration, email ownership, password recovery, creating one's own campaign, multi-campaign account isolation or secure transition of existing identities. No replay of legacy smoke can close these missing criteria.

## Owner decisions — ask at the activation gate, not repeatedly during prep

1. **Timing:** after root presents remaining preparation results and unresolved release constraints, explicitly activate the bounded full-auth sequence. Do not ask again whether secret links are sufficient: that choice is already rejected.
2. **Signup policy:** recommend self-service verified-email/password accounts, with campaign invitations controlling campaign access (not account creation). Owner confirms open signup versus restricted signup with real accounts. Neither variant may silently replace the requested public registration capability.
3. **Existing real campaign continuity:** owner identifies which real campaigns/members should transfer and to which verified accounts, or elects fresh accounts/campaigns with old data retained. Never infer ownership from display names, public handles, or QA identities. Use proof-backed migration/claim approval; a bearer secret alone must not become unrestricted permanent account ownership without a reviewed policy.
4. **Operational account policy:** approve a transactional-mail sender/service and support contact, and a small-service account deletion/owned-campaign disposition policy (retain/archive, explicit delete, or transfer). This is a product/data-retention decision, not justification to add a large admin product. Live sender/domain configuration requires separately bounded access permission.

Not owner decisions: exact modules, token hashing, password KDF/library selection, DB indexes, transactions, collision handling, rate-limit implementation, endpoint spelling, test fixtures and request validation. Luna proposes these with source-backed tradeoffs; root integrates. No need to ask the owner to choose every security parameter. OAuth, billing, enterprise roles, organization accounts, social profiles, MFA and automated owner-transfer UI are not required by this first service scope. Do not silently promise them. Email change can remain unavailable initially; address correction must use a verified support process, never an unverified write.

## Sequential bounded Luna assignments

One active pair maximum. Backend/shared contract owner and frontend/test owner may run in parallel only after contracts are frozen; neither reverts the other's changes. Root owns integration, Linear stage gates and permission decisions. Assign concrete files after each gate, not a blanket repository-wide rewrite. Every pool returns decisions, revision, changed files, exact verification, blockers and next action; no per-micro-change review loop.

### A0 — activation and design contract (source-only)

Owner: Luna architecture/contracts; output one implementation plan plus reviewed contract/schema delta, no source changes until root accepts.

Inputs: this plan, latest checkpoint, live UIX-657, current Git delta; narrowly inspect all auth callers, frontend entry flow, session/socket gates, schema/seed and existing ACL tests. Deliver account-vs-membership model, lifecycle state table, route/error contract, abuse/threat cases, migration/backfill/rollback approach, resource bounds and explicit existing-identity transition. Recommended model separates account session from selected membership; selecting a campaign never grants its membership and cannot leak previous campaign caches/rooms across tabs.

Gate: owner decisions resolved or bounded as explicit unresolved items; no unknown public bypass left in route inventory; names/roles/operator privileges never trusted from client. Migration stage has backup and backward-compatibility window before implementation. No current QA DB migration authorized by this plan.

### A1 — identity and recovery backend (connected implementation)

Owner: backend Luna exclusively owns new account/auth service/routes, shared account contracts, additive DB schema/migration and backend tests. Thin integration edits to existing auth/routes/realtime only in assigned ranges. Do not refactor unrelated VTT domains.

Implement verified email/password registration, sign-in/out, current-account state, reset request/consume, authenticated password change, expiry/revocation and account disable/deletion handling per approved policy. Use a vetted password KDF, hashed expiring single-use verification/recovery secrets, generic recovery responses, bounded attempts, safe redirect allowlist, session rotation after identity change and revocation on reset/disable. Never log credentials/reset URLs or place them in analytics/screenshots. Mail adapter fails explicitly; local fake mail is not delivery proof. Keep unverified accounts out of protected campaigns until verification. Define resends/retries and duplicate signup races without duplicate identity rows.

Gate: focused contract/DB/auth suite covers concurrent duplicate registration, wrong credentials, enumeration-resistant reset responses, expired/reused tokens, reset invalidating old password/sessions/sockets, CSRF/origin protections on cookie-auth writes, throttling and mail failure. Fresh migration and representative preserved-data migration tested on disposable stores; no assertion that mocks prove real mail. Removal/fail-closed boundary of alias shortcut tested through HTTP, not just UI.

### A2 — campaign account authorization and legacy transition

Owner: backend Luna continues same bounded modules; frontend Luna may start account screens only against frozen A1/A2 contracts. Preserve existing membership IDs and domain ownership; do not rewrite all records around email strings.

Implement authenticated My Campaigns, transactional own-campaign creation with initial GM membership and required initial domain state, explicit campaign selection, account-bound single-use invite acceptance, safe duplicate/retry behavior, leave/revoke membership and immediate session/socket authorization refresh. Player invited to another campaign does not become GM; GM of A has no power in B. Account creation does not make an operator. Existing operator allowlist/capability must remain separately controlled. Migration/claim flow cannot silently link shared aliases or replace real members with synthetic fixtures. Public legacy bearer endpoints disabled/retired according to accepted transition, not left as an unreviewed backdoor.

Gate: DB+HTTP+Socket.IO tests use two independent accounts and two campaigns: anonymous/no-membership denied; GM-A cannot read/write/invite/select media in B; PLAYER cannot grant roles/manage global catalog/operator tools; character owner/controller rules survive; invite expired/reused/revoked/wrong campaign and concurrent claim fail safely; revoke/disable disconnects or blocks live socket reads and writes; tab/campaign switch clears prior private snapshots and rooms. Check shared global content policies separately from campaign-private assets. Account role must never be a global GM switch.

### A3 — public first-run UI and lifecycle (one connected UI pool)

Owner: frontend Luna owns new account/first-run screens and focused UI tests; backend edits go to A1/A2 owner. Integrate landing signup/sign-in, verify/resend, forgot/reset/change password, My Campaigns empty/loading/error/list, create campaign and join invite, logout/session expiry and deletion/support path. New user must complete the flow without terminal seed, hidden tokens or operator intervention. Preserve accessible labels, keyboard/focus, error/retry behavior and no sensitive URL persistence. Keep service-small: no general admin dashboard or design-system rewrite.

Gate: focused component/route tests, web/server typecheck and fresh build once per integrated pool. Deterministic loading/error boundaries before browser QA. UI cannot render a privileged action as its only authorization defense. Mail-catcher evidence remains synthetic.

### A4 — independent acceptance and operational handoff

Owner: separate Luna reviewer/QA after integrated exact-revision freeze; root alone authorizes isolated runtime/data/mail scope. Do not reuse the accepted legacy fixtures as the only test identities.

Run one connected Chromium/Firefox desktop plus focused compact first-run/lifecycle matrix with newly created ordinary accounts in isolated DB/media/mail infrastructure. Prove registration → real local verification transport → login → own campaign → invite second account → role-safe play → logout/relogin → password recovery → old-session denial. Include unauthorized cross-campaign HTTP/media/socket attempts and protected legacy route denial. Record exact source/build/schema, request boundary, test identities privately, counts and immutable receipts. Owner separately performs a real delivered-mail verification/recovery and the intended owner/friends workflow against the approved candidate; local mail capture does not count as that gate.

Root release gate requires fresh paired DB/media backup, reviewed account migration and rollback rehearsal for the auth-modified schema, secrets/sender/cookie/TLS/origin deployment configuration, narrow public-route review and an exact built candidate. Earlier source52013d4 evidence is context, not automatic acceptance of auth changes. Rerun impacted auth/ACL/socket/build gates; do not reinstate owner-excluded full legacy E2E under a different name. Human/native, missing-media, main ancestry and remote/deploy permissions remain separately tracked.

## Activation handoff and stop conditions

Next action now: root finishes remaining preparation, keeps this plan frozen, then presents A0/timing plus the four compact owner decisions. Do not start A1–A4 merely because this document exists. Stale local issue status is resolved by root reading Linear at that stage gate. No stage/status update by this planning worker.

Stop a pool on ambiguous real-account ownership, unsafe legacy compatibility, absent mail verification/recovery path, incorrect role/campaign boundary, or unrehearsed destructive migration. Report the exact prerequisite; do not solve it by alias login, secret-link-only access, a seeded account, blanket allowlists or omission of public lifecycle. Partial tests stay partial. No readiness claim until actual applicable gates pass.

## Planning checkpoint

- Decision: full auth retained; owner deferral respected; public account lifecycle is separate from current campaign fixture access.
- Revision: read-only baseline079c1f558893c410567b9e3a421b4561261dce1d; only this new plan is owned/changed.
- Verification: source/contract inspection and document diff only; no runtime, environment, private fixture, DB, network, browser, deployment or Linear access.
- Prerequisites: owner activation/signup/legacy-continuity/mail-and-retention choices; current auth caller inventory/migration design; remaining release preparation and independently scoped acceptance.
- Source index: `docs/plans/arkenhar-goal-checkpoint20261009.md` (through actual Gate1 B0); `docs/plans/arkenhar-active-pools20261008.md` (owner authdecision); `docs/plans/arkenhar-release-evidence20261009.md`; `docs/brief.md`; `docs/architecture.md`; `apps/server/src/auth.ts`; `apps/server/src/routes.ts`; `apps/server/src/realtime.ts`; `packages/db/src/schema.ts`; `apps/web/src/App.tsx`; `apps/web/src/LandingGuide.tsx`; parent workspace `AGENTS.md`; `D:/AI/.workspace/registry.yaml`.

## Root live task-source reconciliation — 2026-10-09
Linear UIX-657 refreshed directly: Backlog, no completion/start date, project arken-space, parent UIX-653. Its acceptance requires an unfamiliar user to understand the service, create a campaign and invite a player without author explanations. Scope also names GM onboarding to first scene, campaign/system/custom-mode settings and a clear self-hosted installation path; export/import is conditional, not silently mandatory. A0 must retain these first-run requirements alongside account lifecycle, not close UIX-657 merely from auth tests. Owner full-auth choice supersedes the issue's older alternative-access wording. No status/comment change at this read-only refresh; implementation remains HOLD.
