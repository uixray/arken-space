# Terra batch handoff

Date: 2026-07-14
Status: Accepted
Owner: Terra
Reviewer: Sol at pool gates only

## Decision

Execute the approved Linear queue in bounded pools. Terra self-verifies and closes individual issues when every acceptance criterion passes, then continues to the next issue in the same pool without waiting for Sol.

Sol reviews one integrated result at the end of each pool. Do not request review for intermediate commits, test adjustments, formatting, documentation synchronization or ordinary implementation choices that remain inside the accepted architecture.

## Why

- Avoid reloading the complete project corpus for every issue.
- Preserve enough architectural checkpoints to stop model or authorization errors before dependent work builds on them.
- Keep Linear evidence and test discipline without turning every micro-step into a review round.

## Pool queue

| Pool | Issues                      | Outcome                                                              | Sol review gate   |
| ---- | --------------------------- | -------------------------------------------------------------------- | ----------------- |
| A    | UIX-206 → UIX-207           | Verified foundation, reusable player access and safe reset rehearsal | After UIX-207     |
| B    | UIX-208 → UIX-209           | Token/controller model and character/catalog model                   | After both issues |
| C    | UIX-210 → UIX-211           | Roll actions, campaign clock, cooldowns, resources and wallet        | After both issues |
| D    | UIX-212 → UIX-213 → UIX-214 | Reversible canvas authority, layers/fog, drawings/ruler/map controls | After UIX-214     |
| E    | UIX-215 → UIX-216           | Token/asset workflows and complete session shell                     | After UIX-216     |
| F    | UIX-217                     | Full automated and human product acceptance                          | Final go/no-go    |

Do not start the next pool until Sol accepts the current pool. Inside a pool, do not wait for Sol when the current issue passes its own acceptance criteria.

## Active pool A

### UIX-206 — finish, self-verify and close

Required remaining work:

1. Extend the isolated real-browser multiplayer coverage.
2. Emit a live player ping over covered fog.
3. Prove a peer receives it and the overlay renders before its 3.5 second expiry.
4. Attempt interaction at a covered foreign-token position and prove authoritative position/revision do not change.
5. Move an owned token as the positive interaction control.
6. Update docs/manual-rehearsal-2026-07-14.md to the accepted shortened-foundation state:
   - fog fix is deployed at revision 4153e7a02f8220bff86702c0a811f8efe5d469d0;
   - ping above fog is allowed and reveals no content;
   - full product acceptance is deferred to UIX-217.
7. Add the currently untracked .workspace/tech_debt.md so the tasks.md evidence link works on a clean clone.
8. Run the standard gate and the changed multiplayer scenario.

When these checks pass, Terra may mark UIX-206 Done and immediately move UIX-207 to In Progress.

### UIX-207 — implement and self-verify

Implement the issue exactly as described in Linear and the Stage 1 section of the implementation plan:

- reusable membership-bound player access;
- raw secret shown only on create/rotate;
- hashed storage;
- revoke/rotate and active-session invalidation;
- link reuse without duplicate memberships;
- isolated gameplay-data reset and restore rehearsal.

Pool A explicitly excludes:

- actual production deployment;
- actual production gameplay reset;
- deletion of media or backup repositories;
- token/controller or character/catalog schema work from Pool B.

Stop at a pool review with tested local/isolated code, migration evidence and an explicit production go/no-go checklist.

## Context budget

At the start of work or after context compaction, read only:

1. This handoff file.
2. The current Linear issue description and its latest unresolved review comment.
3. The matching UIX section in docs/terra-execution-log.md.
4. The current pool diff and directly affected source files.

Do not reread README, roadmap, full implementation plan, full architecture decision log, all prior reports or unrelated issues by default.

Open a larger source only when the current issue needs it:

- Implementation detail: locate the exact stage heading in docs/implementation-plan-2026-07-14.md and read only that section.
- Architecture ambiguity: locate the named decision in docs/architecture-decisions-2026-07-14.md and read only that decision.
- Operations: read only the relevant backup/deploy subsection.
- Provenance: use Git diff/log for the affected path instead of replaying old chats.

Prefer rg/targeted line ranges over full-file reads. Do not paste full test logs into the execution log or Linear; record command, pass/fail counts, revision and artifact path.

## Per-issue self-gate

Terra may close an issue without Sol review only when:

- every acceptance criterion is explicitly checked;
- relevant focused tests pass;
- typecheck, lint, unit, build and format gates pass;
- migration changes pass empty-database and previous-schema upgrade tests;
- authorization changes include GM, owner-player, other-player and direct API/Socket checks;
- the execution log records the end revision and concise evidence;
- Linear receives one completion stage-gate comment.

A commit or formatting pass alone is not a completion gate.

## Mandatory stop conditions

Stop the pool and request Sol/user direction only when:

- implementation would change an accepted architecture invariant;
- a security/authorization boundary is ambiguous;
- a destructive or irreversible migration lacks a verified restore;
- actual production deployment/reset is the next action;
- a required gate remains red after two focused correction attempts;
- completing the issue requires work assigned to a later pool;
- unrelated user changes would need to be overwritten.

Ordinary code organization, test mechanics, copy edits and small implementation details inside the accepted issue do not require review.

## Pool review package

At the end of a pool, provide one compact package:

- pool name and completed Linear issues;
- base and end revisions;
- commits by issue;
- schema/snapshot version changes;
- migrations and restore evidence;
- verification matrix with pass counts;
- authorization/adversarial evidence;
- production state and any pending mutation;
- unresolved risks or debt;
- recommendation to accept the pool or return it for corrections.

Sol reviews the pool diff and this package, not the complete repository history.

## Linear cadence

- Issue start: move to In Progress.
- Issue complete: add one evidence comment and move to Done.
- Next issue in the same pool: start immediately when dependencies are complete.
- Pool complete: add an integrated pool comment to UIX-201 and request Sol review.
- Blocker/stop condition: update only the affected issue and stop.

## Review cadence decision

### Decision

Review at pool boundaries instead of after every issue or micro-change.

### Rationale

- Lower repeated context and token cost.
- Preserve checkpoints before dependent architecture layers.
- Keep Terra autonomous inside approved scope.

### Alternatives

- Review every issue — rejected as excessive overhead.
- Review only after UIX-216 — rejected because domain or canvas model errors could compound across many dependent issues.

### Impact

- Six integrated reviews replace twelve issue-by-issue reviews.
- Terra owns self-verification inside each pool.
- Production mutation and architecture deviations still require explicit review.

### Follow-up

- Start Pool A from current main revision f2059eedcb54b31e293fb39857cb68e3a6377d68.
- Request the next Sol review only after UIX-206 and UIX-207 are complete.

### Sources

- docs/implementation-plan-2026-07-14.md
- docs/architecture-decisions-2026-07-14.md
- docs/terra-execution-log.md
- UIX-206 review gate
