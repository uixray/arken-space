# Decision: gameplay reset is operator-only

Date: 2026-07-14
Status: Accepted
Context: Arken Space, UIX-207

## Decision

Gameplay reset remains an operator-only CLI workflow. Do not expose or implement /api/gameplay/reset, and do not accept backupId or verifiedAt from a browser/GM request as proof of backup safety.

The operator workflow must create one exact backup snapshot, restore and verify that exact snapshot in the isolated rehearsal environment, and perform the reset only after the rehearsal succeeds in the same orchestrated invocation.

The application server does not maintain a trusted backup-artifact registry in the current product scope.

## Trust boundary

- Browser, GM session and application API are untrusted for backup attestation.
- The operator host, root-owned restic credentials and operator CLI invocation are trusted.
- A client-supplied identifier, timestamp, boolean or report path is never sufficient authorization for destructive reset.
- The restore report is operational evidence inside the trusted operator workflow, not an API credential.

## Required implementation

### Remove the unsafe API surface

- Remove resetGameplaySchema from shared browser/API contracts.
- Do not add a GM reset route or UI button.
- If a partial /api/gameplay/reset route exists, remove or permanently disable it.

### Add one safe operator command

Implement one operator entry point, for example gameplay:reset:safe, that runs these steps in order:

1. Verify the exact deployed/checked-out build revision and production health.
2. Run the existing backup flow and capture the newly created restic snapshot ID.
3. Run restore:rehearse against that exact snapshot ID, never against an independently resolved latest snapshot.
4. Read test-results/restore/runner.json and require:
   - runSucceeded is true;
   - no report error;
   - the selected snapshot matches the snapshot created in step 2;
   - dump/media checksum checks passed;
   - database count comparison passed;
   - restored application health matches the expected build/schema;
   - Compose, volume and restored-data cleanup passed;
   - no container/volume leftovers;
   - production health after rehearsal is healthy.
5. Require a typed operator confirmation containing the campaign ID and exact snapshot ID.
6. Stop application writes or place the server in an equivalent maintenance state.
7. Run the gameplay reset in one PostgreSQL transaction.
8. Restart the server and verify health, schema, empty gameplay state and preserved media.
9. Write a non-authorizing audit receipt with snapshot ID, report hash, build revision, before/after counts and completion time.

If any step fails, the command exits before the destructive transaction.

Do not split backup, rehearsal and reset into independently reusable browser-facing approvals. The exact snapshot identity must flow through the trusted operator process.

## Reset data boundary

Preserve:

- campaign identity;
- GM membership required for continued administration;
- asset rows and media files;
- remote/local backup repositories and rehearsal reports.

Before deleting player memberships, reassign preserved assets uploaded by those memberships to the retained GM membership or use another explicitly tested ownership-preservation mechanism.

Clear the approved gameplay state:

- player sessions and access grants;
- legacy invitations;
- player memberships after asset reassignment;
- characters;
- scenes and dependent token/fog state;
- chat and synchronized audio state;
- gameplay event/history rows that belong to the cleared state.

The exact deletion order and before/after counts must be covered by an isolated database test. Media files must never be deleted by the reset command.

## Pool A boundary

UIX-207 implements and tests the operator CLI, migration, access flow and isolated reset/recovery behavior.

Pool A does not execute an actual production reset or deployment. Production mutation remains a mandatory stop and requires a separate go/no-go review with a fresh backup.

## Rationale

- Reset is rare, destructive and operational rather than an ordinary GM gameplay action.
- The current backup system runs outside the application trust boundary.
- Browser-provided backupId/verifiedAt can be forged.
- A server registry would require artifact signing, authenticated ingestion, service identity, expiry, one-time consumption, snapshot/build binding, replay protection and TOCTOU handling.
- Adding that trust system now creates more attack surface and operational burden than the reset feature justifies.
- An operator-only workflow reuses the already tested restic and isolated restore controls.

## Alternatives

### Server registry of verified backup/rehearsal artifacts

Deferred. Consider it only if remote GM self-service reset becomes an explicit product requirement.

Before adoption it must define:

- who signs and publishes an artifact;
- how the application authenticates the backup service;
- exact snapshot/build/schema binding;
- expiry and one-time consumption;
- replay and race protection;
- registry backup/restore and incident behavior.

### Browser-provided backup ID and verification timestamp

Rejected. These values are claims from an untrusted client, not evidence.

### Manual reset after an unrelated old rehearsal

Rejected. Backup, exact-snapshot rehearsal and reset must be one orchestrated operator flow.

## Impact

- UIX-207 remains unblocked and does not need a new server trust subsystem.
- The current resetGameplaySchema work-in-progress must be removed from shared contracts.
- No gameplay reset endpoint is part of the product API.
- Production reset remains explicitly outside the current Pool A execution.

## Follow-up

- Terra implements the operator-only path and isolated tests in UIX-207.
- Terra records the command contract and runbook in docs/operations.md.
- Pool A review verifies access security, exact-snapshot rehearsal binding, preserved media and transactional reset behavior.

## Sources

- infra/backup/backup.sh
- scripts/run-restore-rehearsal.mjs
- docs/operations.md
- docs/terra-batch-handoff-2026-07-14.md
- UIX-207
