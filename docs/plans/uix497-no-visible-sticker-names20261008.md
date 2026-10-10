# Sticker names presentation checkpoint — 2026-10-08

- Decision: no individual sticker names are presented in chat, the picker, or the pack upload editor. The existing required API `name` field is retained with an internal deterministic `Стикер N` fallback; no API/schema changes. Resumed draft rows use neutral `Изображение N` labels instead of persisted individual names. Picker search prompt describes only pack/description search. Pack names, accessibility alt text, local source-file labels, and attachment filenames remain intact.
- Revision: implementation based on `a1fef81`.
- Changed files: `apps/web/src/StickerPackManager.tsx`, `apps/web/src/StickerPackManager.test.tsx`, `apps/web/src/StickerPicker.tsx`, `apps/web/src/StickerPicker.test.ts`, `apps/web/src/sticker-picker-state.ts`, `apps/web/src/sidebar/ChatPanels.tsx`.
- Follow-up: resumed draft hydration no longer displays persisted sticker names; regression asserts a private name is absent and alt text/uploaded state remain intact.
- Verification: `git diff --check` produced no whitespace errors. `pnpm exec vitest` was blocked by pnpm attempting to provision its pinned runtime (sandbox `EPERM` on pnpm temp path). Direct local Vitest started but did not return test output within 25 seconds; interrupted. No claim of test pass.
- Blockers: focused test runner behavior requires retry in a functioning local environment; web typecheck not run.
- Next: rerun focused manager/picker/chat tests and web typecheck; review full diff before stage gate. No server, E2E, production, push, or Linear action performed.
