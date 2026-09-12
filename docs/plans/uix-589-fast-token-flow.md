# UIX-589 — быстрый token flow с crop/zoom

## Замер текущего пути

Генератор уже встроен в `TokenDefinitionEditor`; диагноз задачи частично
устарел. `TokenImageGenerator` уже даёт center-cover preview, pan, keyboard
nudge, zoom и server-side 512×512 derivative.

Подтверждённый дефект находится в orchestration:

- upload создаёт исходный `IMAGE` и сразу записывает его ID в `assetId`;
- `AssetPicker` также разрешает выбрать `IMAGE` как итоговое изображение;
- submit принимает этот IMAGE без обязательного шага генерации TOKEN;
- renderer затем показывает прямоугольный IMAGE внутри формы токена, поэтому
  пользователь видит не тот crop, который ожидал.

То есть второй crop engine не нужен. Нужно сделать существующий generator
обязательным переходом для IMAGE и объединить источники ввода вокруг него.

## Подзадачи

1. **Vertical safety slice:** IMAGE становится только source; submit требует
   производный TOKEN, upload автоматически выбирается в generator, но не в
   definition. Покрыть portrait/landscape и cancel/failure.
2. **Unified intake:** picker, paste и drop проходят общую file validation и
   открывают тот же editor.
3. **Create-and-place:** после успешного derivative атомарно создать definition
   и только затем placement; показать success state.
4. **Replace:** переиспользовать editor и серверную атомарную замену UIX-609,
   сохраняя старое изображение до commit.
5. **Responsive/accessibility:** touch targets, narrow layout и browser checks.

## Первый пул

Начать с vertical safety slice: это устраняет подтверждённое молчаливое
растягивание без изменения API и без правок `App.tsx`, `styles.css` или
`ChatPanels.tsx`. Остальные подзадачи не смешивать с этим коммитом.

## Checkpoint — 2026-09-03

- **Решения:** `IMAGE` остаётся только исходником crop/zoom; готовым изображением
  definition может быть только `TOKEN`. Picker, paste и drop объединены в один
  opt-in intake. «Создать и поставить» переиспользует транзакционный
  `POST /api/tokens`. При смене изображения definition его размещения получают
  новый `assetId` в той же транзакции; общий asset не перезаписывается.
- **Ревизии:** `051a7d4` (UIX-611), `077f539` (UIX-612), `348bf9d`
  (UIX-613), `bfc74fa` (UIX-614).
- **Изменено:** token editor и actions, `ImageUploadField`, PATCH определения,
  component/action/HTTP integration tests.
- **Проверка:** focused-наборы 8/8, 15/15, 14/14 и HTTP 1/1; scoped lint и
  package typecheck прошли; общий format/lint/typecheck/build прошёл (три
  существующих lint warning). Диверсия выполнена для каждого нового набора.
- **Блокеры:** общий Vitest дважды не завершился без результата: обычный запуск
  держал два процесса примерно по 1 ГБ, однопоточный — один процесс примерно
  1 ГБ более восьми минут; оба остановлены, чтобы не перегружать компьютер.
  Responsive-часть требует `apps/web/src/styles.css`, который исключён из
  полосы параллельной работы.
- **Дальше:** после освобождения hot-file выполнить narrow/touch CSS и browser
  QA; отдельно диагностировать зависание полного Vitest без повторного
  неограниченного запуска.

## Checkpoint — 2026-09-03 (Slice 5 — Responsive, touch targets, browser QA)

- **Решения:** `apps/web/src/styles.css` и `gravity-foundation.css` обновлены:
  - `.entity-form > .dialog-actions` получил flex wrap и мобильную раскладку с минимальной высотой тач-таргетов 44px;
  - `.token-dimensions .inline-fields` на экранах <= 520px перестраивается в двухколоночную сетку с сохранением пропорций на отдельной строке;
  - `.token-image-generator` слайдер масштаба увеличен до 40px touch-height, кнопки действий и пресеты рамок получили 44px touch targets для coarse pointers;
  - `.arken-upload-field__empty` получил интерактивный курсор, состояния `:hover`/`:focus-visible`, visual drag-over (`data-dragover="true"`) и доступность с клавиатуры (Enter / Space) и клика;
  - в `tests/e2e/token-generator.spec.ts` добавлен браузерный тест UIX-613 на быстрое создание и размещение токена на сцене в одно действие.
