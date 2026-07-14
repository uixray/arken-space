# Terra execution log

Plan: implementation-plan-2026-07-14.md  
Architecture contract: architecture-decisions-2026-07-14.md  
Status: Planning complete; implementation not started

This is the durable handoff and verification log for implementation. Terra updates it before source edits and at every Linear stage gate. Do not rewrite historical entries; append corrections as new entries.

## Queue

| Order | Linear  | Work package                                    | Dependency            | Status  |
| ----- | ------- | ----------------------------------------------- | --------------------- | ------- |
| 0     | UIX-206 | Foundation verification and planning baseline   | —                     | Ready   |
| 1     | UIX-207 | Persistent access and safe gameplay reset       | UIX-206               | Blocked |
| 2A    | UIX-208 | Token definitions, placements and controllers   | UIX-207               | Blocked |
| 2B    | UIX-209 | Character sheet v2 and catalog                  | UIX-207               | Blocked |
| 3A    | UIX-210 | Generic roll actions and chat results           | UIX-209               | Blocked |
| 3B    | UIX-211 | Campaign clock, cooldowns, resources and wallet | UIX-209               | Blocked |
| 4     | UIX-212 | Authoritative canvas undo/redo                  | UIX-208               | Blocked |
| 5     | UIX-213 | Canvas layers and ordered fog                   | UIX-212               | Blocked |
| 6     | UIX-214 | Drawings, ruler and map controls                | UIX-212, UIX-213      | Blocked |
| 7     | UIX-215 | Token palette and asset workflows               | UIX-208, UIX-213      | Blocked |
| 8     | UIX-216 | Session shell, presence and GM audio            | UIX-207, UIX-210      | Blocked |
| 9     | UIX-217 | Full product GM + 6 acceptance                  | terminal dependencies | Blocked |

## Baseline record

Date: 2026-07-14  
Recorded by: Sol  
Repository base: 4153e7a02f8220bff86702c0a811f8efe5d469d0  
Production revision: 4153e7a02f8220bff86702c0a811f8efe5d469d0  
Production schema version: 2  
Planning state: approved  
Implementation changes: none

Known baseline evidence:

- Standard Vitest: 25 passing tests.
- Fog renderer helper tests: 2 passing when run explicitly.
- Typecheck, lint, build and format: passing.
- Prior isolated GM + 6 security/recovery scenario: passing from revision 1d907b2.
- Foundation human rehearsal: shortened; full product acceptance deferred.

Known debt:

- Fog renderer tests are outside the default Vitest include.
- The current product schema and UI do not cover the approved backlog.
- A new full human rehearsal is required only after UIX-206 through UIX-216.

## Session entry template

Copy this section for every execution session.

### YYYY-MM-DD — UIX-___ — title

Actor: Terra  
Stage: Briefing / Research / Implementation / Verification / Review / Deploy  
Status: In progress / Blocked / Ready for review / Complete  
Branch:  
Base revision:  
End revision:  
Environment: Local / Isolated Compose / Production

#### Scope

- Included:
- Explicitly excluded:

#### Preconditions

- Dependencies complete:
- Working tree reviewed:
- Backup required:
- Backup verified:

#### Changes

- File/path — reason

#### Decisions

- Decision — rationale — affected contract

#### Verification

| Command/scenario           | Result  | Evidence |
| -------------------------- | ------- | -------- |
| corepack pnpm typecheck    | Not run |          |
| corepack pnpm lint         | Not run |          |
| corepack pnpm test         | Not run |          |
| corepack pnpm build        | Not run |          |
| corepack pnpm format:check | Not run |          |
| Issue-specific scenario    | Not run |          |

#### Migration and recovery

- Migration generated/reviewed:
- Upgrade from previous schema:
- Empty database:
- Restore/rollback:
- Snapshot/schema version:

#### Security and authorization

- GM:
- Owner player:
- Other player:
- Direct API/Socket attempt:
- Snapshot filtering:

#### Blockers or debt

- None.

#### Stage-gate result

- Linear comment:
- Next issue/stage:
- Review requested from:

## Stage-gate comment template

### Stage

[Current stage and result]

### Artifacts

- Plan:
- Execution log:
- Code/revision:
- Test report:

### Decisions

- [Decision and rationale]

### Verification

- [Command/scenario — result]

### Blockers

- None / [blocker]

### Next

- [Next issue or review action]

## Production mutation checklist

Production data reset or migration must stop unless every item is true:

- Exact reviewed revision identified.
- Fresh remote backup completed.
- restic check passed.
- PostgreSQL dump and media inventory recorded.
- Clean isolated restore passed.
- Upgrade/reset rehearsal passed against the restored copy.
- Reset command scope lists only gameplay tables/rows.
- Media storage and backup repository are excluded.
- Rollback owner and decision window are named.
- Post-deploy health, schema and snapshot versions are checked.
- GM and one player access path are smoke tested before broader use.

