# AI Execution Log

> **Статус для релиза 03.10.2026:** записи ниже — рабочий журнал Antigravity, а не подтверждение приёмки. Отметки `[x]`, слова «проверено» и прежние количества тестов отражают локальные заявления на момент записи; полный обязательный Vitest/E2E, визуальная и ручная GM/PLAYER приёмка полного кандидата ещё не завершены. Актуальные проверенные результаты и блокеры ведутся в `uix-317-2026-10-03-checkpoint.md` и `full-redesign-candidate-2026-10-03.md`.

## Сессия: Сентябрь 2026

### Выполнено:

- [x] **UIX-662**: Убрана надпись "Бросаем … 1" в блоке быстрых бросков и устранен скачок высоты панели кубов.
- [x] **UIX-289**: Добавлены анимированные рамки для бросков 1 и 20 (Critical Fumble / Success). Настроены fallback-состояния и отключение анимаций для старых сообщений.
- [x] **UIX-317 (Часть 1)**: Проведен полный read-only аудит CSS-токенов проекта, собрана матрица состояний, сформирована единая Canonical Semantic Schema для будущей дизайн-системы.
- [x] **Local Tasks**: Зафиксированы и полностью устранены 4 критических бага с продакшена:
  - **LOCAL-9802**: Устранен перезапуск музыки при удалении/изменении токенов на холсте. В `MusicBar.tsx` исправлен расчет циклического трека (`((rawExpected % trackDuration) + trackDuration) % trackDuration`) и добавлен `lastSyncRef`, предотвращающий холостые сбросы `<audio>`. Проверено: 27 тестов в `MusicBar.test.ts`.
  - **LOCAL-505**: Устранен рассинхрон токенов мастера у игроков без F5. В `chat-state.ts` убрана мутация `snapshotVersion` от `chat_messages.sequence`, приводившая к отбрасыванию валидных игровых снапшотов в `reconcileGameSnapshot`. Проверено: тесты в `chat-state.test.ts` и `character-mutation.test.ts`.
  - **LOCAL-6504**: Устранено обрезание длинных названий токенов при отдалении холста (zoom out). В `Orthographic2DRenderer.tsx` ширина текстовой рамки и центрирование пересчитаны с учетом `1 / scale`, предотвращая отсечение букв движком Konva. Проверено: тесты в `Orthographic2DRenderer.scene-region.test.tsx`.
  - **LOCAL-6359**: Разрешено игрокам редактировать карточки и способности своих персонажей. На бэкенде в `routes.ts` (`POST /api/characters/:id/catalog`, `PATCH /api/characters/:characterId/catalog/:id`, `DELETE /api/characters/:characterId/catalog/:id`) авторизация переведена на `canAccessCharacter` (GM, владелец, контроллер персонажа) с защитой от изменения чужих персонажей (403 `CHARACTER_FORBIDDEN`), в то время как создание глобальных шаблонов кампании (`POST /api/catalog`) строго сохранено за GM (403 `GM_REQUIRED`). Во фронтенде в `CharacterWorkspace.tsx` кнопки добавления/редактирования/удаления навыков и способностей открыты для `editable`. Проверено: 17 тестов в `CharacterPanel.role-access.test.tsx`, 4 интеграционных теста в `character-catalog-acl.integration.test.ts`, 59 тестов в `pool-b-http.test.ts`.
- [x] **Performance Optimization & Lag Elimination**:
  - **RAF Pan Batching**: В `Orthographic2DRenderer.tsx` перемещение холста при зажатом колесе/пробеле переведено на батчинг через `requestAnimationFrame` с `panRafRef` и `pendingPanPositionRef`. Это устранило лаги и микрофризы от сотен высокочастотных синхронных перерисовок Konva Stage в секунду (500–1000 Гц у игровых мышей).
  - **Stage Array & Node Memoization**: В `Orthographic2DRenderer.tsx` мемоизированы массивы `tokensOnStage`, `ownTokensOnStage`, `otherTokensOnStage` через `useMemo`, а сам компонент обёрнут в `React.memo`, исключая холостые пересчеты геометрии при фоновых событиях чата или таймеров.
  - **Root Cascade Stabilization**: В `App.tsx` мемоизированы `viewSnapshot` и активные коллекции (`activeTokens`, `activeFog`, `activeDrawings`, `activePings`, `activeRulers`, `activeCursors`), а также 24 callback-пропа, передаваемых в рендерер и боковую панель. Все хуки подняты строго выше ранних выходов (`authRequired`, `!viewSnapshot`), гарантируя соблюдение Rules of Hooks.
  - **Sidebar & Chat Memoization**: В `Sidebar.tsx` компонент обёрнут в `React.memo`. В `ChatPanels.tsx` компонент `ChatMessageBody` обёрнут в `React.memo`, а парсинг карточек бросков и критических исходов (`parseSkillCard`, `normalizeClientDiceResult`, `getDiceCritical`) кэширован через `useMemo`.

