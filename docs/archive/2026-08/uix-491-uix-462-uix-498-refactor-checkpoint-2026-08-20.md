# Checkpoint — UIX-491 / UIX-462 / UIX-498 stabilization and docs refresh

**Дата:** 20.08.2026

**Revision:** `main`, base `42c7ccc61863f6728977d2381b9f8997f059e95c`

**Состояние Git:** большой незакоммиченный пул после передачи из Claude; commit,
push и deployment не выполнялись.

## Решения

- Realtime token move сохраняет placement/revision именно принятого события, но
  перечитывает актуальные definition-owned поля: character, asset, name,
  controllers и definition revision.
- После commit заново проверяются текущие права инициатора. ACK не возвращает
  TokenDto после отзыва контроля/visibility.
- Audience нельзя расширять из-за конкурентного изменения. Для campaign-room
  обе проекции — exact-event и latest — должны оставаться публичными.
- UIX-449 применяется и к wire projection: `token:moving` и `token:moved`
  используют каноническое `fogHiddenTokenIds`. Полностью закрытый чужой токен
  получают только GM и его актуальные контроллеры.
- Shortcut resolver, labels, tooltip, `aria-keyshortcuts`, landing guide и
  внутриигровая шпаргалка выводятся из одного typed manifest с role filtering.
- Activity продвигает read cursors только для включённых TABLE/STORY/ROLLS
  категорий. Скрытый фильтром поток сохраняет unread.
- Escape обрабатывается слоями: object list закрывается с возвратом focus и без
  потери selection; следующий Escape очищает map state.
- E2E навигация использует semantic workspace helper вместо удалённого
  `.workspace-menu`; multiplayer actions имеют конечный timeout 30 секунд.
- Docker Playwright image синхронизирован с package version `1.62.1`; private и
  local каталоги не попадают в build context.
- Operational docs отделяют code gate, host automation и ручные release checks;
  `release.sh` не описывается как замена test/lint/build/browser gate.

## Изменённые файлы

### Product/realtime

- `apps/server/src/realtime.ts`
- `tests/realtime.test.ts`
- `apps/web/src/canvas-bulk-move.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/Sidebar.test.ts`
- `apps/web/src/sidebar-feed.ts`
- `apps/web/src/sidebar/ChatPanels.tsx`
- `apps/web/src/ShortcutsDialog.tsx`
- `apps/web/src/landing-guide-content.ts`
- `apps/web/src/landing-guide-content.test.ts`
- `apps/web/src/roll-modifier-keys.ts`
- `apps/web/src/roll-modifier-keys.test.ts`
- `apps/web/src/renderers/Orthographic2DRenderer.tsx`
- `apps/web/src/renderers/map-interaction.ts`
- `apps/web/src/renderers/map-tool-shortcuts.ts`
- `apps/web/src/renderers/map-escape.ts`
- `apps/web/src/renderers/map-escape.test.ts`
- `apps/web/src/styles.css`
- `tests/map-tool-shortcuts.test.ts`

### Test infrastructure and repaired acceptance fixtures

- `.dockerignore`
- `Dockerfile.e2e`
- `package.json`
- `playwright.multiplayer.config.ts`
- `tests/e2e/tsconfig.json`
- `tests/e2e/workspace-nav-helper.ts`
- `tests/e2e/*.spec.ts` из текущего dirty status
- `tests/multiplayer/game-session.spec.ts`

### Documentation

- `README.md`, `ROADMAP.md`, `tasks.md`
- `docs/README.md`, `docs/current-state.md`, `docs/architecture.md`
- `docs/development-guide.md`, `docs/testing.md`, `docs/operations.md`
- `docs/deployment.md`, `docs/production-release-checklist.md`
- актуализированные historical plan/status документы из текущего dirty status
- `docs/arken-space-interface-specification-2026-08-20.md`
- `docs/arken-space-interface-specification-checkpoint-2026-08-20.md`
- `tests/documentation-freshness.test.ts`

Три `docs/stickers/prompts/ST-*.md` исключены: это отдельные приватные
творческие материалы, они не читались для product scope, не форматировались и не
должны попасть в технические коммиты.

## Проверка

- Realtime focused: **41/41 PASS**.
- Documentation freshness: **13/13 PASS**.
- `pnpm typecheck`: PASS, включая typed E2E fixtures.
- `pnpm lint`: PASS, 0 errors; остаются 3 известных warnings.
- `pnpm build`: PASS; только существующее предупреждение о размере web chunk.
- Полный Vitest: **167 files / 1193 tests PASS**.
- Полный Chromium: **75 passed / 10 skipped / 0 failed**.
- Полный Firefox: **75 passed / 10 skipped / 0 failed**.
- Post-fix targeted Chromium + Firefox: **8/8 PASS** для UIX-462, UIX-274,
  object-list Escape и UIX-268 sticker contract.
- Изолированный Docker multiplayer: **2/2 PASS**, включая backend restart,
  reconnect, role/privacy и shared-browser handoff.
- Runner `arken-e2e-uix491-final3-20260820`: `playwrightExitCode: 0`,
  `cleanupExitCode: 0`, leftovers containers/volumes пусты.
- Scoped technical Prettier: PASS; `git diff --check`: PASS.

## Блокеры и незакрытые gates

- 8 live-token browser tests пропущены: локальный GM token placeholder-like, а
  существующий credential hash не обновляется повторным seed. Нужна безопасная
  rotation с известным текущим token либо отдельное разрешение на local reset.
- UIX-422 compact session shell и UIX-365 Direct UI остаются явными `fixme`.
- Человеческий recurring-session rehearsal GM + 6 не выполнен.
- Production release/backup/restore/smoke gate не запускался; production не
  изменялся.
- Realtime fog check читает ordered fog history сцены на movement. Это privacy-
  first решение; будущий cache возможен только со строгой invalidation.
- `App.tsx`, `Orthographic2DRenderer.tsx`, `concept.spec.ts`, `docs/README.md` и
  часть E2E-файлов содержат несколько логических scopes и требуют patch staging.
- `tests/e2e/world-maps.spec.ts` фиксирует отсутствие Player navigation entry,
  но не заменяет отдельную проверку разрешённой map projection; карты мира в
  feature scope этого пула не входили.

## Следующий шаг

1. Провести финальный patch-by-patch review и показать точный commit scope.
2. Обновить Linear stage-gate comments без закрытия acceptance criteria,
   которые требуют live credential или human rehearsal.
3. Создать раздельные commits; не использовать `git add -A`.
4. Push и production выполнять только после отдельного подтверждения.
