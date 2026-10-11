# Real account authentication implementation plan — 2026-10-09

## Owner correction — campaign links retained (2026-10-09)

Owner explicitly requires former GM/PLAYER campaign links alongside classical account registration/login, and clarified this is not email magic login. Earlier blanket disabling of all legacy bearer campaign access in this document is superseded **only for explicitly enabled, freshly validated link authentication**. Public nickname/alias lookup and provenance-less historical sessions remain rejected; no automatic account ownership binding.

Root freezes dual session identity: ACCOUNT parent session retains verified account/membership ownership checks; GM_LINK records campaign credential/revision and GM role; PLAYER_GRANT records active grant ID/revision with membership/campaign/PLAYER match; one-time legacy invite claim records consumed invite provenance and matching membership/campaign, expiry at issuance and finite session/revocation thereafter. Every HTTP/socket action revalidates source; rotation/revocation cannot retain a valid stale source. Add mutually exclusive provenance schema constraints, no plaintext tokens/copies, no historical backfill. Campaign link capability is explicit and independent of DEV alias access. Negative/revocation/concurrency tests required before public acceptance.

Linear UIX-657 scope decision comment b4506a77-1dda-4278-972d-2bf83e2c9d11. Implementation in progress, no acceptance claim. Public mail queue, new-account creation policy and remote activation remain separate gates.
## Authorization and sequence

Owner explicitly requests authentication **now**; earlier auth deferral is superseded. This authorizes local source implementation and disposable tests, not production migration, credentials, SMTP provisioning, deployment or remote access. Root is clarifying open verified-email registration versus invitation-only signup asynchronously. Implement mode-neutral verified-email/password/session foundations while that answer is pending; do not silently choose public signup policy or replace accounts with secret links.

Root additionally requires a complete verified-email/recovery lifecycle. Use a transactional mail adapter with an isolated local test outbox. Missing production SMTP is an explicit fail-closed activation gate, not a reason to omit verification/reset or pretend mail was sent.

Starting inspected HEAD `d8e8b51b630e4c707cbe39b8e7554028c04d9b5c`, dirty audio and item workers in progress. Preserve App/MusicBar/styles/socket-subscription and instance files. Current coherent `aca1436` package predates auth and must remain immutable. This plan changes only this file; no runtime/tests/Linear changes.

## Live scope / source facts

- UIX-657 Backlog: registration/login, My campaigns, self-service campaign creation, GM first scene, invite, empty/error/loading, setup and custom mode. Full task also includes installation/product page work, not all delivered by backend auth.
- UIX-525 Backlog: self-service campaign creation + A/B campaign isolation; creation permissions and media quotas are still explicit product questions. Auth approval is not automatic approval of unlimited global media consumption.
- UIX-527 Backlog: dynamic roster, no full beta roster in client, continuity for legacy entries; requires secure login migration.
- UIX-524 is Done in live Linear, **but current checkout still implements unauthenticated `/api/auth/player/:handle` and creates a session after public alias lookup** (`routes.ts`, approximately 1149). Record this discrepancy accurately at root stage gate; no closure claim based on status. No private identities/tokens were read.
- No users/password model. `memberships` is campaign-scoped; role/displayName/themes/revision, no account FK. `sessions.membershipId` is non-null; sessions store only SHA-256 token hash and expiry.
- `auth.ts`: `authFromSessionToken` joins sessions/memberships; `createSession` sets HttpOnly, SameSite=strict, production Secure cookie. `requireAuth` returns membership/campaign/role, used across existing domain routes.
- Realtime validates same cookie via `authFromSessionToken`; session-room disconnect and per-event `sessionIsActive` already exist. Preserve these, extend account-parent validity.
- `gmAccessCredentials` is campaign token hash. `playerAccessGrants` are persistent secret bearer grants. `/api/auth/invite` accepts those or one-time invites. Existing `invites` require a character, so they are not generic account/campaign invitations.
- `index.ts` has global rate limiter (600/min default), CORS configured WEB_ORIGIN, mutation Origin check only when header exists, `trustProxy:true`, unconditional `ensureSeed`. These are not sufficient evidence of hardened public account endpoints.
- `ensureSeed` chooses oldest campaign then runs `seedCampaignContent`, adding the historical beta roster/content/GM credential. **Never reuse it for a new user's campaign or run it on arbitrary public-account startup.**
- `AuthGate` is token/beta-login presentation; not real register/login/account workspace. `api.ts` already uses safe failure metadata; do not introduce bodies/credentials to diagnostics.

