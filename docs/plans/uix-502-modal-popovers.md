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
