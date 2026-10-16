# UIX-257 / UIX-258 checkpoint — 2026-07-22

## Decisions

- Chat displays a local-calendar date divider before the first visible message of each day; no persisted separator or migration.
- Standalone numeric dice expressions such as `d20` and `2d6+3` are roll intents. Natural-language text remains chat; `/roll` remains the explicit path for complex/stat formulas.
- `UI-2025B9F3` was a random client correlation code and cannot be retrospectively mapped to an exception.
- Future ErrorBoundary events report only correlation code plus an allowlisted native error class; the server adds the deployed build revision. Raw messages, stacks and game data are excluded.
- Malformed/legacy dice JSON is normalized to `null` before snapshot serialization and cannot crash chat formatting.
- Production CSP remains strict. The blocked `Function('')` is a caught schema-library feature probe; jquery/translateSelected messages are extension-originated; Konva layer count is a nonfatal performance warning.

## Revision

- Base: `8b2ce55` on `codex/uix254-shared-pc`.
- Review fixes are complete in the worktree; scoped commit pending.

## Changed files

### UIX-257

- `apps/server/src/routes.ts`
- `apps/server/src/snapshot.ts`
- `apps/server/src/telemetry.ts`
- `apps/server/src/dice-result.ts`
- `apps/server/src/dice-result.test.ts`
- `apps/web/src/AppErrorBoundary.tsx`
- `apps/web/src/app-error-report.ts`
- `apps/web/src/AppErrorBoundary.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/dice-result.ts`
- `apps/web/src/dice-result.test.ts`
- `tests/server-telemetry.test.ts`
- `tests/visibility.test.ts`

### UIX-258

- `apps/web/src/Sidebar.tsx`
- `apps/web/src/chat-composer.ts`
- `apps/web/src/chat-composer.test.ts`
- `apps/web/src/chat-date.ts`
- `apps/web/src/chat-date.test.ts`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`

## Verification

- PASS: `pnpm test` ? 34 files, 183 tests.
- PASS: targeted review suite ? 7 files, 25 tests.
- PASS: `pnpm typecheck`.
- PASS: `pnpm lint`.
- PASS: `pnpm build`.
- PASS: `git diff --check`.
- PASS: focused post-merge Playwright integration ? 3/3 (composer, malformed dice/date boundaries, character-card rolls).
- Full concept Playwright run: 16/17 scenarios passed, including the new malformed-dice/date-boundary flow and bare-roll flow. The unrelated pre-existing resource-conflict test failed twice because its mocked request was not emitted.

## Linear/GitHub state

- UIX-257 and UIX-258 implemented and ready for review; production release not performed.
- Public chat issue: https://github.com/uixray/arken-space/issues/19
- Fatal-error diagnostics remain private in Linear UIX-257.

## Blockers

- Production confirmation requires a separately approved release.
- Exact root cause of the historical UI-2025B9F3 cannot be recovered; future incidents will be correlatable.
- Existing resource-conflict E2E failure should be triaged separately.

## Next action

1. Commit and publish the scoped files without mixing unrelated `ROADMAP.md` / interaction-assessment changes.
2. Close UIX-257/UIX-258 after the integration gate.
3. Move UIX-256 into implementation. No production release without a separate request.
