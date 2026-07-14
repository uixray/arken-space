# Arken Space implementation plan

Date: 2026-07-14  
Status: Approved  
Planning owner: Sol  
Execution target: Terra  
Linear project: arken-space  
Architecture contract: architecture-decisions-2026-07-14.md

## Outcome

Turn the deployed foundation into a complete recurring-session product for one GM and five to six players, then pass a full GM + 6 product rehearsal.

This plan is ordered by data integrity and authorization risk. It does not optimize for visible feature count.

## Current verified baseline

- Production health, database connectivity and schema reporting are healthy.
- Production and local revision match at 4153e7a02f8220bff86702c0a811f8efe5d469d0.
- Standard typecheck, lint, build, format and Vitest gates pass.
- The fog renderer tests pass when invoked directly but are not part of the default Vitest include.
- The prior isolated GM + 6 automated security/recovery story passed.
- The human foundation rehearsal was shortened. It is not full product acceptance.
- The current schema combines token identity/placement/ownership, uses claim-once invitations and stores character skills/spells as JSON.

## Invariants

1. PostgreSQL and the server are authoritative for durable state.
2. Every durable mutation has an actionId, actor, authorization decision and ordered game event.
3. Revision conflicts reject and resync; they never silently overwrite newer state.
4. Snapshot filtering is role-based. GM-layer entities never reach players.
5. Fog is canvas visibility, not a promise that all covered MAP/PLAYER payload is secret.
6. Raw access secrets are never persisted or returned after creation/rotation.
7. Schema and snapshot versions increase for breaking changes.
8. Production data reset requires a fresh verified backup and an isolated rehearsal.
9. One issue is implemented and verified as a coherent vertical slice before its dependent issue starts.
10. Full product readiness belongs only to UIX-217.

## Target data model

Names are the preferred migration names. An implementation may adjust a name only when contracts, migration tests and this document are updated together.

### Identity and access

- player_access_grants
  - membershipId
  - tokenHash
  - createdAt
  - rotatedAt
  - revokedAt
  - lastUsedAt
- sessions remain short-lived HttpOnly credentials derived from a valid grant.
- Rotation/revocation invalidates sessions for the membership.

### Tokens

- token_definitions
  - campaignId, name, characterId, assetId
  - default width/height/rotation
  - revision
- token_controllers
  - tokenDefinitionId, membershipId
  - unique composite key
- token_placements
  - tokenDefinitionId, sceneId
  - layer: MAP, PLAYER or GM
  - x, y, z, width, height, rotation, visible, locked
  - revision and tombstone/deleted state needed by undo

Removing a placement does not delete the definition. Definition deletion is explicit, confirmed and cascades only after authorization and reversible-state capture.

### Characters and catalog

- characters gain backstory and keep revisioned identity/notes.
- character_inventory_items stores ordered text items.
- character_resources stores optional named current/max resources such as mana.
- character_wallets stores gold, silver, copper and SP.
- catalog_entries stores campaign-level SKILL or ABILITY templates.
- catalog_roll_actions stores ordered template actions.
- character_entries stores a snapshot assigned from a catalog entry plus sourceCatalogEntryId.
- character_roll_actions stores the assigned/customized action snapshot.

Fixed characteristic keys:

- strength
- agility
- endurance
- vitality
- knowledge
- intelligence
- willpower
- charisma

Roll action modifier sources:

- FIXED_STAT
- CHARACTER_ENTRY
- CONSTANT
- FORMULA

Custom formulas use a constrained parser. They never use eval or Function. Reference resolution rejects missing targets and cycles.

### Campaign lifecycle

- campaign_clock stores currentDay, battleActive and battleSequence.
- Character ability entries store remainingUses, maxUses, rechargePeriod and lastRechargeDay/battle metadata.
- DAY resets on day advance.
- BATTLE resets on battle end.
- WEEK resets after seven elapsed campaign days.

### Canvas

- fog_operations stores scene, sequence/order, operation REVEAL/COVER and rectangle geometry.
- drawings stores author membership, points/geometry, color, transform, revision and reversible deletion state.
- reversible_actions stores campaign, actor, scope, action type, target/revision, beforeState, afterState, status and ordering metadata.
- game_events remains the immutable client event/audit stream.

## History semantics

