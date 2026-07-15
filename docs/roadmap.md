# arken-space delivery roadmap

Status: approved on 2026-07-14.

Arken Space remains a private desktop-first VTT for one GM and five to six players using a custom system. Work is ordered by data integrity, authorization and recovery risk rather than by visible feature count.

The source implementation plan is [implementation-plan-2026-07-14.md](./implementation-plan-2026-07-14.md). Linear is the source of truth for execution state.

## Baseline

The deployed concept slice already provides:

- GM/player browser sessions;
- PostgreSQL persistence and migrations;
- orthographic scenes, grid, tokens and rectangular reveal fog;
- character sheets, chat and server-authoritative dice;
- safe image/audio storage and synchronized music;
- ordered realtime events, action IDs, revisions, resync and role-filtered snapshots;
- backup/restore operations and isolated GM + 6 automation.

The shortened foundation rehearsal is accepted as a partial gate. It does not mean the product is ready for the complete recurring-session workflow.

## Product target

The first full product gate must support:

- reusable rotatable player access links;
- token definitions, scene placements and several controllers per token;
- fixed characteristics and a shared skill/ability catalog with per-character copies;
- Hit, Damage and custom roll actions;
- campaign day/battle lifecycle, cooldowns, mana/resources and wallet counters;
- player-own plus GM-global canvas undo/redo;
- MAP, PLAYER and GM token layers;
- ordered reveal/cover fog;
- persistent shared drawings, shared ruler and map controls;
- role-filtered token palette and complete portrait/token asset assignment;
- fixed chat composition, presence, rename and GM-authoritative sidebar music;
- final GM + 6 automated and human acceptance.

## Stage 0 — foundation closure

Linear: UIX-206

- Include fog renderer tests in the default suite.
- Add a current-HEAD browser regression for opaque player fog, owned-token behavior, pings and hidden interaction.
- Synchronize the product brief and planning docs.
- Close UIX-201 only as foundation hardening.

Exit: all standard local checks pass and the remaining product debt is explicit.

## Stage 1 — recurring access and reset safety

Linear: UIX-207

- Replace claim-once invitations with membership-bound reusable access grants.
- Return a raw secret only at creation/rotation.
- Add revoke/rotate and active-session invalidation.
- Rehearse the approved gameplay-data reset after a fresh verified backup.
- Preserve all media and backup repositories.

Exit: a returning player uses the same link without duplicate identity; revoked secrets cannot authenticate.

## Stage 2 — split core domain models

Linear: UIX-208 and UIX-209

Token path:

- reusable token definitions;
- per-scene placements;
- many-to-many controllers;
- MAP, PLAYER and GM placement layer data.

Character path:

- eight fixed characteristics;
- backstory, inventory, notes and optional resources;
- shared skill/ability catalog;
- assignment as an independent character-specific snapshot.

These two migrations may follow UIX-207 independently, but must not be combined into one unreviewed schema jump.

Exit: data ownership is explicit and role-filtered snapshots pass adversarial tests.

## Stage 3 — game rules and campaign state

Linear: UIX-210 and UIX-211

Roll path:

- Hit, Damage and custom actions;
- modifiers from characteristics, assigned entries, constants or constrained formulas;
- d20 defaults, initiative plus Agility and advantage/keep-high;
- auditable chat output with ability descriptions.

Campaign path:

- day advance and battle end;
- daily, battle and seven-day recharge;
- manual recharge by owner/GM;
- mana and other optional resources;
- gold, silver, copper and SP counters;
- public system chat deltas for counter edits.

Exit: rules are server-authoritative, deterministic and covered by unit/realtime tests.

## Stage 4 — reversible canvas authority

Linear: UIX-212

- Add immutable before/after action records.
- Implement conflict-safe player-own and GM-global undo/redo.
- Integrate token movement/deletion first, then fog and drawings.
- Preserve event ordering, idempotency and resync.

Exit: reconnect, concurrent edits, duplicate requests and backend restart do not corrupt history.

## Stage 5 — visibility and fog

Linear: UIX-213

- Implement MAP, PLAYER and GM render/filter rules.
- Add GM local toggle and context-menu layer movement.
- Replace reveal-only state with ordered REVEAL/COVER operations.
- Preserve the approved renderer stack and ping behavior.

Exit: GM-layer state never leaks and fog/hit-testing behavior passes browser adversarial coverage.

## Stage 6 — collaborative canvas tools

Linear: UIX-214

- Persistent drawings with author/GM mutation rights.
- Move, recolor, copy, delete and undo/redo.
- Shared ruler.
- Map scale/alignment, grid offset and explicit zoom controls.

Exit: multi-client canvas tools survive reload and enforce ownership.

## Stage 7 — token and asset workflows

Linear: UIX-215

- Full GM palette and player-controlled subset.
- Drag/click placement.
- Explicit remove-placement versus delete-definition actions.
- Token image and portrait assignment.
- Player visibility for own unassigned TOKEN/PORTRAIT uploads.
- Grouped hover/focus labels and authorized scene/character rename.

Exit: GM and player complete their token workflows without direct database preparation.

## Stage 8 — session shell

Linear: UIX-216

- Fixed chat composer with scrolling history.
- Roll notifications linked to chat.
- GM online presence view.
- Player self-rename and GM membership rename.
- Music in a sidebar tab.
- GM-only audio upload/control and player-local consent/volume.

Exit: session shell recovers after reconnect and backend restart.

## Stage 9 — full product acceptance

Linear: UIX-217

1. Create and verify a fresh backup.
2. Rehearse migration/reset/restore in isolation.
3. Deploy the exact reviewed revision.
4. Run unit, integration, browser, GM + 6 and recovery automation.
5. Run a 30–45 minute rehearsal with one GM and six clean profiles across Chrome, Firefox and Edge.
6. Fix every security, persistence or game-blocking defect.
7. Repeat affected gates and record explicit go/no-go.

Exit: the group can prepare and run the approved recurring-session workflow without external workarounds.

## Dependency path

UIX-206 → UIX-207

UIX-207 → UIX-208 → UIX-212 → UIX-213 → UIX-214

UIX-207 → UIX-209 → UIX-210 and UIX-211

UIX-208 + UIX-213 → UIX-215

UIX-207 + UIX-210 → UIX-216

UIX-210 + UIX-211 + UIX-214 + UIX-215 + UIX-216 → UIX-217

## Release invariants

- No production schema change without a verified backup and isolated rehearsal.
- No issue closes without its acceptance criteria and recorded test evidence.
- No player receives GM-layer entities.
- No client-only durable history.
- No raw reusable access secret is persisted.
- No full product-ready claim before UIX-217.

## Explicitly deferred

- SP skill-upgrade requests and GM review.
- Collaborative soundpad.
- Voice/video, public registration, commerce and offline mode.
- Mobile canvas.
- Multi-level, isometric and 3D renderers.
