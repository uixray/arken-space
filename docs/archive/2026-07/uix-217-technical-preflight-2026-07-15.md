# UIX-217 technical preflight — 2026-07-15

This is technical preflight evidence only. It is not a production readiness statement and does not represent the required human rehearsal.

## Revision identity

- Audited baseline: `4c8a2ebc806d9da89885fda06347dbcb1400909d`
- Validated candidate after preflight fixes: `450184286d30d91f4457e8b5c7e6d60b7293621e`
- Environment: local Windows workspace; no production credentials or production state used.

## Safe local gate results

| Gate                               | Result            | Evidence                                                                                                                                                                |
| ---------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                   | PASS              | All five workspace packages passed.                                                                                                                                     |
| `pnpm lint`                        | PASS              | ESLint completed with exit 0.                                                                                                                                           |
| `pnpm test`                        | PASS              | 12 files, 73 tests. Includes previous-schema → migration 0008 retention/default check.                                                                                  |
| `pnpm build`                       | PASS              | Contracts, DB, system, server and web production builds passed.                                                                                                         |
| `pnpm format:check`                | PASS              | All tracked text matched Prettier.                                                                                                                                      |
| `pnpm test:e2e`                    | PARTIAL PASS      | Two deterministic mocked Chromium UI tests passed; credential-dependent GM exchange was correctly skipped. Snapshot was reviewed and updated after token-label changes. |
| `pnpm exec playwright test --list` | PASS              | Three local browser tests discovered.                                                                                                                                   |
| `git diff --check`                 | PASS              | No whitespace errors before commit.                                                                                                                                     |
| `pnpm test:multiplayer`            | BLOCKED / NOT RUN | Docker Desktop Linux engine is unavailable locally. Runner requires isolated Compose and also performs a production-health read; no production access was used.         |
| `pnpm restore:rehearse`            | BLOCKED / NOT RUN | Requires Docker plus backup/restic/operator environment. No credentials supplied.                                                                                       |
| `pnpm gameplay:reset:safe`         | NOT AUTHORIZED    | Intentionally not run; reset remains a separate operator go/no-go action.                                                                                               |

## Coverage added in this preflight

- Previous schema (through migration 0007) upgrades to 0008 while retaining membership identity and assigning revision default `0`/NOT NULL.
- Existing GM+6 isolated Playwright scenario now also asserts controlled token palette and UI placement, absence of GM surfaces for players, local music preference persistence, GM presence display, exact dice-notification focus and pinned chat composer behavior.
- Local concept fixtures were brought to the current snapshot contract; the fog screenshot proves the owned token remains visible while the covered foreign token does not render.
- Deterministic GM+6 profile/browser fixture and 30–45 minute full-product runbook were added.

## Automated coverage residuals

1. The expanded GM+6 Compose scenario was discovered/typechecked but not executed because Docker is unavailable. It remains mandatory.
2. Local `test:e2e` is Chromium-only and mostly mocked. The isolated GM+6 harness uses real server/database/socket behavior, but its added UI checks still need execution.
3. Firefox and Edge are represented in the human fixture; automated local Firefox/Edge execution is not evidence yet. Edge remains a host-channel/human gate.
4. Restore, backup integrity, backend restart and exact restored-copy migration evidence must be freshly produced in the authorized rehearsal environment.
5. The restore tooling reports application `schemaVersion: 2`, while Drizzle migration history now ends at `0008`. This may be an intentional API compatibility version, but the operator must record both identities explicitly rather than treating them as the same counter.
6. The 30–45 minute GM+6 human session is not substitutable by automation and has not been performed.

## Production go/no-go checklist

All boxes require explicit evidence for the same release candidate; unchecked means NO-GO.

- [ ] Fresh remote database/media backup completed; dump checksums, counts and restic snapshot recorded without secrets.
- [ ] Backup integrity check passed.
- [ ] Exact snapshot restored into an isolated environment.
- [ ] Migrations applied successfully to the restored copy; retained data, migration `0008`, application schema version and health recorded.
- [ ] Restore rehearsal receipt identifies the exact candidate SHA.
- [ ] Rollback procedure and responsible operator confirmed.
- [ ] Exact reviewed SHA deployed; no dirty files or substituted image tags.
- [ ] `/healthz`, build revision and database/schema identity match the intended release.
- [ ] Full unit/integration/build/format/browser gates rerun against the deployed exact SHA.
- [ ] Isolated GM+6/recovery runner completed and its sanitized `test-results/multiplayer/runner.json` archived.
- [ ] Seven independent human profiles completed the full runbook across Chrome, Firefox and Edge.
- [ ] Reload, late join, disconnect, backend restart and adversarial isolation passed without security, persistence, consistency or game-blocking defect.
- [ ] Any affected automation and human scenarios were repeated after fixes.
- [ ] Operator recorded explicit GO or NO-GO.
- [ ] Gameplay reset, if still desired, received a separate decision after a fresh verified backup and exact-snapshot restore rehearsal.

## Artifacts

- Runbook: `docs/uix-217-rehearsal-runbook.md`
- Deterministic fixture: `tests/fixtures/uix-217-rehearsal.json`
- Expanded isolated browser scenario: `tests/multiplayer/game-session.spec.ts`
- Local browser smoke: `tests/e2e/concept.spec.ts`
- Migration rehearsal test: `tests/migration.test.ts`
