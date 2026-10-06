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

## CI repair pool — 2026-10-05

- **Decision:** repair the completed first CI run as one pool, preserving product behavior and accessibility contracts rather than relaxing assertions. Keep the wallet/presence/volume follow-up and these repairs unpublished until one consolidated push; no per-edit CI and no production action.
- **Revision:** `1c121f0` is the draft PR #86 head; local `ab72ea0` contains the three visual follow-ups. The CI repair pool is still uncommitted at this checkpoint.
- **Changed files:** `App.tsx`, `WorkspaceNav.tsx`, `ScenePicker.tsx`, `styles.css`, the light-theme source token and generated CSS, related DOM/Vitest/E2E tests, and overlay inventory/coverage records. CI failures represented stale navigation and menu expectations plus real focus-return, scene-picker keyboard, stat drag-target, and light-theme critical-text contrast issues.
- **Verification:** first-run multiplayer passed; first-run checks and all four E2E shards failed. Local targeted repairs passed the six failed Vitest files (42/42), architecture/navigation (9/9), stat-controls Chromium (4/4), scene-picker DOM (3/3), Firefox picker/focus/nav/dialog/skill targets (10/10), and Firefox light-theme critical contrast GM 1280 (1/1). Repository typecheck and lint completed successfully (lint has 24 warnings, zero errors). These are targeted local results, not a green full gate.
- **Blockers:** no user review is required to finish fixes. Exact candidate remains unpublished and unverified by final CI; draft PR, origin/main SHA, host rehearsal, and human acceptance remain release gates.
- **Next action:** run one consolidated focused local gate, commit and push one updated candidate, then inspect the single ensuing CI run before review handoff.

## Parallel visual-review pool — 2026-10-05

- **Decision:** take the second set of 33 browser comments as three connected character, chat, and map/topbar pools; keep the two E2E assertion repairs in the same candidate. Do not run CI per edit or touch production.
- **Revision:** base `695513e` on `codex/project-roadmap-2026-09-18`; this pool is local pending one consolidated commit and push to draft PR #86.
- **Changed files:** `CharacterWorkspace.tsx`, `StatLayoutCard.tsx`, `ChatPanels.tsx`, `ResourceCounters.tsx`, `QuickRollPanel.tsx`, `MusicBar.tsx`, `Orthographic2DRenderer.tsx`, `camera-fit.ts`, `SetupPanel.tsx`, `icons.ts`, related design-system/CSS and focused tests, plus `navigation-completion.spec.ts` and `toolbar-overflow-history.spec.ts`.
- **Verification:** integrated `format:check`, typecheck, production-mode web Docker build, 209/209 targeted Vitest tests, lint (zero errors, 24 warnings), and diff check passed. Targeted mocked Chromium/Firefox navigation E2E 2/2 and Firefox GM360 map-tool E2E passed. Refreshed only the localhost QA web container at `127.0.0.1:15180`; server, database, and media were preserved. After reload, browser QA confirmed compact dice details, system/critical card styling, quick-roll and resource layout, character archive action inside the card, and functional resource/initiative tabs at the 1069px viewport.
- **Blockers:** full CI on this new revision, exact-revision review, `origin/main` merge, host backup/restore and media rehearsal, human GM+6 acceptance, and explicit production approval remain open. The backend-dependent overflow-history E2E repair awaits CI.
- **Next action:** inspect staged diff, create one commit and push, then inspect the single resulting CI run. Keep PR draft and production untouched.

## Additional browser-review pool — 2026-10-05

- **Decision:** address nine follow-up comments in three parallel, bounded pools without per-edit CI. One-shot advantage/disadvantage applies to the bottom physical-dice tray; character/skill quick rolls remain their separate mode path. Keep local QA and production separate.
- **Revision:** base `21d4ba2`; nine-comment changes remain local pending consolidated commit. The previous revision's `checks` job failed only icon-source policy (three glyphs), now corrected locally. Its multiplayer job passed, but all four E2E shards failed with multiple stale UI expectations or behavior/geometry assertions; this is an open gate, not a green CI claim.
- **Changed files:** `CharacterWorkspace.tsx`, `SceneManagerDialog.tsx`, `ChatPanels.tsx`, `MusicBar.tsx`, `QuickRollPanel.tsx`, `RollModeControl.tsx`, `DiceTrayPanel.tsx`, `icons.ts`, `styles.css`, and focused DOM/unit tests. Character Create/Archive are at the rail bottom; scene edit opens concrete settings; chat math suppresses duplicate totals and places critical labels on the second line; playlist icon, bounded enriched quick-roll tips, and one-shot physical dice modes are implemented.
- **Verification:** integrated format check, typecheck, production-mode local web Docker build, 82/82 focused tests including `ui-icon-policy`, diff check, and browser QA on `127.0.0.1:15180` passed. Browser showed the close button within the header, bottom rail actions, direct `Настройка: Первая сцена` dialog, no Normal tray button, playlist icon, and the revised critical/result layout. Only the local QA web container was recreated; existing API, DB, and media containers were preserved.
- **Blockers:** old E2E run is terminal red in both browsers; root causes need a bounded repair pool before the next remote candidate. PR remains draft/unreviewed; origin/main, host rehearsal, human GM+6, and explicit production approval remain open.
- **Next action:** commit this verified local pool, classify and repair E2E failures without weakening valid contracts, then push once and run one exact-revision CI. No production deploy.

## E2E expectation and contrast repair pool — 2026-10-05

- **Decision:** classify the terminal `21d4ba2` E2E failures against the current UI before running another full CI. Preserve behavior and security assertions: update obsolete labels/structure only, reorder a stat hit-target measurement before opening an occluding menu, compare fog cells at equivalent world coordinates, and repair an actual light-theme contrast defect in product CSS.
- **Revision:** based on local `73fdd01`; E2E/CSS repair is uncommitted at this checkpoint.
- **Changed files:** `styles.css` and 11 E2E specs: canvas token regressions, character queue recovery/stat controls/compact sheet/field focus/value fit/workspace lifecycle, composer suggestions, concept, player-theme surfaces, and quick-roll privacy.
- **Verification:** agents passed E2E TypeScript, targeted Prettier, and diff check. Light-theme stats header now uses `#215b94` on `#f7f3ea` (computed contrast 6.34:1), rather than the failing 3.05:1 default blue. Full browser E2E on this exact revision is not yet run; shared manual QA database was not used for write-heavy tests.
- **Blockers:** exact-revision full CI remains required, and its result may expose additional issues. Draft PR review, origin/main merge, host backup/restore/media rehearsal, GM+6 human acceptance, and explicit production approval remain open.
- **Next action:** commit this bounded repair, push the two local commits together once, run a single exact-revision CI, inspect failures if any. No production deploy.
