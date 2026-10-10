# Open registration + SMTP — bounded integration plan, 2026-10-09

## Decisions and evidence boundary

Owner now approves **Nodemailer dependency** and **registration by anyone with an email, with mandatory verification**. This supersedes the dependency/public-signup decision blockers in the previous mail/next-local-pool plans, not provider provisioning or production activation gates. No invite-only restriction, allowlist or manual registration approval may be introduced. Campaign invitations are a separate authorization mechanism.

Source review at HEAD `1644be807abbacad3e4c05a2cc54cb5fd5c9ef2b`; concurrent SMTP worker may change its owned files. Read current contracts, env, auth route readiness and index/routes wiring plus mail/runtime checkpoints. This document is a plan, not implementation/test/delivery evidence. Accepted crypto, PG, runtime/privacy, browser/legacy-link and image gates are not reopened here.

## Existing behavior and exact gap

- `packages/contracts/src/account-auth.ts`: registration is strict email/password, no invitation field. Current register route validates origin/input/rate limit, checks registration flag and mail readiness before hashing/DB, creates user + action token + encrypted outbox transactionally, returns generic accepted 202. Existing unverified account registration does not replace its password. Verification is explicit one-use POST; unverified/disabled accounts cannot log in. No new schema or migration is needed to permit open signup.
- `account-auth-routes.ts:97,255–273`: advertised registration and admission require account enabled + registration enabled + runtime enabled + ready adapter + active key. Retain this fail-closed invariant.
- `index.ts:97–109` and `routes.ts:1045–1047` still independently use `unconfiguredMailAdapter` and parse keyring. A tested SMTP adapter alone does **not** make real registration runnable. A shared validated bootstrap context must reach both runner and auth routes.
- `env.ts`: registration enabled and policy-approved flags default false; production requires explicit policy approval. Owner's decision now permits that policy configuration in a separately authorized environment; do not delete the guard or silently flip deployment defaults. Campaign creation flags/policy approval are independent, default off.

## Behavior to preserve at integration

| State | Required behavior |
|---|---|
| Complete explicitly enabled runtime, valid key and configured transport, signup enabled | Capabilities registration true; any valid email/password request may queue without campaign invite. |
| Runtime off, missing transport config or active encryption key | Registration capability false; direct signup fails closed, no new user/token/outbox writes. Preserve existing 403 when signup flag itself is off and 503 for delivery unavailable. |
| Configured transport later unreachable | Queue transaction may already be accepted; bounded retry/expiry applies. Configuration-ready is not provider-health or inbox evidence. Never change accepted copy to “sent”. |
| Verify link GET / email scanner | No consumption or login side effect; explicit confirmation POST required. |
| Verified new account | Login works; zero campaign memberships/ownership and empty campaign list until separately authorized action. |
| Existing GM/PLAYER campaign link | Existing provenance, role/revision/revocation/expiry validation remains; no automatic account binding, nickname/email alias authentication or ownership claim. |

No-store on account success/error responses and generic known/unknown outward replies remain. Public signup means eligible to request an account, not bypass password policy, origin validation or anti-abuse limits. A disabled mail transport must not prevent already verified users from logging in or invalidate existing campaign links.

## Ownership and immediately actionable next Luna pool

**Active music_mixer ownership (root expanded during planning):** dependency/lock update, SMTP adapter/config, shared bootstrap mail context, index/routes injection and focused SMTP/TLS/abort tests. This resolves the initially separate wiring ownership gap. No second worker may edit those files in parallel. After freeze, review actual bytes and assign only missing connected harness coverage.

**Connected implementation prompt for current expanded Luna pool; follow-on worker owns only uncovered tests, not duplicate wiring:**
> Implement production-code mail wiring, not production activation. You are not alone: preserve all concurrent edits. Own only `apps/server/src/index.ts`, narrow `routes.ts` injection signature/call sites, a small shared account-mail bootstrap/context module if necessary, one focused connected integration test file and your checkpoint. Root must release any shared env/config file first; use the SMTP worker's validated config/factory unchanged where possible. No auth/contracts/schema/crypto/outbox rewrite and no new dependency. Build adapter/keyring/runtime eligibility once and pass that same context to scheduler and account routes. Fail closed before accepting signup when disabled/incomplete; do not use a fake sink in production, auto-start at module import, create another scheduler or run network verify per registration. Preserve start-after-listen and stop/abort-before-DB-close lifecycle. Keep all activation defaults off, retain existing legacy campaign-link behavior and no automatic account/campaign binding. Do not enable campaign creation or invent account storage entitlement.
>
> Gate the new boundary with synthetic loopback SMTP/TLS through the real Nodemailer adapter, existing real scheduler and registered HTTP routes. No direct drain-as-substitute, manually calling the sink, DB token extraction, public test endpoint, real credentials/provider/network or deployment. Follow the connected sequence below, then one focused type/build/test gate. Use only approved installed dependencies; no broad regression reruns or old image acceptance transfer. Return changed files + frozen SHA/hashes, exact test receipts and limitations. Stop at local integration.

