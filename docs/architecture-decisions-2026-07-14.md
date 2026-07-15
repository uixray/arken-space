# Arken Space architecture decisions

Date: 2026-07-14  
Status: Accepted  
Context: approved post-foundation product backlog

## Decision: foundation acceptance is intentionally partial

### Decision

Treat the shortened production rehearsal as sufficient to close the current foundation only. Full product acceptance remains blocked until the approved backlog is implemented and a new GM + 6 rehearsal passes.

### Rationale

- The deployed build, persistence, recovery and automated multiplayer foundation work.
- The current product does not yet cover the complete recurring-session workflow.
- Calling the product ready now would hide known functional debt.

### Alternatives

- Require the old rehearsal immediately — rejected because it would validate an obsolete scope.
- Mark the entire product accepted — rejected because the approved backlog is still absent.

### Impact

- UIX-206 closes the foundation evidence.
- UIX-217 is the only full product readiness gate.
- The compromise remains recorded in ../.workspace/tech_debt.md.

## Decision: reusable player access uses rotatable secrets

### Decision

Create one persistent access grant per player membership. Return its raw secret only when created or rotated, store only a hash, and support revocation and rotation.

### Rationale

- Recurring sessions should not require new invitation links.
- A stored raw link would make later disclosure and database compromise more dangerous.
- Stable membership identity is required for ownership, drawings, history and audit.

### Alternatives

- Continue using claim-once invitations — rejected as operationally inconvenient.
- Redisplay stored secrets — rejected because it requires recoverable secret storage.

### Impact

- Rotation and revocation invalidate existing sessions.
- Access links authenticate an existing membership instead of creating another one.
- Current gameplay data may be reset after a verified backup; media and backup repositories are excluded.

## Decision: separate token identity, placement and control

### Decision

Represent a reusable token definition separately from each scene placement, and represent player control with a many-to-many relation.

### Rationale

- One token may be placed on multiple scenes over time.
- One token may be controlled by several players.
- Removing a scene placement is not the same operation as deleting a reusable token.

### Alternatives

- Keep one token row with ownerMembershipId — rejected because it cannot express shared control.
- Duplicate a complete token for every scene — rejected because identity and asset edits would drift.

### Impact

- Definitions own defaults; placements own scene state and revisions.
- GM sees all definitions; players see and place only definitions they control.
- Character ownership may seed a default controller but must not overwrite explicit assignments.

## Decision: canvas visibility has three token layers and ordered fog

### Decision

Use MAP, PLAYER and GM placement layers. Persist fog as ordered REVEAL and COVER operations. Fog is a canvas visibility mechanism rather than a confidentiality boundary.

### Rationale

- The GM needs private preparation tokens without leaking them to players.
- Covered areas must be reproducible after reconnect.
- Ordered operations make re-covering deterministic.

### Impact

- Players receive/render MAP and PLAYER placements but never GM placements.
- The GM can locally toggle translucent GM tokens and move placements between layers.
- The renderer order is map image, MAP tokens, drawings, fog, PLAYER tokens, GM tokens, ruler and pings.
- Player-owned tokens remain usable above fog; pings are overlay-only and reveal no hidden interaction.

## Decision: undo and redo are authoritative commands

### Decision

Implement undo/redo with an immutable reversible-action journal containing before/after state. Players operate on their own latest valid actions; the GM additionally has global history.

### Rationale

- Client-only history fails after reconnect and cannot be audited.
- Deleting old events would break the existing ordered event stream.
- Revision checks are needed to prevent an old undo from overwriting a newer edit.

### Impact

- Undo/redo creates new ordered events and applies state changes atomically.
- Conflicting history returns CONFLICT and triggers resync.
- Token movement/deletion, fog and every drawing mutation use the same journal.
- A new action invalidates the relevant redo branch.

## Decision: catalog assignment creates a character-owned snapshot

### Decision

Maintain a campaign catalog of skill and ability templates. Assignment copies the template and its roll actions into an independently editable character entry while retaining source-template provenance.

### Rationale

- The GM needs reusable content.
- Individual characters need exceptions without changing every assigned copy.
- Roll and recharge settings belong to the assigned character after customization.

### Impact

- Template edits do not silently mutate existing characters.
- Character entries may reference fixed characteristics or other assigned entries.
- Cyclic references are invalid.

## Decision: rolls use explicit safe actions

### Decision

Model Hit, Damage and custom buttons as ordered roll actions. Resolve modifiers from a fixed characteristic, assigned character entry, numeric constant or constrained formula before invoking server-authoritative dice.

### Rationale

- Hit and damage commonly use different modifiers.
- Magic is a skill for some characters, not a universal fixed characteristic.
- Arbitrary expression evaluation would be unsafe and hard to migrate.

### Impact

- Default checks use d20.
- Initiative is d20 plus Agility.
- Physical damage may use Strength and magical damage may use Magic.
- Advantage/keep-high is supported by the dice grammar, not code evaluation.
- Chat records formula, individual dice, resolved modifiers, total and optional ability description.

## Decision: campaign time drives recharge

### Decision

Use an explicit campaign day and battle lifecycle. Daily recharge happens on day advance, battle recharge on battle end, and weekly recharge after seven elapsed campaign days.

### Rationale

- Wall-clock time does not represent fictional time.
- The GM needs deterministic control.
- Manual recharge is still required for corrections and special cases.

### Impact

- Owner and GM may manually recharge a character entry.
- Ability instances store remaining/max uses and optional progress text.
- Optional resources such as mana use generic character resource rows.

## Decision: wallet edits are auditable and non-normalizing

### Decision

Store non-negative integer counters for gold, silver, copper and SP. Direct edits do not automatically convert denominations. Every change creates a public system chat message in the same transaction.

### Rationale

- Players need simple direct counters.
- Silent normalization would make deliberate denominations hard to preserve.
- The group asked to see monetary changes in chat.

### Impact

- Domain rates remain 1 gold = 10 silver and 1 silver = 10 copper.
- Owner and GM may edit the wallet.
- The future SP upgrade-request workflow is deferred.

## Decision: synchronized music remains GM-authoritative

### Decision

Only the GM uploads audio and controls synchronized playback. Players control local consent and volume.

### Rationale

- This matches the approved authority model.
- Local playback preferences must not change shared state.

### Impact

- Music moves into a sidebar tab.
- A collaborative soundpad is not part of the approved implementation plan.

## Follow-up

- Execute UIX-206 through UIX-217 in dependency order.
- Update docs/terra-execution-log.md at each implementation and verification stage gate.
- Update Linear only at meaningful stage transitions, blockers, review and completion.

## Sources

- docs/implementation-plan-2026-07-14.md
- docs/playtest-feedback-2026-07-13.md
- docs/manual-rehearsal-2026-07-14.md
- tasks.md
- UIX-201 stage-gate discussion