## Completion record

Do not fill this section until UIX-217 passes.

- Final revision:
- Production revision:
- Final schema version:
- Automated GM + 6:
- Human GM + 6:
- Restore evidence:
- Open non-blocking debt:
- Go/no-go decision:

## Slice UIX-206 ? Foundation verification and planning baseline

### Status

locally_verified

### Plan reference

- Plan file: docs/implementation-plan-2026-07-14.md
- Acceptance criteria: default Vitest includes fog renderer coverage; a current-HEAD browser regression proves opaque player fog, owned-token behavior, pings, and hidden interaction; planning/product documents use the approved recurring-access model.

### Changes

- Files changed: vitest.config.ts; tests/e2e/concept.spec.ts; tests/e2e/concept.spec.ts-snapshots/player-fog-opaque-chromium-win32.png; tests/multiplayer/game-session.spec.ts; docs/manual-rehearsal-2026-07-14.md; .workspace/tech_debt.md; docs/terra-execution-log.md.
- Behavior implemented: the default suite includes fog renderer coverage; the isolated real-browser GM + 6 harness emits a live player ping over covered fog, records the changed peer canvas before the 3.5-second expiry, proves a covered foreign-token drag leaves authoritative position and revision unchanged, and proves each player can move an owned token through the authoritative socket command.
- Decisions made: pings are permitted as an ephemeral overlay above covered fog and disclose no hidden content; the shortened foundation rehearsal is accepted while the full human product rehearsal remains tracked as technical debt for UIX-217.

### Verification

- Command: GET https://arken.uixray.tech/healthz
- Result: passed - production is healthy at 4153e7a02f8220bff86702c0a811f8efe5d469d0, schema 2.
- Command: corepack pnpm test
- Result: passed - 9 files and 27 tests.
- Command: corepack pnpm typecheck; corepack pnpm lint; corepack pnpm build
- Result: passed.
- Command: corepack pnpm format:check
- Result: passed after Prettier formatted the three changed files.
- Command: corepack pnpm exec playwright test tests/e2e/concept.spec.ts; corepack pnpm test:e2e --list
- Result: passed - 2 focused browser tests; 3 tests listed.
- Command: corepack pnpm test:multiplayer
- Result: passed at bda44b03f58c3915e808e2f9ca67167c503c96db - isolated GM + 6 real-browser scenario, backend restart/recovery, cleanup/resource-leak check, and before/after production health check.
- Evidence/artifact paths: tests/e2e/concept.spec.ts-snapshots/player-fog-opaque-chromium-win32.png; test-results/multiplayer/live-ping-over-covered-fog.png; test-results/multiplayer/runner.json

### Problems and difficulties

- Symptom: the first isolated run could not start while Docker Desktop was unavailable; a later run exposed an unavailable optional image dependency used only for bitmap comparison.
- Cause: the isolated Docker harness requires the local Docker daemon, and sharp is not part of its test image.
- Resolution or current blocker: Docker Desktop was started; the assertion now compares the Playwright canvas buffers directly. The final isolated run passed with no UIX-206 blocker.

### Deviations from plan

- None.

### Production

- Commit: bda44b03f58c3915e808e2f9ca67167c503c96db
- Uploaded exact archive: no
- Production revision: 4153e7a02f8220bff86702c0a811f8efe5d469d0
- Health: ok
- Database: ok
- Disk: not checked; no deployment is in scope
- Cleanup: n/a

### Review questions for Sol

- None for this issue. Pool review is deferred until UIX-207 completes.

### Suggested next action

## Slice UIX-207 ? Persistent player access and safe gameplay reset

### Status

in_progress

### Plan reference

- Plan file: docs/implementation-plan-2026-07-14.md, Stage 1.
- Acceptance criteria: one-time player secret display, hashed at rest, reusable membership-bound links, revoke/rotate invalidation, no duplicate memberships, and isolated verified backup/reset/restore rehearsal without media or backup deletion.

### Changes

- Files changed: access routes, player_access_grants migration, operator reset scripts, backup count manifest, operations runbook and safety tests.
- Behavior implemented: hashed membership-bound links support reuse, revoke and rotation with session/socket invalidation; reset is operator-only and refuses missing exact-snapshot rehearsal evidence.
- Decisions made: retain legacy invite rows only as a temporary migration compatibility boundary; the new access grant owns a stable player membership and never exposes its stored credential.

### Verification

- Command: corepack pnpm typecheck; lint; test; build; format:check.
- Result: passed - 30 tests, all workspace typechecks, lint, build and format checks.

### Problems and difficulties

- Production reset/deploy remains excluded; isolated reset transaction wiring and final exact-commit evidence are still required before closure.
