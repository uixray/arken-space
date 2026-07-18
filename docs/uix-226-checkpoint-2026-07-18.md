# UIX-226 checkpoint — 2026-07-18

## Decisions
- Ordinary text is always a chat message; only the explicit `/roll <formula>` prefix invokes dice parsing.
- Enter submits the unified composer; Shift+Enter inserts a newline.
- Advantage/disadvantage is sent as intent and expanded/rolled by the server as `2d20kh1` / `2d20kl1`.
- Advantage/disadvantage is shown in human-readable chat text and the exact kept-die notation remains in the breakdown.
- Quick dice and custom roll controls live in a persistent canvas overlay; duplicate quick buttons were removed from chat.
- Existing public/GM-only visibility and character attribution are preserved.

## Revision
- Pending commit at checkpoint creation.

## Changed files
- apps/server/src/dice.ts
- apps/server/src/routes.ts
- apps/web/src/App.tsx
- apps/web/src/Sidebar.tsx
- apps/web/src/styles.css
- apps/web/src/chat-composer.ts
- apps/web/src/chat-composer.test.ts
- packages/contracts/src/index.ts
- tests/dice.test.ts
- tests/pool-b-http.test.ts
- tests/e2e/concept.spec.ts

## Verification
- Format changed files: PASS
- Lint: PASS
- Typecheck: PASS
- Unit/integration: 151/151 PASS
- Production build: PASS (existing bundle-size warning)
- Playwright: 21 PASS, 1 credential-dependent test skipped
- git diff --check: PASS

## Blockers
- None for UIX-226.
- Existing non-blocking mocked-backend proxy noise and Konva six-layer warning remain outside this pool.

## Next action
- Continue the release batch with UIX-227/UIX-231 canvas and grid fixes. Do not deploy production before the combined Luna review and release gate.
