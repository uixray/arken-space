# New-server delivery package — target Sunday 2026-10-11

## Contract and current constraints

Owner deliverable: a coherent package of latest accepted software plus latest **recoverable** production data, prepared locally so only authorized transfer/server installation remains. Sunday is the requested target, not a guarantee that unknown-password data can be decrypted. No remote/deploy/upload or production operation is authorized by this planning task.

Current software candidate `4dca5a19d3b6b7ca17464825b893dfc276185462` is building in the assigned worker pool. Populate IDs/hashes only from its final accepted manifest; do not invent them or promote earlier `2c35435` images/evidence. Historical recovery receipts are useful procedure evidence, not proof this new package or production data is restored.

Production backup download is active in root process62006. Password is unknown; owner stopped password searching. Do not resume searches, guess passwords, read credential stores, contact provider or claim downloaded encrypted bytes are restored/latest data. Download completion and encrypted repository integrity are separate from decryptability, snapshot recency, DB/media pairing and recovery evidence.

## Two separate deliverables (never one public archive)

**A. Software-only transfer artifact**, positive allowlist:
- Exact frozen server/web image archives, image IDs, archive SHA256/size, source commit/tree, lock/context hashes and builder/base identity; actual build network mode, not a false offline claim.
- Cached required PostgreSQL/runtime image reference or archive as explicitly packaged; target host architecture/engine compatibility noted. No target `build:` or implicit latest-tag resolution.
- Reviewed compose/runtime/gateway configuration templates containing placeholders only; exact-image pinning, volumes, health/readiness, stop grace greater than8s, startup/migration sequencing, disk/backup paths and exposure boundaries.
- Runbook, preflight/verify commands, migration/restore/rollback instructions and safe evidence manifest. License/dependency attribution for included components. No source test fixtures, author media, DB dumps, `.env`, keyring, SMTP credentials, logs or private backup path listing.

**B. Private recovery/operations bundle**, outside Git and excluded from public context/archive allowlists:
- Downloaded encrypted backup repository, immutable source metadata and checksums; preserve original bytes. Separate restricted decryption credential handling—never place password/key beside a publicly shared archive or in manifest.
- Once decryptable: exact selected snapshot identity/time, production capture scope and software/schema version if known, paired DB+media/config evidence. Restored dump/media and required retained encryption keys/session/auth configuration remain sensitive. Account/outbox data may require the original keyring for recoverability; missing key must be reported, not replaced to fabricate success.
- Private provisioned runtime secrets delivered via an owner-approved channel; public pack only documents variable names and references. SMTP credentials and sender/domain activation are independent of backup password.

A checksum-only public receipt may reference a non-sensitive private bundle ID. Do not copy customer emails, account/token/password hashes, storage keys, raw transcripts or detailed production records into it. “Latest” must be qualified as latest discovered/decryptable snapshot with measured capture time; unknown/newer inaccessible snapshots remain explicit gaps.

## Work possible now: bounded Luna documentation/config packaging

> Own only a new software-package staging directory under the root-approved artifact output, its compose/config templates, README/runbook, allowlist manifest and compact checkpoint. No application source/dependency/framework changes. You are not alone; preserve active image/runtime/recovery workers and consume their completed receipts instead of rerunning them. Use existing `scripts/exact-candidate-context.mjs`, `scripts/local-candidate-recovery.mjs`, `scripts/restore-rehearsal-core.mjs` and `docker-compose.restore-candidate.yml` as reviewed building blocks, not the old default production-path runner. Do not execute `scripts/run-restore-rehearsal.mjs`, `infra/deploy/release.sh` or production backup scripts as shortcuts.
>
> Build a placeholder-only software packaging skeleton before private data is ready. After image freeze, copy only accepted software archives/config/docs into staging, verify immutable manifest and archive hashes, and generate an explicit positive member list. Mark every unknown domain/host/SMTP/backup field REQUIRED, not a guessed working value. Rendered private env belongs outside staging/Git; do not emit Docker inspect Env or expanded compose secrets. Validate structure locally without installing/pulling/running a server. Do not claim target-ready if operator choices or private recovery are unresolved. Return exact paths/hashes and the remaining-data/host checklist; no upload.

