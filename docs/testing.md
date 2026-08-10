# Тестирование: где что живёт

Короткий справочник по видам тестов в репозитории и по тому, когда писать
какой. Общий quality gate и команды — в
[development-guide.md](./development-guide.md#рекомендуемый-quality-gate).

## Виды тестов

| Вид | Где живёт | Среда Vitest | Когда использовать |
| --- | --- | --- | --- |
| Unit / pure logic | рядом с модулем, `*.test.ts` | `environment: "node"` (по умолчанию) | Извлечённая чистая логика без DOM и без React: dice grammar, fog geometry, `asset-picker-logic.ts`, `formula-display.ts`, `composer-keyboard-intent.ts`, `music-playback.ts`, reducers, event-order helpers. Предпочтительный вид теста для любой логики, которую можно вынести из компонента. |
| Component | рядом с компонентом, `*.test.tsx`, первая строка файла — `// @vitest-environment jsdom` | jsdom (per-file docblock) | Реальное взаимодействие с React-компонентом: клик, клавиатура, доступные роли/лейблы, условный рендер по данным (например, `snapshot.me.role`). См. `AssetPicker.interaction.test.tsx` и `MediaPanel.test.tsx` как образцы. |
| Integration | `apps/server/**/*.test.ts`, `tests/**/*.test.ts` | `node` | Настоящие Fastify handlers и Socket.IO server/client поверх Drizzle/PGlite: authz, CAS/idempotency, snapshot visibility, migrations. |
| Full-stack / multiplayer | `pnpm test:multiplayer` (отдельный Docker-раннер) | вне Vitest | PostgreSQL 17 + server + web + nginx, GM + 6 контекстов, reconnect, приватность между ролями. Обязателен при изменениях realtime/visibility/auth/canvas persistence/reconnect/Docker/nginx/migrations. |
| Browser QA | вручную, `pnpm dev` / Playwright (`pnpm test:e2e`) | реальный браузер | Всё, что требует настоящего Canvas/Konva рендеринга, drag-and-drop с pointer capture, визуальную проверку fog/сцены. |

## DOM-окружение для component-тестов

Корневой `vitest.config.ts` держит `environment: "node"` по умолчанию —
это быстрее и достаточно для подавляющего большинства тестов (pure logic,
server, PGlite). Component-тесты переключают окружение точечно, через
докблок в первой строке файла:

```ts
// @vitest-environment jsdom
```

Мы выбрали **jsdom**, а не happy-dom: happy-dom легче и быстрее, но у него
исторически хуже поддержка нюансов, на которые здесь реально полагаются
компоненты и react-testing-library (focus management, `KeyboardEvent.key`
semantics для `AssetPicker`'s arrow-key navigation, form/file input
поведение). jsdom — это то, на чём тестируется сама React Testing Library,
так что риск скрытых расхождений с реальным браузером ниже. Пере-оценить
happy-dom стоит только если jsdom станет узким местом по скорости — сейчас
этого не наблюдается на паре компонентных тестов.

Не меняйте `environment: "node"` в корневом конфиге — это сломает скорость
всех не-DOM тестов.

## Что использовать в component-тесте

- `apps/web/src/test-support/render.tsx` — `renderComponent` (обёртка над
  `@testing-library/react`'s `render`, с зарегистрированным `afterEach(cleanup)`
  на файл) плюс ре-экспорт `screen`, `within`, `waitFor`, `userEvent`.
  Подключает `@testing-library/jest-dom/vitest`, так что матчеры вроде
  `toBeInTheDocument()`/`toHaveFocus()` доступны без отдельного импорта.
- `apps/web/src/test-support/game-snapshot-fixtures.ts` — `gmSnapshot()` /
  `playerSnapshot()` строят настоящий типизированный `GameSnapshot` с
  `me.role`, установленным в `"GM"`/`"PLAYER"`. **Роль всегда идёт через
  реальный prop/data-путь приложения** (`snapshot.me.role`), а не через
  отдельный "testOnlyRole"-флаг — так тест не может случайно доказать, что
  что-то работает для PLAYER, если реальная авторизация это заблокировала
  бы. Читайте doc-comment в файле перед тем, как добавлять overrides.
- `apps/web/src/test-support/dom-mocks.ts` — точечные, опциональные моки
  browser API, которых jsdom не реализует (`ResizeObserver`, `matchMedia`).
  Подключайте только то, что реально нужно тесту; `localStorage` в jsdom
  уже работает нативно и мокать не надо.

## Мокинг `@gravity-ui/uikit`

Компоненты приложения тяжело завязаны на Gravity UI, а сам пакет тянет CSS,
который Vitest-трансформ не обрабатывает — это верно и под `node`, и под
`jsdom` (проблема не в отсутствии DOM, а в CSS-импорте). Устоявшийся
паттерн (см. `AppErrorBoundary.test.ts`, `RollButton.test.tsx`,
`ChatPanels.test.tsx`, `MediaPanel.test.tsx`) — замокать `@gravity-ui/uikit`
на файл через `vi.mock`, но **типизировать мок по реальному prop-контракту**
компонента (импортировать типы пропсов, а не выдумывать форму вручную).
Мок, который не тайпчекается против настоящих пропсов, — ровно тот failure
mode, который однажды пропустил тайпчекер: смотрите на аннотации типов в
`MediaPanel.test.tsx` как на образец.

## Canvas / Konva — вне зоны component-тестов

`react-konva`/Konva не тестируются в jsdom: это известная кроличья нора
(нет реального canvas-рендеринга, hit-testing и т.д.). Поведение канваса
остаётся покрыто:

- извлечённой чистой логикой (`camera-fit.ts`, `fog.ts`,
  `map-interaction.ts`, `token-placement.ts`);
- ручным browser QA / Playwright (`pnpm test:e2e`) для визуальной проверки.

Не пытайтесь смонтировать `Orthographic2DRenderer` в jsdom-тесте.

## Чек-лист для нового component-теста

1. Первая строка файла — `// @vitest-environment jsdom`.
2. Импортируйте `renderComponent`/`screen`/`userEvent` из `test-support/render`.
3. Если тестируете что-то role-gated — используйте `gmSnapshot()`/
   `playerSnapshot()`, не собирайте роль вручную.
4. Мокайте `@gravity-ui/uikit` (и любой другой тяжёлый дочерний компонент)
   только по нужным пропсам, типизируя мок по реальному контракту.
5. Запросы — через accessible queries (`getByRole`, `getByLabelText`), а не
   через `container.querySelector`/CSS-классы.
6. Перед коммитом сломайте компонент вручную и убедитесь, что тест падает —
   зелёный тест, который не может упасть, хуже отсутствия теста.