1. A reversible mutation writes entity state, game event and reversible action in one transaction.
2. Player undo selects the latest APPLIED action authored by that membership and still compatible with current target revisions.
3. GM global undo selects the latest compatible APPLIED action in campaign order.
4. Undo applies beforeState, marks the source action UNDONE and emits a normal ordered event.
5. Redo applies afterState only when current revisions still match the undo result.
6. A later conflicting mutation returns CONFLICT and requires a full resync.
7. A new mutation invalidates the actor redo branch; global history remains auditable.
8. Undo/redo requests themselves are idempotent through actionId.

## Canvas contract

Persistent render order:

1. Map image.
2. MAP token placements.
3. Drawings.
4. Fog composition.
5. PLAYER token placements.
6. GM token placements.
7. Shared ruler and pings.

Role behavior:

- Player: MAP and PLAYER layers only.
- GM: all layers; GM placements are translucent and locally toggleable.
- Drawing visibility: whole group.
- Drawing mutation: author or GM only.
- Ruler: ephemeral but shared with the group.
- Ping: ephemeral overlay, including over fog, with no reveal or hidden-object interaction.

## Delivery sequence

### Stage 0 — close the foundation

Linear: UIX-206  
Depends on: none; related to UIX-201

Outcome:

- Default tests include fog renderer coverage.
- Current-HEAD browser coverage proves the approved fog interaction behavior.
- Planning and product brief stop describing claim-once player access as the future model.

Primary files:

- vitest.config.ts
- apps/web/src/renderers/fog.test.ts
- tests/e2e
- docs/brief.md
- docs/roadmap.md
- tasks.md

Verification:

- corepack pnpm test
- corepack pnpm typecheck
- corepack pnpm lint
- corepack pnpm build
- corepack pnpm format:check
- focused Playwright fog scenario

Exit:

- UIX-206 evidence is posted.
- UIX-201 may close only as foundation hardening, not product acceptance.

### Stage 1 — persistent access and safe reset

Linear: UIX-207  
Blocked by: UIX-206

Outcome:

- Stable player membership links work across sessions.
- The GM can create, revoke and rotate them without recoverable secret storage.
- Gameplay data can be reset safely after backup verification.

Primary files:

- packages/db/src/schema.ts
- packages/db/drizzle
- packages/contracts/src/index.ts
- apps/server/src/auth.ts
- apps/server/src/routes.ts
- apps/server/src/snapshot.ts
- apps/web/src/AuthGate.tsx
- apps/web/src/Sidebar.tsx
- tests/invite-ownership.test.ts
- tests/migration.test.ts
- scripts

Migration rule:

- Rehearse against an isolated copy first.
- Keep existing invite rows only as temporary compatibility during deployment or clear them with gameplay data after the verified backup.
- Never include media storage or restic repositories in reset scope.

Verification:

- raw secret shown once
- link reuse
- revoked/rotated link rejection
- active session invalidation
- duplicate-membership prevention
- backup/reset/restore rehearsal

### Stage 2A — token model and permissions

Linear: UIX-208  
Blocked by: UIX-207

Outcome:

- Definition, placement and controller state are independent.
- One token may be controlled by several players.
- GM-only remains the safe default.

Primary files:

- packages/db/src/schema.ts
- packages/contracts/src/index.ts
- apps/server/src/routes.ts
- apps/server/src/realtime.ts
- apps/server/src/snapshot.ts
- apps/server/src/seed.ts
- apps/web/src/renderers/SceneRenderer.ts
- tests/visibility.test.ts
- tests/realtime.test.ts
- tests/e2e/game-night.spec.ts

Verification:

- zero, one and several controllers
- controller removal during an active session
- direct API/Socket mutation attempts
- placement removal versus definition deletion
- reconnect and snapshot filtering

### Stage 2B — character model and catalog

Linear: UIX-209  
Blocked by: UIX-207

Outcome:

- Character sheet v2 represents the approved fixed characteristics and flexible content.
- Catalog assignment creates an isolated character snapshot.

Primary files:

- packages/system/src/index.ts
- packages/db/src/schema.ts
- packages/contracts/src/index.ts
- apps/server/src/routes.ts
- apps/server/src/snapshot.ts
- apps/web/src/Sidebar.tsx
- apps/web/src/styles.css
- tests/system.test.ts
- tests/visibility.test.ts
- tests/migration.test.ts

Verification:

- template edit does not mutate assigned entries
- GM and owner permissions
- collapsed backstory
- inventory/notes persistence
- optional mana/resource
- reload/reconnect