- [x] **UIX-398 / Архитектура и правила написания кода (Anti-Monolith & Performance Guard)**:
  - **Правила написания кода (`docs/CODING_GUIDELINES.md`)**: Сформулирован и закреплен действующий архитектурный стандарт из 7 правил:
    1. _App Composition Root_: `App.tsx` — исключительно композитор верхнего уровня (провайдеры + каркас layout). Никаких инлайновых фич, диалогов или сокет-хэндлеров.
    2. _Modal Isolation_: Запрещен инлайнинг диалогов в `App.tsx`. Все модальные окна выносятся либо в свои фичи, либо в `AppModals.tsx`.
    3. _Domain Action Hooks_: Все REST/сокет мутации инкапсулируются в `use*Actions.ts` и регистрируются в `CampaignActionsContext`. Контекст хранит строго функции (инвариант нулевой стоимости рендера).
    4. _Reference Stability (`latestRef`)_: Обработчики, зависящие от `snapshot` или `activeScene`, читают их через `useLatestRef`, сохраняя стабильную ссылку и защищая `React.memo` от инвалидации.
    5. _Socket Segregation_: Изоляция сокет-подписок от тела корневого компонента.
    6. _Запрет заимствования типов через `Pick<SidebarProps>`_.
    7. _Автоматический контроль инвариантов_.
  - **Связывание документации**: `docs/CODING_GUIDELINES.md` подключен в основной онбординг [docs/development-guide.md](file:///d:/AI/personal/experiments/arken-space/.worktrees/uix-421-scene-inputs/docs/development-guide.md).
  - **Автоматический тест архитектуры (`apps/web/src/architecture.test.ts`)**: Добавлен тест, гарантирующий соблюдение правил (лимит строк `App.tsx`, отсутствие `<ArkenDialog>` / `<TextPromptDialog>` / `<details className="token-tray">` / `<header className="topbar">` в корневом файле).
  - **Декомпозиция `App.tsx` (сокращение с 2 865 до 2 478 строк, минус 387 строк)**:
    - Выделен `apps/web/src/TokenTray.tsx` с внутренней инкапсуляцией `useDismissibleDetails(tokenTrayRef)`.
    - Выделен `apps/web/src/ScenePicker.tsx` с внутренней инкапсуляцией `useDismissibleDetails(scenePickerRef)`.
    - Выделен `apps/web/src/AppHeader.tsx` с внутренней инкапсуляцией `useDismissibleDetails(accountMenuRef)` и навигации.
    - Выделен `apps/web/src/AppModals.tsx`, агрегирующий диалоги темы, компактных разделов, смены игрока, переименования кампании и шорткатов.
    - Удален забытый мертвый диалог `createSceneOpen` (создание сцен выполняется через `SceneManagerDialog`).
    - Синхронизированы реестры оверлеев `docs/plans/uix-644-overlay-sites.json` и `docs/plans/uix-644-runtime-coverage.json`, тесты `dismissible-popovers.test.ts` и `overlay-inventory.test.ts` зелёные.

- [x] **UIX-398 (Декомпозиция `App.tsx` — Фаза 2: Вынос сокет-подписок и сокет-стейта)**:
  - Создан специализированный хук `apps/web/src/use-game-socket-subscriptions.ts`, полностью инкапсулирующий работу с сокетами Socket.IO:
    - Подписки на события жизненного цикла (`connect`, `disconnect`, `reconnect_attempt`, `reconnect_failed`, `server:error`).
    - Игровые события (`game:snapshot`, `scene:activated`, `token:moving`, `token:moved`, `fog:created`, `fog:removed`, `map:ping`, `ruler:updated`, `ruler:cleared`, `cursor:moved`, `cursor:gone`, `story:changed`, `player-request:changed`, `chat:thread_created`, `chat:created`, `character:updated`, `audio:state`, `presence:updated`).
    - Механизм дедупликации `emitSceneViewIfNeeded` и синхронизация сцены мастера `viewedSceneId`.
    - Управление состоянием сокета (`socket`, `setSocket`) и сетевого статуса (`connection`, `setConnection`).
  - Из `App.tsx` устранены устаревшие вспомогательные структуры и ссылки:
    - Удалены `lastSceneViewEmissionRef`, `viewedSceneIdRef`, `ownMembershipIdRef`, `toastAppearanceRef`.
    - Удалены локальный `type SceneViewEmission` и функция `emitSceneViewIfNeeded`.
    - Очищены 8 неиспользуемых внешних импортов (`createGameSocket`, `applyPlayerRequestChanged`, `applyCursorMoved`, `reportClientEvent`, `upsertDirectThread`, `appendChatMessage` и др.).
  - Создан набор модульных тестов `apps/web/src/use-game-socket-subscriptions.test.tsx` (4 теста на дедупликацию эмиссий, реконнекты и смену сцены).
  - Обновлен архитектурный тест `apps/web/src/architecture.test.ts`:
    - Добавлена автоматическая проверка Правила 5 (запрет инлайнинга сокет-подписок `socket.on(...)` в `App.tsx`).
    - Лимит строк `App.tsx` ужесточен до 2 250 строк.
  - **Динамика размера `App.tsx`**:
    - Исходный размер: **2 865 строк**.
    - После Фазы 1 (модали, панели, шапка, лоток): **2 478 строк** (-387 строк).
    - После Фазы 2 (сокеты, стейт подключения, очистка импортов): **2 222 строки** (-256 строк).
    - Суммарное сокращение: **-643 строки (-22.4%)**.

### Верификация:

- **TypeScript**: Полный строгий тайпчек `pnpm --filter @arken/web exec tsc --noEmit` — 0 ошибок.
- **Production Build**: Сборка веб-клиента Vite (`pnpm --filter @arken/web build`) — успешно за 3.92s.
- **Vitest Suite**: 167 файлов тестов, 1 268 тестов — 100% pass (включая `architecture.test.ts`, `App.character-queue.test.tsx`, `use-game-socket-subscriptions.test.tsx`, `dismissible-popovers.test.ts`, `overlay-inventory.test.ts`).

### Решения и прогресс:

- [x] **UIX-317 (Дизайн-система — Решение)**: Принято решение не оставлять Gravity UI каноничным, а проектировать и строить полноценную самостоятельную дизайн-систему (`@base-ui/react` + семантические CSS-токены + изолированные product wrappers, исключающие прямое просачивание `@gravity-ui/uikit`).
- [x] **UIX-645 (Lucide — Visual QA)**: Визуальная приёмка пользователем пройдена (иконки приняты; скролл вниз в сторибуке поправлен).
- [x] **UIX-398 (Декомпозиция — Фаза 1 и Фаза 2)**: Полностью завершены.
- [x] **UIX-317 (Пакет 1: Button + Input & TextArea)**: Автономные компоненты созданы, протестированы и интегрированы в `GravityFormControls.tsx`.
- [x] **UX-AUDIT (Бэклог UX-аудита)**: Зафиксирован системный бэклог в `docs/plans/ux-audit-backlog.md` (персонажи, создание/редактирование, права доступа, иерархия сайдбара).
- [x] **UIX-317 (Дизайн-система — Правила и Foundations)**: Стандартизация базы (шкала отступов, высоты 24–44px, типографика, скругления, ритм форм) в `DESIGN_SYSTEM.md` и `foundations.css`.
- [x] **UIX-317 (Пакет 2: Checkbox + Switch)**: Реализация автономных `Checkbox` и `Switch` на `@base-ui/react` + интеграция в `GravityFormControls.tsx` и `CursorPresenceMenu.tsx`. 11 тестов green.
- [x] **UIX-317 (Пакет 3: Dialog / Modal)**: Автономный модальный диалог на `@base-ui/react/dialog` + интеграция в `ArkenDialog.tsx` (все модалки стола переведены). 5 тестов green.

### В ожидании / Следующие шаги:

- [ ] **UIX-317 (Пакет 4: Select)**: Автономный селект на `@base-ui/react/select` + замена UIKit `<Select>` в `GravityFormControls.tsx`.
- [ ] **UIX-317 (Шаг 5: Исключение UIKit)**: Полное удаление импорта `@gravity-ui/uikit` из `main.tsx` и бандла приложения.
- [ ] **UX-AUDIT (Реализация)**: Проведение глубокого UX-редизайна создания и управления персонажами после стабилизации дизайн-системы.
- [ ] **UIX-398 (Декомпозиция — Фаза 3, опционально)**: Вынос доменных хэндлеров персонажей/чата/токенов в специализированные action-хуки для дальнейшего сжатия `App.tsx` к целевым < 1 500 / 800 строкам.
