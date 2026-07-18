# UIX-232 checkpoint — 2026-07-18

- Decisions: accept temporary public account impersonation for closed beta; keep GM authentication entirely separate; resolve fixed nickname aliases against active player-access grants by independently checking display name and label; retain secret `/join/:token` compatibility.
- Revision: base `3d15ba7`; working tree also contains the uncommitted UIX-228 pool.
- Changed files for this pool: `packages/contracts/src/beta-players.ts`; `packages/contracts/src/index.ts`; `apps/server/src/routes.ts`; `apps/web/src/AuthGate.tsx`; `apps/web/src/styles.css`; `tests/beta-players.test.ts`; `tests/e2e/playtest-feedback.spec.ts`; `.workspace/tech_debt.md`.
- Verification: lint PASS; typecheck PASS; Vitest suite PASS (22 files / 142 tests) plus focused alias tests PASS (3 tests, including label fallback); production build PASS; complete Playwright initially found a test-fixture defect, then focused landing/auth suite PASS (7/7); `git diff --check` PASS. Repository-wide format baseline remains pre-existing red as recorded in UIX-228.
- Security: anyone with site access can impersonate a listed player. GM token is not queried, embedded, returned, or logged by the alias flow.
- Blockers: before deployment, verify each production active player-access grant has display name or label equal to the configured Russian name or nickname; otherwise that alias correctly returns `PLAYER_NOT_FOUND`.
- Next action: inspect/create the six production player memberships/grants in an authorized pre-deploy step, then deploy only after explicit GO and smoke every nickname URL.