Stages 2A and 2B may be implemented in either order after UIX-207, but not in the same unreviewed migration.

### Stage 3A — generic roll actions

Linear: UIX-210  
Blocked by: UIX-209

Outcome:

- Characteristics, skills and abilities share one safe roll-action model.
- Hit and Damage are separate actions.
- Roll evidence is readable in chat.

Primary files:

- apps/server/src/dice.ts
- apps/server/src/routes.ts
- packages/contracts/src/index.ts
- packages/system/src/index.ts
- apps/web/src/Sidebar.tsx
- tests/dice.test.ts
- tests/system.test.ts

Verification:

- d20 characteristic and initiative
- hit/damage presets
- Magic as an assigned-entry reference
- custom action/formula
- advantage/keep-high
- missing and cyclic reference rejection
- chat description and detailed result

### Stage 3B — clock, cooldowns, resources and wallet

Linear: UIX-211  
Blocked by: UIX-209

Outcome:

- Fictional time drives deterministic recharge.
- Ability uses, optional resources and currency persist and synchronize.

Primary files:

- packages/db/src/schema.ts
- packages/contracts/src/index.ts
- apps/server/src/routes.ts
- apps/server/src/realtime.ts
- apps/web/src/Sidebar.tsx
- tests/system.test.ts
- tests/realtime.test.ts

Verification:

- daily, battle and seven-day transitions
- manual recharge by owner and GM
- non-negative counters and concurrent edits
- public system chat delta in same transaction
- no automatic denomination normalization

Stages 3A and 3B may proceed independently after UIX-209.

### Stage 4 — reversible canvas command journal

Linear: UIX-212  
Blocked by: UIX-208

Outcome:

- Server-authoritative undo/redo survives reconnect and restart.
- Player and GM scopes behave predictably under conflict.

Primary files:

- packages/db/src/schema.ts
- packages/contracts/src/index.ts
- apps/server/src/realtime.ts
- apps/server/src/routes.ts
- apps/server/src/snapshot.ts
- tests/realtime.test.ts
- tests/multiplayer/game-session.spec.ts

Implementation slices:

1. Journal schema/service and history-query contract.
2. Token move and placement deletion.
3. Fog operation integration.
4. Drawing create/edit/delete/copy integration after the drawing model lands.
5. Browser controls and conflict/resync states.

Verification:

- own-history versus global history
- duplicate undo/redo actionId
- redo invalidation
- later edit conflict
- backend restart and late join

### Stage 5 — visibility layers and ordered fog

Linear: UIX-213  
Blocked by: UIX-212

Outcome:

- The approved render stack and three token layers are complete.
- Reveal/cover fog is deterministic and persistent.

Primary files:

- packages/db/src/schema.ts
- packages/contracts/src/index.ts
- apps/server/src/realtime.ts
- apps/server/src/snapshot.ts
- apps/web/src/renderers/fog.ts
- apps/web/src/renderers/Orthographic2DRenderer.tsx
- apps/web/src/Sidebar.tsx
- apps/web/src/styles.css
- apps/web/src/renderers/fog.test.ts
- tests/visibility.test.ts
- tests/e2e/game-night.spec.ts

Verification:

- role-specific snapshot
- GM local layer toggle
- context-menu layer move
- ordered reveal/cover after reconnect
- covered hit testing
- owned token and ping behavior

### Stage 6 — drawings, ruler and map controls

Linear: UIX-214  
Blocked by: UIX-212 and UIX-213

Outcome:

- Shared drawing and ruler workflows work without violating authorship.
- Navigation and alignment controls are explicit and consistent.

Primary files:

- packages/db/src/schema.ts
- packages/contracts/src/index.ts
- apps/server/src/realtime.ts
- apps/web/src/renderers/Orthographic2DRenderer.tsx
- apps/web/src/Sidebar.tsx
- apps/web/src/styles.css
- tests/realtime.test.ts
- tests/e2e/game-night.spec.ts

Verification:

- author/GM edit matrix
- copy/delete/undo/redo
- renderer ordering
- shared ruler synchronization
- map alignment and bounded zoom

### Stage 7 — token and asset workflows

Linear: UIX-215  
Blocked by: UIX-208 and UIX-213

Outcome:

- GM and players can find, place and manage exactly the tokens they are allowed to use.
- Token images, portraits, labels and rename flows are complete.