## Architecture: account identity separate from game role

Keep existing membership-authenticated domain routes intact where possible. An account may have zero or multiple campaign memberships. A verified account session alone has **no** game role or operator capability.

Add additive schema (exact migration number discovered from current journal; do not hardcode):
1. `users`: opaque UUID, normalized unique email key, original/display email as needed, password hash envelope, verifiedAt nullable, password/session version or equivalent revocation field, timestamps. No public email/member directory.
2. `account_sessions`: opaque ID, user FK, random token hash unique, expiry/revocation metadata; never plaintext bearer. Separate account cookie.
3. `account_action_tokens`: user FK, purpose VERIFY_EMAIL / RESET_PASSWORD, random token hash, expiresAt, usedAt. One-use consumption and credential change in one transaction; purge/revoke previous purpose tokens as appropriate.
4. Nullable `memberships.userId`, unique `(campaignId,userId)` for non-null accounts. Do not derive linkage from names, emails in campaign text or old sessions. Existing membership IDs remain stable to preserve character ownership/history.
5. Nullable `sessions.accountSessionId` for game sessions minted by a verified account selecting an owned membership. `authFromSessionToken` and `sessionIsActive` enforce parent/account activity for account-backed sessions. Logout/recovery revokes both account and derived game sessions and disconnects their socket rooms.
6. Later campaign invitation records separate from character-specific legacy invites: campaign ID, creator, fixed PLAYER role, hash, expiry, consumed/revoked state, optional explicitly approved character binding. Do not silently make legacy grants into new user accounts.

Choose one active game campaign per browser cookie initially, as current architecture already does. Selecting a different campaign rotates game session and disconnects old sockets; account session survives. Frontend must clear old snapshot/pending state before fetching the new one. Document that shared-cookie tabs follow the selection and lose stale access; no URL-controlled arbitrary campaign override.

## Backend pool A — implement now without public activation

### File ownership / immediate Luna assignment

One backend Luna owns new `apps/server/src/account-auth.ts`, `account-auth-routes.ts`, `password-security.ts`, `account-mail.ts`, purpose-token helper if needed, focused tests; new `packages/contracts/src/account-auth.ts` with narrow index export; `packages/db/src/schema.ts`, generated Drizzle migration/snapshot/journal; narrow registration in `routes.ts`; account session validity changes in `auth.ts`; narrow session revocation socket hook in `realtime.ts`; `env.ts` validation; index auth-security/seed/mail wiring only. Root reserves these shared files to this worker. Do not touch frontend/audio/instance files or unrelated schema.

A is **account lifecycle**, not campaign UI or a claim of full657. Return stable typed API before another frontend worker starts. Public frontend must not be activated against incomplete verification/reset routes.

### API contract to freeze

