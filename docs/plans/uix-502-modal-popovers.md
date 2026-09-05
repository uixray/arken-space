# UIX-502 — modal-owned dropdowns

## Замер

PR #58 устраняет видимый дефект: внешний Floating UI wrapper Gravity Select поднят над modal, и hit-test проходит. Но правило глобально поднимает любой `.g-select-popup` до dialog+1, не различая owner workspace/modal, зависит от приватной DOM-структуры и не доказывает keyboard, focus, narrow placement или nested dialog lifecycle.

## План

1. Добавить контекст overlay-owner в `ArkenDialog`: modal или workspace.
2. Провести Gravity Select через общий wrapper, который назначает popup class по owner; мигрировать raw Select в FeedbackReporter.
3. Ограничить CSS Floating wrapper scoped modal popup вместо глобального `.g-select-popup`; workspace popup не должен обгонять modal.
4. Расширить существующий token-editor browser flow на desktop и narrow: hit-test/clipping, keyboard Enter, Escape/outside dismiss, focus return, переход к nested dialog.
5. Выполнить адресную диверсию по modal popup layer и связанный UI gate. Production-сервер не используется.

## Зависимость

Ветка stacked на PR #58, где находится проверенный hotfix внешнего Floating wrapper. Merge и publication выполняются позже отдельным scope.

## Чекпоинт реализации

- Решение: владелец overlay передаётся контекстом `base | workspace | modal`; общий `FormSelect` маркирует popup классом владельца, а CSS поднимает только внешний Floating UI wrapper соответствующего слоя.
- Слои: workspace-select остаётся выше плавающих рабочих окон, но ниже dialog; modal-select расположен на `dialog + 1`. Глобальное повышение всех `.g-select-popup` удалено.
- Изменённые файлы: `FeedbackReporter.tsx`, `ArkenDialog.tsx`, `GravityFormControls.tsx`, `gravity-foundation.css`, новые `overlay-owner.ts` и `overlay-owner.test.ts`, браузерная регрессия в `tests/e2e/token-generator.spec.ts`.
- Проверка: unit owner tests 2/2 PASS; web typecheck PASS; адресные ESLint, Prettier и `git diff --check` PASS; UIX-502 Playwright desktop+narrow в Chromium+Firefox 4/4 PASS.
- Диверсия: временное понижение modal popup до общего popup-layer изолированно уронило Chromium desktop UIX-502 на hit-test (`Expected true, Received false`); после теста исходный CSS восстановлен побайтно, нормальный прогон остаётся зелёным.
- Среда: первая попытка Playwright была остановлена Windows `EPERM` на `.last-run.json`; повтор с отдельным output-каталогом прошёл. Docker и production не использовались.
- Блокеры: нет. Следующее действие — commit, push, stacked PR и перевод Linear в In Review.

## Возобновление — регрессия workspace popup, 05.09.2026

- Исходная ревизия: `3c685a0`; свежая база PR #58 `34ccd8a` влита обычным
  merge-коммитом `b4ee2aa`. `origin/main` остаётся `f1a66c8`.
- Воспроизведение: исходный Chromium workspace hit-test падает именно на
  `Expected true / Received false`, как GitHub E2E PR #63.
- Замер до правки: внешний Floating UI wrapper имеет computed `z-index: auto`,
  workspace — `1204`; `CSS.supports("z-index", "1999.5")` возвращает `false`.
  В центре option `elementFromPoint` возвращает чужой `SPAN.g-button__text`.
  Предки workspace не создают дополнительного stacking context.
- Решение: только целочисленные слои — workspace `1200…1998`, его popup
  `1999`, blocking modal `2000`, modal popup `2001`. Контекст владельца и
  портал не переписываются; устранена подтверждённая невалидная CSS-величина.
- Файлы: `apps/web/src/ui/gravity-foundation.css`,
  `apps/web/src/ui/useWorkspaceWindow.ts`,
  `tests/e2e/scene-workspace-dialog.spec.ts`, этот checkpoint и
  `docs/current-state.md`.
- Регрессия проверяет реальный hit-test и выбор option при обычном открытии и
  после насыщения счётчика поднятия workspace. Между workspace и dialog должен
  оставаться отдельный целочисленный popup-слой; замеры прилагаются к трассе.
- Уточнение границы прежних доказательств: переход из token picker в
  «Подготовку» проверяет закрытие popup и смену workspace, а не одновременно
  открытый nested modal. Строгая иерархия произвольных вложенных modal с
  сохраняющимся открытым popup пока не доказана. Подтверждённого отдельного
  runtime-дефекта в таком сценарии нет; архитектура не расширяется вслепую.
- Проверки: восстановленный popup-пул Chromium+Firefox — **8/8 PASS** без
  retries (workspace normal/cap, FeedbackReporter, token modal desktop/narrow).
  Замеры после правки: normal `1204 < 1999 < 2000`, saturated
  `1998 < 1999 < 2000` после 832 событий pointerdown.
- Диверсии — три изолированных ожидаемых FAIL, после каждого исходники
  восстановлены побайтно:
  - возврат popup `1999.5` роняет normal-phase integer assertion;
  - возврат workspace cap `1999` роняет saturated-phase strict ordering;
  - понижение modal popup до `1000` роняет desktop token modal hit-test.
- Артефакты: `%TEMP%/arken502-diversion-{fractional,cap,modal}.log` и
  одноимённые output-каталоги с трассами;
  `%TEMP%/arken502-restored-pool.log` — итоговый зелёный browser-пул.
- Полный quality gate выполняется; полный GitHub gate после push обязателен.
  До его завершения PR не считается зелёным.
- Merge PR, публикация и production-данные не использовались.