Primary files:

- apps/server/src/routes.ts
- apps/server/src/storage.ts
- apps/server/src/snapshot.ts
- packages/contracts/src/index.ts
- apps/web/src/Sidebar.tsx
- apps/web/src/renderers/Orthographic2DRenderer.tsx
- apps/web/src/styles.css
- tests/storage.test.ts
- tests/visibility.test.ts
- tests/e2e/game-night.spec.ts

Verification:

- GM/player palette filtering
- own unassigned TOKEN/PORTRAIT asset visibility
- AUDIO denial for player
- drag/click placement
- remove versus delete confirmation
- label group behavior
- rename permissions

### Stage 8 — session shell, presence and audio

Linear: UIX-216  
Blocked by: UIX-207 and UIX-210

Outcome:

- Chat, presence, names and synchronized music form a stable session shell.

Primary files:

- apps/server/src/realtime.ts
- apps/server/src/routes.ts
- apps/server/src/storage.ts
- apps/web/src/Sidebar.tsx
- apps/web/src/MusicBar.tsx
- apps/web/src/realtime.ts
- apps/web/src/styles.css
- tests/realtime.test.ts
- tests/storage.test.ts
- tests/e2e/game-night.spec.ts

Verification:

- fixed composer and scroll history
- presence join/leave/reconnect
- player/GM rename matrix
- GM audio upload/control
- player local consent/volume
- music recovery after restart

### Stage 9 — full product acceptance

Linear: UIX-217  
Blocked by: UIX-210, UIX-211, UIX-214, UIX-215 and UIX-216

Outcome:

- The approved backlog is validated in production with one GM and six players.

Required gate:

1. Fresh remote backup and restic check.
2. Restore/migration rehearsal against an isolated environment.
3. Controlled gameplay reset only if still desired.
4. Deploy exact reviewed revision.
5. Run unit, integration, browser, GM + 6 and recovery automation.
6. Run a 30–45 minute human rehearsal in Chrome, Firefox and Edge.
7. Fix every security, persistence or game-blocking defect.
8. Repeat affected automation and human scenarios.
9. Record explicit go/no-go.

## Dependency graph

UIX-201 → UIX-206 → UIX-207

UIX-207 → UIX-208 → UIX-212 → UIX-213 → UIX-214

UIX-207 → UIX-209 → UIX-210

UIX-209 → UIX-211

UIX-208 + UIX-213 → UIX-215

UIX-207 + UIX-210 → UIX-216

UIX-210 + UIX-211 + UIX-214 + UIX-215 + UIX-216 → UIX-217

## Verification policy for every issue

Minimum:

- relevant unit/integration tests
- corepack pnpm typecheck
- corepack pnpm lint
- corepack pnpm test
- corepack pnpm build
- corepack pnpm format:check

When schema changes:

- generate and inspect a Drizzle migration
- run the migration test from an empty database
- rehearse upgrade from the previous schema
- verify snapshot/schema versions
- prove rollback or restore path

When authorization changes:

- separate GM and player sessions
- direct API and Socket.IO attempts
- role-filtered snapshot assertions
- reconnect/resync

When canvas/realtime changes:

- unit renderer/state tests
- Playwright with clean browser contexts
- duplicate action, conflict and restart coverage

## Terra execution protocol

1. Read this plan, the accepted decision log and the selected Linear issue.
2. Move only that issue to In Progress and comment with current stage and base revision.
3. Add the session to terra-execution-log.md before editing source.
4. Implement the smallest complete slice; do not combine a dependent issue.
5. Run the issue verification gate and record exact commands/results.
6. Request review when acceptance criteria are met.
7. Update Linear at the stage gate with artifact paths, decisions, blockers and next issue.
8. Do not close an issue without verified acceptance criteria.
9. Stop before production reset/deploy unless the backup and rehearsal preconditions are recorded.

## Explicitly deferred

- SP skill-upgrade requests and GM approval workflow
- collaborative soundpad
- voice/video
- mobile canvas
- public registration
- offline mode
- multi-level maps
- isometric renderer
- 3D renderer
- world/content marketplace

## Plan completion criteria

- UIX-206 through UIX-216 meet their acceptance criteria.
- Production migration/reset evidence exists.
- UIX-217 passes with no unresolved security, persistence or game-blocking defect.
- Roadmap, task list, operations docs and execution log match the deployed revision.