Concrete software packaging checks:
1. Both images resolve to the same accepted source SHA; no mutable-tag-only references or worktree overlay. Include new SMTP context/source in accepted candidate context. Verify archive digests against final image manifest.
2. Positive archive listing contains only approved software members; reject `.env`, private synthetic fixtures, DB/media, backup repository, credentials and unreviewed nested archives. Record list/hash, not a broad directory zip.
3. Templates use persistent named/explicit volumes, exact cached image identity, `pull_policy: never` for validated local replay, no automatic build. Production account mode enabled, legacy alias off; campaign-link policy retained as separately configured, without ownership conversion. Registration policy is open+email verification, but activation remains false until actual mail/key/provider readiness. Creation entitlement remains a separate owner decision, not default-three or unlimited storage.
4. Startup instructions load archives then verify IDs before any app startup; restore/migration steps occur before exposing HTTP. Exact command placeholders must distinguish private env file from public template. Fail if required values are missing; do not auto-run migration against an unspecified database.
5. Operator runbook has finite expected results and stop/rollback points. Dry structural validation is labeled structural; it is not actual deploy/recovery acceptance.

## Data gate once owner supplies decryption capability

1. Finish download; record transport outcome and immutable encrypted repository hashes/size. Do not modify original repository. Root selects read-only local recovery path and authorization.
2. With owner-provided password/key, list/decrypt locally into restricted fresh storage. Identify exact snapshots, capture timestamps/timezone, DB/media pairing and latest recoverable selection. If password unavailable or archive corrupt: private-data portion BLOCKED; software package may still be delivered explicitly incomplete.
3. Restore chosen DB+media into isolated fresh PostgreSQL/media resources with mail/runtime/network publication disabled. Record schema migration ledger before upgrade and full table inventory/count coverage, including users, account sessions/action tokens/invites/creation idempotency/outbox. Never infer old media pairing from a newly reconstructed synthetic file.
4. Snapshot the intact pre-upgrade tuple before candidate migration. Apply candidate SQL once against the isolated copy, preserve migration ledger continuity and referenced media digests/FKs. Original backup stays unchanged. Use actual production-derived data privately; public receipts contain counts, safe aggregate/digest comparisons, not rows.
5. Run only affected new-candidate checks: exact image startup/health, account or retained legacy-link access strategy appropriate to recovered schema, selected campaign/scene and representative protected media references, persistent restart and current migration idempotency. Do not invent account owners from old aliases/emails. If access credentials are unavailable, report that runtime assertion blocked rather than mutate owner accounts silently.
6. Rehearse backup/restore of the upgraded tuple in a second isolated destination; compare schema/counts/reference/media checks and actual read path. Backup existence alone is not recovery. Outbox pending messages remain unsent; preserve retained key versions and report undecryptable entries explicitly.
7. Rollback is old compatible software **plus pre-upgrade DB/media/config tuple**, never old binary against new schema. Preserve exact old artifact identity and approved safe startup strategy; historical seed/legacy auth constraints remain. If old executable unavailable, label restored-data rollback only, not executable rollback. Explicitly document lost post-upgrade writes on rollback.

## Target-host and activation prerequisites (must be resolved, not guessed)

- Host OS/CPU architecture, Docker/Compose versions, available disk for images + original backup + restored/migrated DB/media + rollback copy + working headroom; folder ownership and volume permissions.
- Selected domain, DNS/ports, TLS certificate provisioning/renewal and reverse-proxy/websocket routing. Public exposure requires explicit owner authorization. Local API cookie replay does not prove browser Secure-cookie behavior on the new domain.
- SMTP endpoint/implicit TLS support, sender identity/domain, provider credentials, sender authentication and authorized real acceptance/inbox test. Open signup approval does not supply these. Missing provider keeps registration delivery fail-closed, not invite-only.
- Public campaign-creation entitlement and storage/abuse budget if it is to be enabled. Otherwise create capability stays off with honest UI.
- Private DB/app/mail key provisioning, old key retention, backup encryption credentials, backup destination/schedule/retention/off-host recovery, monitoring and operational ownership. No secret embedded in public compose or CLI examples.

## Finite final manifest / handoff gate

One immutable release manifest links: software SHA/tree/image IDs/archive hashes; private bundle opaque ID and verified snapshot capture time; restore/migration/media-reference receipt IDs; rollback tuple identity; exact runbook/config-template versions; host prerequisites; unresolved decisions. Readiness states: SOFTWARE_READY, DATA_DOWNLOADED_ENCRYPTED, DATA_DECRYPTED, DATA_RESTORE_VERIFIED, PACKAGE_READY_FOR_AUTHORIZED_TRANSFER. No automatic promotion between them.

“Only upload/install remains” is valid only after exact software accepted, latest recoverable data selected/decrypted and restore/migration/reference gates passed, target-specific configuration decisions resolved, private secrets provisioning path confirmed and rollback instructions executable. Otherwise report precisely which part is ready by Sunday and which external input is missing; do not promise latest production data before decryption.

## Checkpoint

Planning only; changed this document. Current build/runtime workers retain their ownership. Next local pool is software-only config/runbook packaging with placeholders while root completes download; decryption/recovery waits for owner input. No password search, source change, runtime operation, upload or deployment performed.
