# Arken Space — полный кандидат редизайна (подготовка, не релиз)

Дата: 03.10.2026. Владелец выбрал полный редизайн и функции Antigravity, а не узкий hotfix. База: `codex/project-roadmap-2026-09-18`, HEAD `92338fb`. Рабочее дерево остаётся грязным; этот документ не является разрешением на merge, push или deploy.

## Связный состав кандидата

1. **Frontend shell/карта/персонажи:** tracked изменения `apps/web/src/**` плюс новые `AppHeader`, `AppModals`, `ScenePicker`, `TokenTray`, socket hook, renderer fog helper, `OutcomeFrame`, `CompactMenuSurface`, `landing-data`. Не выделять один `App.tsx` без этих прямых зависимостей.
2. **Дизайн-система:** tracked styles/Button/Storybook preview и новые primitives, CSS, stories, MDX. Проверить сборку Storybook отдельно от web build. Два PNG в `apps/web/public/assets/frames/` включать после подтверждения владельца о праве публикации (подтверждено 03.10.2026).
3. **Backend персонажей и безопасность:** `routes.ts`, ACL-тест, beta-auth тест; обычный `seed.ts` без demo side effects, отдельный seed-safety тест. В полном кандидате необходимо проверить новую матрицу прав и старые маршруты GM/PLAYER.
4. **Dev DB tooling:** `env.ts`, `index.ts`, `packages/db/**`, `docs/development-guide.md`; PGlite только явный development driver. В проде default PostgreSQL и fail-closed. `pnpm-lock.yaml` с точным importer PGlite.
5. **QA:** все новые и изменённые unit/integration/E2E тесты, включая ранее untracked `tests/e2e/selection-recovery.spec.ts`. Тесты не объявлять принятой функциональностью до полного gate.

## Отдельная проверка перед staging

- Сверить каждую tracked/untracked позицию `git status` с группами выше; не использовать `git add -A`.
- Не включать `cookies.txt` (точно ignored), локальные данные `.data/`, `test-results/`, uploads, секреты, логи, временные БД.
- Метадокументы `docs/plans/remaining-work-2026-09-18.json`, `uix-644-*.json`, `ai-execution-log.md`, UX backlog, benchmark и guidelines просмотреть отдельно: это контекст/планы, не доказательство QA; включать только актуальные и не содержащие приватные данные.
- `pnpm-lock.yaml`: Storybook addon-mcp удалён из-за несовместимого peer, Playwright 1.62.1 и Chromatic 5.3.0 закреплены; frozen lockfile check прошёл. Проверить на CI Node 22.

## Gate до публикации

1. Code review полного diff и импортной замкнутости; чистый локальный commit SHA без лишних файлов.
2. На этом SHA: tokens/build/typecheck/lint/format/Icon Policy/full Vitest threads, E2E Chromium/Firefox и multiplayer. Локальный Node 24 ранее падал native V8; требуется удалённый Node 22 CI или эквивалентный изолированный runner.
3. Browser QA: GM/PLAYER, desktop/mobile/split-screen, все темы и критические броски, popover/dialog layering, contrast, keyboard, reduced motion, no first-paint flash; реальная ручная приёмка владельца отдельно.
4. По `docs/production-release-checklist.md`: exact-main CI, backup и restore rehearsal, media/rollback, release-host preflight/postflight. Только после успешного gate — отдельный запрос владельца на production deployment.
