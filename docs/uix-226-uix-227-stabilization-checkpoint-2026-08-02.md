# UIX-226 / UIX-227 stabilization checkpoint — 2026-08-02

## Decisions

- Use the clean `codex/uix226-uix227-followup` worktree based on integrated revision `3274566`; do not modify the dirty root checkout.
- Do not cherry-pick `5470897`: its UIX-257/UIX-258 behavior is already integrated as `9ac29dd` and has since evolved.
- Close the confirmed UIX-226 custom-formula overlay gap first. Keep UIX-227 as a separate implementation commit because its renderer defects and browser acceptance require a larger isolated scope.

## Revision

- Base: `327456608e004586e0546b9094fd3e2406e22537`
- Working tree: uncommitted UIX-226 implementation and this checkpoint.

## Changed files

- `apps/web/src/App.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`
- `docs/uix-226-uix-227-stabilization-checkpoint-2026-08-02.md`

## Verification

- Connected chat/roll/canvas smoke: 10 files, 43 tests passed.
- UIX-226 targeted Playwright: 2 passed, including custom GM-only advantage request and 390x844 reachability.
- Web tests: passed.
- Workspace typecheck: passed.
- Workspace lint: passed.
- Production build: passed; existing large-chunk warning remains.
- UIX-227 baseline: 6 files passed; `tests/pool-b-http.test.ts` had 2 assertion failures caused by mojibake expectations, matching known repository test debt rather than the UIX-226 diff.
- `git diff --check`: passed.

## Blockers

- UIX-226 still needs exact-scope review and commit approval gate; no commit or push yet.
- UIX-227 still has confirmed gaps: same-frame drawing termination, representative-only stack labels, Esc-to-PAN, and missing cold-load/portrait/undo browser coverage.
- Full Docker multiplayer and production smoke were not run. Production deployment is out of scope.

## Next action

Review and commit only the four files above for UIX-226, then start a separate UIX-227 renderer/browser pool.
