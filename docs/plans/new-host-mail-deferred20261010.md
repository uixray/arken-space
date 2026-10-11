# New-host mail scope decision — 2026-10-10

Owner explicitly deferred SMTP/provider setup and email-verification registration until later. This is not a pause of publication or a request for invite-only signup. Existing open-signup policy approval remains; activation is deferred.

## Current publication configuration

- ACCOUNT_AUTH_ENABLED=true (required for production); preserve recovered users and key/session policy.
- ACCOUNT_REGISTRATION_ENABLED=false; no new account signup promises.
- ACCOUNT_MAIL_RUNTIME_ENABLED=false; no provider sends or outbox drain. Retain encrypted outbox/key versions; do not discard pending data.
- CAMPAIGN_LINK_ACCESS_ENABLED=true for already approved scoped GM/PLAYER campaign links; never enable LEGACY_DEV_AUTH_ENABLED on production.
- Campaign creation remains independently governed by its existing entitlement/storage-policy decision; mail deferral does not grant it.

Source evidence: account-auth-routes capabilities exposes registration only when registrationEnabled and mailReady; register rejects disabled flag before account creation; verify/reset reject missing delivery with503. env.ts allows registration off with account auth on and campaign link access on. Thus no source bypass of verification is required. Target runtime and browser capabilities still require actual verification.

## Remaining gates

No external SMTP/inbox verification prerequisite for this owner-approved current release. Current migration/recovery, exact image/package, TLS/domain, protected runtime config, retained scoped access, persistence and rollback gates remain. Re-enable mail/signup later only with real configured provider and its separate acceptance; no artificial verifiedAt mutation.

## Checkpoint

Decision recorded from direct owner reply; no service/runtime secrets or provider config read, no app code changed, no server mutation. New document only. Next: apply these explicit flags to the newly assembled current target package, not overwrite immutable old R5 receipts.