- **Проверка:**
  - `ImageUploadField.intake.test.tsx`: 9/9 PASS (добавлены тесты клика, клавиатуры и drag-over, диверсия проверена);
  - `token-generator.spec.ts`: 4/4 PASS (диверсия проверена, падает целево);
  - `pnpm --filter @arken/web typecheck` PASS;
  - `pnpm prettier --check` PASS.

## Checkpoint — 2026-09-08 (UIX-613, baseline реального optimistic-пути)

- **Решение:** проверять `TokenDefinitionEditor` → `useTokenDefinitionActions`
  → production placement adapter → `OptimisticTokenMutations` → настоящий
  `api`, задерживая только HTTP-ответ. Прямой rejecting callback редактора
  не доказывает сохранение формы при реальном optimistic размещении.
- **Ревизия:** локальная подготовка поверх `d68f8ed`; исправление outcome ещё
  не внесено. Callback из `App.tsx` вынесен без изменения поведения в
  `optimistic-token-placement.ts`: контракт остаётся `void`, pending токен
  рисуется сразу, ошибка пока принадлежит общему UI.
- **Изменено:** `App.tsx` (только извлечение adapter), новый production adapter,
  `TokenDefinitionEditor.optimistic.test.tsx`, этот checkpoint. Тест использует
  настоящие Gravity controls, dialog, AssetPicker и ThemeProvider; typed GM
  snapshot содержит активную сцену, готовый TOKEN и PLAYER-контроллера.
- **Проверка:** подготовлено, не запущено. Baseline должен сначала доказать один
  атомарный запрос, pending placement до ответа и rollback после HTTP 403,
  затем выявить преждевременное закрытие формы. Telemetry POST учитывается
  отдельно, любые другие запросы запрещены. Нет заявления PASS.
- **Блокер / дальше:** дождаться выделенного root слота baseline; затем добавить
  commit-aware outcome только для create-and-place, сохранив fire-and-forget
  обычных размещений и защиту от ответов старой сессии. Browser real-App gate,
  публикация и Linear-синхронизация остаются у root.

## Checkpoint — 2026-09-08 (UIX-613, outcome pool подготовлен)

- **Baseline:** root выполнил тест на старом `void`-контракте после извлечения
  adapter: 1 целевой FAIL. После задержанного HTTP 403 pending placement уже
  удалён, текст «Сцена недоступна» находится в общем error state, а диалог
  «Новый токен» отсутствует. Это воспроизведение реальной цепочки, не timeout
  и не rejecting callback, подставленный напрямую в редактор.
- **Ревизия / изменения:** незакоммиченный пул поверх `d68f8ed`; coordinator и
  его unit tests, placement adapter, `App.tsx` (adapter и два обычных callsites),
  action hook и его tests, real-chain editor test, этот документ.
- **Решения:** optimistic draft по-прежнему появляется синхронно. HTTP outcome
  coordinator разрешается как `accepted`, `failed` или `cancelled`; отказ
  транспорта не создаёт rejected promise у fire-and-forget потребителей.
  Только create-and-place ожидает commit и владеет ошибкой формы; обычные
  размещения сохраняют прежний общий error UI и раннее завершение callback.
  Пустой snapshot, pause и отсутствующая сцена возвращают явный `skipped`,
  который не считается успешным созданием. API payload, atomic endpoint,
  ACL, server code и condition mutations не менялись.
- **Защита сессии:** reset очищает draft, старый ответ не принимается и не
  пишет общий error. При завершении такого запроса outcome — `cancelled`;
  новый editor не закрывается старой операцией. Это не отмена серверного
  запроса: generation guard защищает локальную сессию, не отменяет уже
  отправленную серверную транзакцию.
- **Проверка:** сохранён исходный failing oracle; добавлены retry → success,
  сохранение чужого общего error, stale HTTP 201/403 при смене кампании,
  no-write guards и независимые coordinator outcomes. Подготовлены, но после
  исправления ещё не запускались; PASS для restored-набора не заявляется.
- **Блокеры / дальше:** root запускает единый focused gate, проверки типов,
  линтер и browser real-App delayed-failure сценарий; затем оценивает gate и
  решает вопрос публикации. `TokenPalette.tsx` и существующий browser spec
  не изменялись в этой полосе ownership.

### Review follow-up — lifetime редактора (baseline подготовлен)