Proposed namespace `/api/account` avoids collisions with legacy `/api/auth/*`:
- `POST /register`: validate signup mode, email/password, create unverified account and verification delivery; never create GM/membership automatically. Pending owner mode uses registration disabled except explicit test fixture configuration, not invitation-only substitute.
- `POST /login`: generic invalid-credentials outcome; successful verified login rotates cookie/session. Unverified account gets restricted verification-only state, never campaign privileges. No hash/token response.
- `GET /session`: minimal current account + verified boolean (or anonymous); no memberships/global roster until separately scoped endpoint.
- `POST /logout`: revoke account and linked game sessions, disconnect, clear both cookie paths; safe idempotent anonymous outcome.
- `POST /verification/request`: resend with generic response and cooldown; anti-enumeration.
- `POST /verification/confirm`: single-use token; does not auto-claim any campaign or recover a different account.
- `POST /password/reset/request`: generic response; enqueue only for eligible account.
- `POST /password/reset/confirm`: consume valid purpose token and set password atomically, revoke all account/game sessions, clear current cookie; require fresh login.
- `POST /password/change`: verified session + current password; rotate/revoke sessions; no email change in A.

Use state-changing POST for confirmation, not email GET side effects (mail scanners must not consume tokens). Verification/reset links open UI forms with token held only as long as needed; clear URL via replaceState immediately after parsing. Prefer fragment token to avoid server access logs; no third-party resources on token forms. No raw token in analytics, screenshots, console, errors or test receipts.

### Password/session/security requirements

- Never use existing fast `hashToken` for passwords. Use async Node crypto scrypt with random salt and versioned encoded parameters; implementation starting configuration N=2^17/r=8/p=1, explicit sufficient maxmem, bounded concurrent work and request body limits. Tune only after isolated measurement and record actual parameters; do not silently downgrade to fast hashing. A maintained Argon2 dependency is an alternative only if root approves dependency scope, not a prerequisite.
- Practical password input: length at least 12, allow spaces/passphrases/Unicode, cap 128 code points and bounded UTF-8 bytes before hashing; no silent trimming/truncation. No arbitrary composition checklist. Generic login failures and dummy verification for unknown email limit timing/user enumeration; do not promise perfect indistinguishability.
- Random high-entropy session/action tokens, hash only at rest. Current randomToken(32) utility is appropriate for random bearer issuance; constant-time compare where relevant. Cookie HttpOnly/SameSite strict/path /, Secure in production, no Domain; exact attributes on clear. Rotate on login, selection and privilege/credential change; no bearer/localStorage/JWT substitution.
- Add strict bounded schema/body limits and per-route IP plus normalized identifier/purpose throttling for register/login/resend/reset. Prevent limiter bypass through untrusted X-Forwarded-For: do not inherit trustProxy=true as proof; production trusted-hop policy must be explicit before activation. No permanent account lockout that enables denial of service.
- Protect login and cookie-auth mutations against CSRF. Require configured exact Origin for account browser mutations, and a session-bound CSRF token/header on authenticated mutations; bootstrap/session can provide the non-authentication CSRF token. Test missing/wrong Origin and Fetch Metadata where supported, not only CORS. Ensure WebSocket handshake Origin guard as well as cookie validation for account-backed access. Do not silently break legacy CLI/test callers; keep legacy compatibility explicitly scoped/off in public mode.
- Redact password/cookies/authorization/action tokens and mail bodies at logger/error/telemetry boundary. No email/password/token in thrown validation detail logs. Emit safe audit categories with opaque user/session IDs, not secret materials.
- Transactional mail outbox/adapter: committed action-token issuance with reliable queued delivery semantics, no claim success before durable queue/adapter acceptance. Local test adapter keeps messages in scoped test memory/outbox accessible only to test harness, not a public HTTP dev endpoint, terminal logs or committed fixtures. Production driver must fail closed if absent/misconfigured; application may serve existing sessions but registration/verification/reset must never falsely report actual delivery or mark users verified. Generic outward response should not leak account existence; diagnostics private and redacted.
- Expiry planned defaults: verification 24h, reset 30min, configurable rate cooldown; purpose-specific token cannot substitute for another purpose. Retry/replay/concurrent confirmation yields at most one credential mutation. Password reset does not auto-login.

### A acceptance (one connected disposable gate)

