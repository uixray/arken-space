# Current state

This is the living "what actually ships today" doc. Its purpose is to replace
reading through the ~45 dated checkpoint files in `docs/` to understand where
the product stands. It should go stale slower than those files: it links to
checkpoints for detail instead of copying their content, and it defers to
[`tasks.md`](../tasks.md) (repo root) as the source of truth for foundation-epic
completion status.

Last derived: 2026-08-04, from `tasks.md`, the codebase at
`1d5f831` on `feature/canvas-drawing-tools` (including its uncommitted working
tree), and the six most recent checkpoint docs listed below. Treat `tasks.md`
as authoritative for status of UIX-196 through UIX-217; this doc adds the
features that shipped outside that tracked list (see "Shipped but not in
tasks.md" below) and layers in engineering detail from checkpoints.

## Shipped and working (per `tasks.md`)

- **Foundation (UIX-196–200)**: workspace/rules contract, campaign
  access + PostgreSQL, realtime 2D map/tokens/fog, character sheets/chat/dice,
  media library + synchronized music. `tasks.md` marks these `[x]`, with the
  caveat that Linear closure still needs explicit acceptance reconciliation.
- **UIX-212 — Authoritative canvas undo/redo**: `[x]` done.
- **UIX-213 — Canvas visibility layers and ordered fog operations**: `[x]`
  done. The fog model is now canonical `RECT | CIRCLE | POLYGON | BRUSH`
  geometry with an explicit bbox, not just rectangular reveal — see
  [uix-313-fog-geometry-backend-checkpoint-2026-08-02.md](./uix-313-fog-geometry-backend-checkpoint-2026-08-02.md).
- **Mandatory production gates**, per `tasks.md`: encrypted remote restic
  repository with retention/check, clean restore with exact checksums/counts,
  automated GM+6 adversarial/recovery scenario, production disk expansion and
  host reboot recovery are all `[x]`. Fresh backup before the next schema
  migration, isolated upgrade/reset/restore rehearsal, full automated gates at
  the final deployed revision, and the 30–45 minute human GM+6 rehearsal
  (Chrome/Firefox/Edge) are still open — see the checklist in `tasks.md` for
  exact wording.

## In progress

- **UIX-214 — Persistent drawings, shared ruler and map navigation controls**
  (`tasks.md`: in progress). Reverted from done back to in-progress after a
  review found a shared-ruler tool-switch cleanup regression: switching away
  from the RULER tool mid-measurement left stale ruler state instead of
  clearing it. That fix is present in the current working tree (uncommitted)
  in `apps/web/src/renderers/Orthographic2DRenderer.tsx` — a `useEffect` now
  clears `rulerStart`/`rulerEnd` and emits `ruler:clear` whenever
  `props.tool` changes away from `"RULER"`. Line-settings/stroke-width
  increment work is also still self-flagged partial per `tasks.md` (see
  commit `1d5f831`, "line settings window and width control (UIX-214
  partial)").
- **UIX-201 — Hardening, deployment and game-night verification**: `tasks.md`
  marks this in progress, to be closed only as foundation hardening (not full
  product acceptance).
- **UIX-206, 207, 208, 209, 210, 211, 215, 216, 217**: all still open/blocked
  per `tasks.md`'s dependency chain (access/reset → token/character split →
  rules/campaign state → token/asset workflows → session shell → full GM+6
  acceptance). None of this has started per the tracked task list; see
  [roadmap.md](./roadmap.md) for the staged plan (note: `roadmap.md` predates
  UIX-212/213 completion and the untracked feature work below, so treat its
  stage numbering as directional, not current status).

## Shipped but not in `tasks.md`

A substantial amount of functionality exists in the codebase and in recent
checkpoints that `tasks.md`/`roadmap.md` do not track at all (they only cover
the UIX-196–217 foundation epic). Based on the codebase and the six most
recent checkpoints, the following appear implemented to varying depth of
verification (mostly typecheck + focused unit/integration tests; broad
regression, Docker multiplayer and browser QA were repeatedly deferred per the
checkpoints themselves):

- **Player requests** (players → GM asks, e.g. custom rolls/advantage
  requests): durable entity with author/GM state machine, recipient-safe
  realtime delivery, a minimal workspace UI, delegated-controller character
  picking, and a linked reference-only chat card in the `TABLE` stream. Backend
  through UI is implemented; browser and real multiplayer QA remain deferred.
  Detail: [uix-312-player-requests-backend-checkpoint-2026-08-02.md](./uix-312-player-requests-backend-checkpoint-2026-08-02.md).
- **Fog geometry v2**: canonical shape geometry (rect/circle/polygon/brush)
  replacing the old rectangular-only reveal model, with legacy-payload
  compatibility. Contracts/DB/server implemented and unit/migration tested;
  renderer/tooling integration against the new canonical geometry and browser
  QA are the next step. Detail:
  [uix-313-fog-geometry-backend-checkpoint-2026-08-02.md](./uix-313-fog-geometry-backend-checkpoint-2026-08-02.md).
- **Operator feedback inbox**: a separate operator role (env-allowlisted
  membership UUIDs layered on the existing session), with a redacted feedback
  inbox UI, attachment viewing, Linear-key linking (validation only, does not
  create issues), and export redaction. Backend and UI implemented; browser QA
  with a real allowlisted operator session and production trust verification
  remain open. Detail:
  [uix-318-operator-feedback-backend-checkpoint-2026-08-02.md](./uix-318-operator-feedback-backend-checkpoint-2026-08-02.md).
