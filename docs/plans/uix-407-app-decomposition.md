# UIX-398 — Декомпозиция монолита App.tsx (MapToolbar)

## Контекст и цель

Монолитный компонент `apps/web/src/App.tsx` превысил 3000 строк и сочетал в себе глобальное состояние сеанса, навигацию, боковую панель, рендерер карты, поповеры и разметку панели инструментов `MapToolbar` вместе с дочерними контролами истории холста и настройки сетки.

Цель задачи UIX-398 (согласно `docs/app-tsx-decomposition-plan.md`):
Поэтапно декомпозировать `App.tsx` без изменения внешней функциональности, сохраняя:

- `CampaignActionsContext` инвариант (только стабильные функции действий без мутирующего состояния).
- Селекторы, структуру DOM и `data-tool` атрибуты для совместимости с E2E (`tests/e2e/toolbar-overflow-history.spec.ts`).
- Регрессионные структурные тесты закрытия поповеров (`dismissible-popovers.test.ts`), иконок (`map-toolbar-icons.test.ts`) и меню дополнительных инструментов (`toolbar-overflow.test.ts`).

## Реализованные изменения

### 1. Выделение изолированных компонентов

- `apps/web/src/renderers/CanvasHistoryControls.tsx`:
  - Кнопки отмены и повтора действий на холсте (`UNDO` / `REDO`).
  - Запрос `/api/canvas/history`, вызов `/api/canvas/undo` и `/api/canvas/redo`.
  - Глобальный обработчик `Ctrl+Z` / `Ctrl+Shift+Z` с защитой от полей ввода.
- `apps/web/src/renderers/GridSettings.tsx`:
  - Настройки шага, смещения, цвета сетки и предварительного просмотра.
  - Поповер `<details className="grid-settings">` с `useDismissibleDetails`.
- `apps/web/src/MapToolbar.tsx`:
  - Все инструменты карты (`PAN`, `FOG`, `COVER`, `FOG_BRUSH`, `COVER_BRUSH`, `FOG_POLYGON`, `COVER_POLYGON`, `RULER`, `PING`, `BATTLE_ZONE`, `DRAW`, `RESIZE`).
  - Управление схлопыванием панели инструментов с сохранением в `localStorage`.
  - Наблюдатель `ResizeObserver`, транслирующий вычисленную ширину в CSS-переменную родителя `--map-toolbar-width`.
  - Управление боем (`ENCOUNTER_START` / `ENCOUNTER_END`).
  - Меню дополнительных инструментов `•••` (`toolbar-overflow`).

### 2. Метрики разгрузки App.tsx

- До: **3034** строки.
- После: **2385** строк.
- Разгрузка: **-649 строк** кода монолита (-721 удаление).

### 3. Тестирование и верификация

- Создан компонентный тест `apps/web/src/MapToolbar.dom.test.tsx` (5 тестов: PLAYER vs GM роли, переключение инструментов, сворачивание, запуск энкаунтера).
- Проведена обязательная **диверсия** с намеренным падением теста и восстановлением.
- Актуализированы структурные тесты `toolbar-overflow.test.ts`, `map-toolbar-icons.test.ts`, `dismissible-popovers.test.ts`.
- Полный прогон `apps/web`: **105 файлов тестов из 105 успешно пройдены (684 теста PASS)**.
- `pnpm --filter @arken/web typecheck`: 0 ошибок.
- `pnpm eslint`: 0 ошибок.
- `pnpm build`: все 5 проектов воркспейса собраны успешно.

## Ветка и коммиты

- Ветка: `antigravity/uix-407-app-decomposition`
- Коммит: `3aed870` — `refactor(web): extract MapToolbar from monolithic App.tsx (UIX-407)`

## Уточнение ревью UIX-619

Историческое имя ветки и заголовок коммита не менялись. UIX-407 относится к инструментации и замерам производительности; выделение MapToolbar не закрывает эту задачу и не доказывает ускорение интерфейса.