- Register → test mail → explicit confirm → login → session → logout; unverified account cannot create/select a campaign or use a game route.
- Database has encoded salted password hashes, never password/plaintext session/action tokens; equal passwords produce unequal salted hashes.
- Duplicate registration/login/reset responses do not expose arbitrary accounts; invalid input bounded before expensive hash; rate limits work, including spoofed forwarding headers under test configuration.
- Expired/reused/wrong-purpose verification/reset tokens rejected; concurrent consumption one winner; old sessions and already-connected socket actions rejected after password reset/logout.
- Cookie attributes, rotation/fixation rejection, Origin/CSRF rejection, verification-only session boundary, no credentials in logs/DTO/errors.
- Migration works on disposable fresh schema and representative legacy fixture without changing membership ownership or corrupting content. No retainedQA/prod migration.
- Local test-mail driver works; production missing driver is explicitly blocked; no external email sent.

### Immediate self-contained prompt

> Owner now authorizes real auth source implementation; earlier deferral is revoked. Implement backend pool A from this plan: email/password account, verification/reset transactional tokens/mail adapter, account cookies/sessions, logout/revocation, rate/CSRF/log safety, additive schema/contracts and disposable tests. Root still awaits public-open versus invited signup policy; keep signup disabled by default outside explicit tests until recorded, but build complete mode-neutral lifecycle now. You are not alone: own only listed backend/DB/contracts files; preserve dirty MusicBar/App/styles/socket-subscription and instance work. No frontend edits, production migration, secret/env reads, SMTP provisioning, remote/deploy. Do not use token links instead of accounts, auto-bind legacy memberships by name/session, or leave nickname login active in public account mode. Return frozen API/types, migration impact, actual command/test evidence, unresolved activation prerequisites and exact files/revision. Source completion is not production-ready auth.

## Backend pool B — My campaigns, empty campaign and player invite

Begin after A contract gate and owner's signup/create policy; same backend worker continues to avoid schema collisions. Own dedicated `account-campaigns.ts`/tests and narrow registrations, not whole routes rewrite.

- `GET /api/account/campaigns`: only account-linked memberships, role/name/minimal metadata. Zero memberships is valid; no fallback to oldest campaign.
- `POST /api/account/campaigns`: verified account, approved creation policy; atomic campaign+GM membership+minimal first scene/audio/default system state. Do **not** call `seedCampaignContent`, copy beta players/lore, or use env GM token. Request idempotency bound to account/payload. Use existing custom system defaults; no fake system chooser with unsupported rules.
- `POST /api/account/campaigns/:id/select`: only account-owned membership; rotate derived game cookie; disconnect former session, return canonical selected-membership identity. No arbitrary role in request.
- GM-only new campaign invite create/revoke; PLAYER role fixed, short finite expiry/one use; claim requires verified account. Atomic race-safe unique account membership, no public roster, no owner role escalation. Clear distinction: invite grants campaign membership **after** real account login, it is not login replacement.
- Optional character assignment only with campaign-owned character and explicit approved route contract; no need to block generic campaign joining on a character.
- New campaign members/roster come from DB, not beta constants. Existing operator allowlist is not granted to newly created GMs.
- Media quotas: reuse hard storage/free-space enforcement, do not market per-user isolation as complete. Owner decides public campaign-creation policy/cap; plan bounded configuration before internet activation. No billing implementation.

Acceptance: unrelated verified accounts A/B create/select their own campaigns; foreign IDs denied for scenes/tokens/chat/characters/assets/requests and direct content; account cannot become GM by input. Include intentionally broken-filter check in a disposable test harness if feasible, never temporary unsafe production code. Invite expired/revoked/replayed/concurrent claims; logout/campaign switch/socket stale requests; fresh startup does not inject beta content into either account campaign. This is focused new multi-account isolation, not blind replay of every legacy test.

## Legacy transition: continuity without a bypass

Account mode must disable `/api/auth/player/:handle`, beta roster UI/export paths and other unauthenticated identity shortcuts. A code comment calling it beta is not isolation. Do not infer UIX-524 completion from live status.

