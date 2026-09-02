# UIX-402 — часы и дни партии: checkpoint 2026-09-01

Статус: локально готово к review. Push, PR, merge и production-публикация не
выполнялись.

## Решения

- Источник дефекта — два независимых lifecycle: encounter создавался и
  завершался без изменения `campaigns.battleActive` и `battleCounter`.
- Start/end encounter теперь атомарно меняют encounter, боевые часы и
  инициативу; BATTLE-перезарядка выполняется один раз при завершении.
- Legacy `START_BATTLE` и `END_BATTLE` остаются совместимыми только вне ACTIVE
  encounter и не могут разорвать новое единое состояние.
- `RESET_CLOCK` — GM-only команда под revision/actionId. Она возвращает часы к
  `день 1 / боёв 0`, очищает инициативу и переносит recharge-якоря, но не
  восстанавливает текущие uses.
- Глобальное управление временем вынесено из каждой карточки персонажа в один
  GM-dialog. `ADVANCE_DAY` и `LONG_REST` остаются разными действиями.

## Ревизия

- Ветка: `codex/uix-402-campaign-clock`.
- Baseline: `23683ae` (`origin/main` на старте).
- Реализация: `04f2997d2026615748caef2dee535aa7d3264b09`.
- Multiplayer health подтвердил ровно эту build revision.

## Изменённые файлы

- Сервер: `apps/server/src/battle-initiative.ts`,
  `apps/server/src/campaign-clock.ts`, `apps/server/src/encounters.ts`,
  `apps/server/src/routes.ts`.
- Web: `apps/web/src/Sidebar.tsx`,
  `apps/web/src/sidebar/CharacterWorkspace.tsx`,
  `apps/web/src/sidebar/CampaignClockDialog.tsx`.
- Контракт: `packages/contracts/src/index.ts`.
- Тесты: `apps/server/src/encounters.integration.test.ts`,
  `apps/web/src/sidebar/CampaignClockDialog.test.tsx`,
  `tests/pool-b-http.test.ts`, `tests/e2e/concept.spec.ts`,
  `tests/multiplayer/game-session.spec.ts`.
- Документация: `docs/architecture.md`,
  `docs/plans/uix-402-party-clock.md`, этот checkpoint.

Запрещённые параллельные файлы `apps/web/src/App.tsx`,
`apps/web/src/styles.css` и `apps/web/src/sidebar/ChatPanels.tsx` не менялись.

## Проверка

- Повторное независимое review четырёх исправлений: замечаний нет.
- Точечные наборы: encounter `18/18`, initiative `21/21`, dialog `8/8`; новый
  browser-flow проходил отдельно в Chromium и Firefox.
- Основной гейт: `format:check`, `lint`, `typecheck`, `build` — PASS;
  Vitest — `186` файлов / `1434` теста PASS. Lint сохранил три прежних warning
  в чужих файлах, ошибок нет.
- Полный `pnpm test:e2e` через изолированный container edge: `211 passed`,
  `4 skipped`, один layout-тест прошёл retry; exit code `0`. Новый UIX-402 flow
  зелёный в Chromium и Firefox. Dev-Vite на Windows до этого упал с
  `3221226505`; это не засчитано как гейт и заменено полным стабильным прогоном
  того же Playwright-набора через production build + nginx.
- `DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true pnpm
test:multiplayer`: `2/2` PASS; backend restart выполнен; cleanup и
  resource-leak check PASS; контейнеров и volumes не осталось. Production
  health до и после намеренно пропущен режимом isolated-only.

## Диверсия

- Временно отправленный из подтверждения `LONG_REST` вместо `RESET_CLOCK`
  уронил ровно целевой component-тест (`1 failed`, остальные skipped); после
  восстановления dialog-набор зелёный `8/8`.
- Временно возвращённый numeric-only baseline уронил ровно три repair-case со
  stale WEEK/BATTLE anchor и инициативой; после восстановления все три зелёные.

## Блокеры и следующий шаг

Блокеров реализации нет. Следующий внешний gate — по решению владельца отправить
ветку, открыть PR и дождаться зелёных GitHub checks/e2e/multiplayer. Агент не
мержит PR и не публикует production без отдельного запроса.