### Connected acceptance sequence (new boundary, not old full-auth re-audit)

1. Disposable test DB and loopback SMTP/TLS fixture, generated synthetic identity/key, production-equivalent certificate validation (private test trust only in harness). Register routes using the same bootstrap factory/context as index. Start runner only after HTTP listener. Inspect capability true under explicit synthetic signup policy config.
2. Register without invite: accepted 202/no-store and queued wording. Before confirmation, login denied and membership/campaign counts zero. Let the real scheduler deliver; observe final DATA acceptance in fixture memory, never a public token endpoint. Confirm decrypted token URL is only obtained from that accepted mail in the harness.
3. Explicit confirm then login and list campaigns: verified account, empty list, no GM ownership. One confirm replay negative is sufficient for this boundary; no repeat of full token/concurrency suite. Public-facing copy stays accepted/queued, not delivered.
4. Table-driven negative readiness: runtime off, absent transport, absent active key. For each: registration hidden/unavailable, direct request rejected, zero new user/token/outbox writes. Ensure routes and runner cannot disagree. Existing verified-login functionality remains available with transport off.
5. One transient SMTP failure then recovery: accepted queue remains durable/retryable and later receives final SMTP acceptance; no secret in captured logs/DTO. Stop during active send: actual adapter closes IO and runtime settles before DB close; no new work after stop. Reuse adapter owner's protocol/error/TLS cases rather than duplicating their entire matrix. Preserve at-least-once semantics; do not assert exactly-once delivery.
6. One narrow frontend case with creation capability false: open signup form and queued confirmation remain usable; after verified login, empty My Campaigns does not invent a campaign or present registration as invitation-only. Reuse existing UI tests; web file changes need a separately named owner only if this case exposes a defect.
7. Source diff review confirms link routes/provenance logic unchanged and account ownership nonbinding; accepted legacy-link gates remain their existing receipts, not newly claimed tests. If shared wiring changes their behavior, run only the affected case.

Receipts must separate queue committed, synthetic SMTP accepted, verified account and inbox delivered (**not tested**). Record adapter config readiness separately from remote availability. Never retain bearer/password/key/SMTP transcript body in reports, traces, screenshots or logs. Email address in users is intentional, plaintext token or mail body in outbox is not. Process-level restart/DB-stall behavior is not proved by this focused lifecycle fixture unless actually exercised; reference existing PG/recovery receipts at their exact revisions.

## Remaining owner/environment questions, not reasons to impose invite-only

1. **Campaign creation entitlement:** may every verified user create campaigns, how many, which quotas/resource limits and abuse response? Existing limit default 3 and global media quota are implementation defaults, not approved public entitlement or unlimited storage. Keep creation capability off until this decision, while open registration and accepting legitimate campaign invitations remain usable.
2. Provider/SMTP endpoint and allowed auth/TLS mode, sender identity/domain, DNS/email authentication and permitted external acceptance/inbox check. Nodemailer approval is not permission to purchase a provider or read credentials.
3. Secret/key provisioning, rotation and backup, operational queue alerts/retry/dead-letter ownership, registration-abuse operating thresholds and activation timing. No new paid anti-abuse provider is implied.
4. Explicit release/environment activation and fresh candidate after source/dependency change. The `2c35435` images do not contain the future SMTP integration; do not relabel them. No remote/deploy/push/merge actions are authorized here.

## Checkpoint

Decision: signup policy is resolved as open-with-email-verification; implementation already has the required account admission contract. Remaining local source work is shared adapter/bootstrap wiring in the expanded active music_mixer pool plus a bounded connected SMTP signup gate. Changed only this plan. Verification: targeted source read, no tests/processes/network/dependency install. Blockers: adapter freeze for integration; owner campaign-creation entitlement and provider/environment activation remain separate. Next action: music_mixer finishes its expanded pool; review frozen bytes/receipts, then root assigns only missing harness tests. No second wiring worker, auth redesign or broad audit.