Old sessions have no trustworthy issuance provenance (alias and secret routes produce identical session rows). Therefore never offer “link this logged-in beta character” based only on existing session. A secure activation migration must revoke old unbound sessions (game state/memberships remain), requiring proven re-entry. Document forced logout as migration effect before production gate; do not execute it now.

Legacy GM/grant continuity requires a **separate explicit owner-binding workflow** with account verified identity and fresh authoritative proof/mapping, plus race-safe uniqueness and revocation. Do not expose universal online claim via old known aliases or try to find secrets in env. No automatic binding in A/B. Preserve membership/content IDs and references; export/read existing private campaign only under later authorization. UI states explain unlinked legacy membership without pretending data disappeared.

Keep legacy token routes either disabled in public account mode or explicitly confined to an isolated legacy configuration; no silent public fallback. New accounts cannot create legacy credentials. `ensureSeed` must be gated to deliberate legacy/test seed operation; public account-mode startup must not reseed oldest campaign. Preserve explicit existing fixture helpers for old tests but do not call them for self-service creation. Root must ensure global account mode/seed configuration is coherent at activation, not a loosely documented optional checkbox.

## Frontend pool C — after API gate and music worker releases App

Ownership: `AuthGate.tsx` narrow routing/presentation, new account-client/account-form/MyCampaigns components and local CSS/tests; account session hook; narrow `App.tsx` account-vs-campaign entry state only after audio worker hands it back; `api.ts` CSRF plumbing if contract requires. No MusicBar or instance edits; no shared stylesheet bulk rewrite.

Anonymous → register/login; unverified → resend/confirm state; verified with no selected membership → My campaigns/create/join; selected → existing VTT. Distinguish unauthenticated from no-campaign and forbidden. Preserve existing landing/guide author text; functional form labels/errors only, no new marketing/lore. Verification/reset forms consume POST after user action; clear token URL; don't log/form-cache secrets. Real password fields with appropriate autocomplete, accessible keyboard/error/loading, duplicate-submit guard. No plaintext passwords/tokens in localStorage. Account menu provides password change/logout; real reset path, not a dead “forgot password” label.

My campaigns links to actual newly created first scene, invite creation/copy and account-required join; direct character/GM links cannot bypass account mode. Campaign switch clears old snapshot/socket and rejects late responses. Compact/desktop synthetic browser flow registers/verifies via isolated harness outbox, creates campaign, invites second account, verifies isolation and logout; true browser/API use on disposable localhost preferred over mocking all auth. No delivery to real mailbox.

This delivers the requested account-first core; product positioning, all onboarding prose, supported alternative rulesets, export/import and self-host operational acceptance remain explicit UIX-657 residuals.

## Genuine decisions / blockers, not blanket pause

- Await root's exact answer: open verified-email registration or invitation-gated account registration. A can proceed now; do not choose a public mode silently.
- Production transactional mail transport/sender plus domain verification/config is later environment work. Implement adapter/tests now; no external provider selection, invented SMTP or unaudited fallback.
- Campaign creation entitlement/cap and public storage budget from UIX-525 must be recorded before public activation; account lifecycle is independent.
- Existing campaign account binding requires owner-approved identity mapping/proof; never auto-migrate by nickname. Does not block accounts/new isolated campaigns locally.
- Remote cloud quota/TLS/current backup/rollback/prod migration remain outside this code authorization.

## Checkpoint

Decision: backend lifecycle A now; campaign B then frontend C, preserving parallel audio/item ownership. Verified-email/reset not omitted, account links not substituted by secret-link login. Revision d8e8b51 with listed dirty work. Changed only this plan. Evidence live657/525/527/524 + targeted auth/schema/routes/realtime/seed/frontend source; no runtime or security acceptance claimed. Next root dispatch backend Luna immediately and resolves signup policy asynchronously, then records API gate before App integration.

