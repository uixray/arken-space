# UIX-674 — consolidated UI feedback checkpoint (2026-10-05)

- **Decision:** apply comments 1–43 as one connected local candidate; no per-edit CI, no production deployment. Keep Story a workspace, not a chat tab. Keep shared characteristic layout in `campaign.statLayout`.
- **Revision:** base `4f6aceb` on `codex/project-roadmap-2026-09-18`; changes still uncommitted at this checkpoint. Draft PR #86 predates this candidate.
- **Changed files:** web app header/navigation, character workspace and stat layout, quick rolls/chat/skill cards, scene manager/picker and map toolbar, setup catalog, world editor styles, related focused tests, and `apps/web/public/assets/brand/arkpath-logo.webp`.
- **Verification:** web typecheck, `git diff --check`, production-mode Docker web build, 72 focused Vitest tests (the six passing files from the aggregate run plus the corrected RollAvatar rerun), local GM/player browser smoke. Observed corrected stat single-row actions and narrow card stacking, scene checkboxes (16 px, left of labels), empty world-editor hint directly below list, quick-roll/story navigation, and no redundant active-scene publish action. QA uses only the local web container; existing server, DB, and media are unchanged.
- **Blockers:** none found in the focused checks. Full CI and production acceptance have not run; they must not be represented as passed.
- **Next action:** inspect final diff, run one focused lint pass, commit/push the consolidated candidate once, then request a single final CI/review gate. Do not deploy production without a separate explicit request and completed gate.

## Release-preparation follow-up

- **Decision:** hold the two subsequent QA corrections locally until the already-running CI for `1c121f0` completes; do not launch overlapping full runs. No production action.
- **Revision:** PR #86 has `1c121f0`; the unpublished follow-up changes `SetupPanel.tsx`, `styles.css`, and this checkpoint for comments #10/#25/#42.
- **Verification:** focused ESLint, web typecheck, Prettier, diff check, production-mode local web build, and browser geometry passed: wallet increment buttons remain 8.7 px inside all four row bounds; online-status icon/text gap is 6 px; volume slider has zero margin and exactly matches its parent width. Local QA health remains 200. The PR `multiplayer` job passed on `1c121f0`; other checks were still running at observation time.
- **Blockers:** PR remains draft and unreviewed; current release SHA is not on `origin/main`; fresh host backup/restore, human GM/player acceptance, and explicit production approval are outstanding.
- **Next action:** inspect the first CI result, resolve any failures in the same candidate, push the local follow-up once, then perform one final exact-revision review gate.