- Root restored gate: 5 файлов / 40 tests PASS; typecheck PASS после исправления
  трёх неподдерживаемых RTL query options в тесте. Lint ещё выявляет два чтения
  refs через factory во время `useMemo`; это остаётся отдельной локальной правкой.
- Независимый review выявил другой lifetime риск: при закрытии pending редактора
  A через header × и открытии нового B в той же сессии поздний HTTP 201 A вызывает
  старый `onCancel` и закрывает B. Оба editor-state равны строке `NEW`, поэтому
  сравнение только этого значения не защищает новую форму.
- Подготовлен дополнительный baseline на настоящем `PalettePanel` и полном
  typed `CampaignActionsContext`: A → held POST → header × → B с введёнными
  данными → late 201 A → B должен остаться. Старые семь real-chain cases сохранены;
  реальная палитра сама управляет открытием/закрытием, подмены её state нет.
- Baseline ещё не запускался; production lifetime guard и lint adaptation пока
  не внесены. Root сначала фиксирует воспроизведение, затем разрешает исправление.

### Lifetime fix — подготовлен после целевого baseline

- Root actual-Palette baseline дал 1 целевой FAIL (7 остальных cases не
  выбирались): после принятого A токена новый диалог B отсутствовал, общий
  error оставался пустым. Воспроизведение завершилось, не зависло.
- `TokenDefinitionEditor` теперь проверяет mounted ref своего экземпляра перед
  асинхронным `onCancel` и записью результата в локальные error/saving states.
  Новый `NEW`-редактор имеет другой ref; сравнение строкового state не используется.
  Header ×, Escape и обычная отмена остаются доступны; отправленная транзакция
  может завершиться, но завершение старой формы не закрывает новую.
- `App` и real-chain harness вызывают placement factory внутри event-time
  `useCallback`, а не во время render в `useMemo`; дополнительных lint suppressions
  нет. Исходный baseline oracle сохранён, добавлен поздний 403 после Escape A:
  B сохраняет ввод без чужой ошибки, его обычная отмена работает. Прежние проверки
  success/retry и session reset сохранены.
- Изменено в этом follow-up: `TokenPalette.tsx`, App placement callback,
  real-chain editor test и этот checkpoint. Restored tests и quality gate после
  lifetime fix ещё не запускались; root выполняет их после заморозки пула.

### Checkpoint — UIX-613 verified local candidate, 2026-09-08

- Decision: placement resolves an explicit accepted/failed/cancelled outcome;
  only create-and-place waits for it. The editor owns inline failure, and its
  per-instance mounted guard prevents late completion A from closing new B.
  Ordinary placements retain fire-and-forget behaviour; no protocol changes.
- Source base: `d68f8ed`; local candidate, not published. Changed files:
  App.tsx, optimistic-token-mutations.ts/tests, new optimistic-token-placement.ts,
  use-token-definition-actions.ts/DOM tests, TokenPalette.tsx, new real-chain
  TokenDefinitionEditor.optimistic.test.tsx, new token-create-place-outcome.spec.ts,
  and this plan. Separate UIX-611 upload intent must be integrated additively.
- Verification: restored connected suite 5 files / 42 PASS. Both actual source
  faults were detected: ignoring placement failure loses the rejected draft;
  removing the lifetime guard dismisses B on late accepted A. Original source
  bytes restored and retained test hashes unchanged; final 42 PASS after restore.
- Browser: six real-App cases PASS in Chrome/Firefox, retries zero: delayed403
  preserves name/character/derived TOKEN/2x3/controller, retry201 closes only
  after acceptance; header-close and Escape A followed by late201 preserve B.
  Acceptance observed through actual App snapshot/Undo label, not response-only.
  All six receipts have zero unexpected API operations and zero page errors.
  A first cold-Vite attempt had four timeouts before API bootstrap and two PASS;
  the unchanged suite then passed6/6 in53.6s without timeout/assertion changes.
- Boundaries: HTTP and image bytes are controlled, both socket transports
  isolated. No production mutation, WebP rendering, backend ACL/persistence,
  Safari or physical-device acceptance is inferred. Root inspected the actual
  Chrome retained-draft screenshot. Existing generator browser controls also passed 12/12 (Chrome/Firefox, GM/player, desktop/narrow);
  integrated build/type/lint/full-suite gate remains the next verification layer.
- Blockers/next: integrate this source-frozen candidate with UIX-611 and the
  current closure pool, run the combined gate, then authorized publication.
  This local checkpoint does not mark every parent acceptance criterion Done.
