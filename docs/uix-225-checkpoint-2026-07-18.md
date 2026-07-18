# UIX-225 checkpoint — 2026-07-18

## Decisions
- The right sidebar remains dedicated to chat.
- Characters, tokens, scenes, preparation, and files open from a compact header workspace menu.
- Workspace windows are non-blocking and keep the canvas available; nested entity forms remain modal.
- Player character access remains a right-side workspace/drawer with chat visible.
- The workspace menu closes after selection and focus returns to its trigger after closing a window.

## Revision
- Pending commit at checkpoint creation.

## Changed files
- apps/web/src/App.tsx
- apps/web/src/FeedbackReporter.tsx
- apps/web/src/Sidebar.tsx
- apps/web/src/styles.css
- apps/web/src/ui/ArkenDialog.tsx
- apps/web/src/ui/SceneManagerDialog.tsx
- tests/e2e/concept.spec.ts

## Verification
- Prettier (changed files): PASS
- Lint: PASS
- Typecheck: PASS
- Unit/integration: 147/147 PASS
- Production build: PASS (existing bundle-size warning)
- Playwright: 20 PASS, 1 credential-dependent test skipped
- git diff --check: PASS

## Blockers
- None for UIX-225.
- Existing non-blocking warnings: mocked E2E backend proxy noise and Konva six-layer performance warning.

## Next action
- Start UIX-226: chat and dice interaction pool. Do not deploy production until the combined release gate.
