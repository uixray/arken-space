# UIX-228 checkpoint — 2026-07-18

- Decisions: map legacy `mind -> intelligence` and `spirit -> willpower`; canonical values win when both exist. Normalize legacy character collections at snapshot boundary. Keep audio playing on SELECT only when it was logically playing. Root Error Boundary is recoverable and emits a report code.
- Revision: base `3d15ba7`; working tree not committed.
- Changed files: `.workspace/session_state.md`; `apps/server/src/entry-data.ts`; `apps/server/src/entry-data.test.ts`; `apps/server/src/realtime.ts`; `apps/server/src/snapshot.ts`; `apps/web/src/AppErrorBoundary.tsx`; `apps/web/src/CatalogEntryForm.tsx`; `apps/web/src/main.tsx`; `apps/web/src/styles.css`; `tests/realtime.test.ts`.
- Verification: lint PASS; typecheck PASS; Vitest PASS (22 files, 142 tests); production build PASS; Playwright PASS (18, 1 credential-dependent skip); `git diff --check` PASS. Repository-wide `format:check` remains RED on 46 pre-existing unrelated files; all UIX-228 files were formatted explicitly.
- Browser coverage: rapid wallet mutations, resource conflict refresh, stale-revision delta replay and character drawer/tab behavior passed in Chromium. Production was not changed.
- Blockers: repo-wide formatting baseline prevents a fully green gate; credential-dependent live GM exchange remains skipped locally.
- Next action: decide whether to accept the scoped-format exception or repair the repository formatting baseline, then commit UIX-228 and run an authorized isolated live-session smoke before any production GO.