- **Wallet audit aggregation**: rapid consecutive wallet-only mutations by the
  same actor/character now collapse into one public chat audit message (5s
  rolling window) while every underlying mutation still gets its own
  `game_events` row. Detail:
  [uix-221-wallet-aggregation-checkpoint-2026-08-01.md](./uix-221-wallet-aggregation-checkpoint-2026-08-01.md).
- **Canvas stabilization pool (UIX-226/UIX-227)**: custom-formula roll overlay
  fix, drawing draft termination on pointer-up, deterministic token-stack
  representative selection, Esc-to-PAN, token resize/portrait continuity state
  machines, and correlated resize action IDs. Multiple sub-pools landed across
  several commits; see
  [uix-226-uix-227-stabilization-checkpoint-2026-08-02.md](./uix-226-uix-227-stabilization-checkpoint-2026-08-02.md)
  for the decision-by-decision breakdown. Docker multiplayer and full
  real-browser GM/player smoke were not run for this pool.
- **World maps, stickers, story channel, token image generator, chat
  threads/direct messages**: all present as first-class domains in
  `packages/db/src/schema.ts` (e.g. `worldMaps`, `stickerPacks`, `storyPosts`,
  `chatThreads`) and have corresponding server modules
  (`world-maps.ts`, `sticker-access.ts`, `story.ts`) and web workspaces
  (`WorldMapsWorkspace.tsx`, `StickerPicker.tsx`, `StoryChannel.tsx`,
  `TokenImageGenerator.tsx`). These were not covered by the six checkpoints
  read for this doc and their current maturity/known-issue status is **not
  independently verified here** — check `git log` for the relevant `uix-2xx`
  checkpoint docs already in `docs/` (e.g. `uix-243-*`, `uix-246-*`,
  `uix-255-*`, `uix-266-*`) before relying on this summary for those features.

## Known issues at the current HEAD

- **Shared-ruler tool-switch cleanup regression** — fixed in the uncommitted
  working tree (see "In progress" above); not yet committed as of this
  writing.
- **`pnpm lint` / `pnpm format:check`** are currently failing in the checked
  reviewed working copy because of local git worktrees under `.worktrees/`
  confusing `typescript-eslint`'s `tsconfigRootDir` detection and Prettier's
  file walk. This looks like a local-checkout artifact rather than a
  repository defect — verify on a clean clone before treating it as a real
  regression. See [codebase-audit.md](./codebase-audit.md) for detail.
- **Full parallel Vitest suite** was last recorded as 383/396 passing
  (`release-regression-checkpoint-2026-08-01.md`), attributed to PGlite
  timeout/test-isolation debt rather than a specific feature regression. This
  was not re-run for this doc.
- Several checkpoints note deferred verification gates that are still open as
  of their respective dates: Docker multiplayer runs, real GM/player browser
  smoke, and production/Linear trust verification for the operator feedback
  flow. Treat any feature above whose checkpoint says "deferred by user
  request" as functionally implemented but not fully release-verified.

## Planned next (per `tasks.md` / `roadmap.md`)

In dependency order from `tasks.md`'s "Approved product delivery" section:

1. **UIX-206** — close foundation verification and planning baseline.
2. **UIX-207** — persistent player access and safe gameplay reset (blocked by
   UIX-206).
3. **UIX-208 / UIX-209** — token definitions + multi-controller permissions,
   and character sheet v2 + shared skill/ability catalog (both blocked by
   UIX-207).
4. **UIX-210 / UIX-211** — generic roll actions/auditable chat, and campaign
   clock/cooldowns/resources/wallet (both blocked by UIX-209).
5. **UIX-214** (in progress, see above) must finish before UIX-215.
6. **UIX-215 / UIX-216** — token palette/asset workflows (blocked by UIX-208 +
   UIX-213, which is now done) and session shell/presence/GM audio (blocked by
   UIX-207 + UIX-210).
7. **UIX-217** — full product GM+6 acceptance rehearsal, blocked by UIX-210,
   UIX-211, UIX-214, UIX-215, UIX-216.

Explicitly deferred (per `tasks.md`): SP upgrade requests and GM approval
workflow, collaborative soundpad, mobile canvas, offline mode, public
registration and commerce, multi-level/isometric/3D rendering.

Note: this dependency chain covers only the tracked foundation epic. The
untracked feature work in "Shipped but not in `tasks.md`" above (player
requests, fog geometry v2, operator feedback, wallet aggregation, world maps,
stickers, story channel, token generator) has its own in-flight state per
Linear/checkpoint docs that is not reflected in `tasks.md`'s checklist — check
Linear directly for those issues' current status rather than assuming this doc
or `tasks.md` is complete for them.

## Related documents

- [codebase-audit.md](./codebase-audit.md) — structural/technical audit of the
  current codebase (stack, tooling, hotspots, known debt).
- [architecture.md](./architecture.md) — how the system is built (invariants,
  data flow); not refreshed alongside this doc, so cross-check table/line
  counts against `codebase-audit.md` before relying on its specifics.
- [roadmap.md](./roadmap.md) — the originally approved staged plan for the
  foundation epic (predates UIX-212/213 completion and all untracked feature
  work above).
- [`tasks.md`](../tasks.md) (repo root) — source of truth for foundation-epic
  status.
