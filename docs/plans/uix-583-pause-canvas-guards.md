# UIX-583 — серверные guards Canvas во время перерыва

## Граница пула

UIX-583 продолжает уже опубликованную серверную основу UIX-582 и закрывает
только серверную авторитетность перерыва:

- durable-мутации Canvas сериализуются с командой pause/resume и получают
  `CAMPAIGN_PAUSED`, если перерыв уже принят;
- эфемерные `token:moving`, линейка, пинги и курсоры не проходят во время
  перерыва и не могут доехать после очистки из-за гонки;
- при включении перерыва сервер убирает уже показанные линейки и курсоры, а
  snapshot возвращает токены к durable-положению;
- чат, броски, звук и чтение состояния остаются рабочими;
- одна кампания не влияет на другую.

Клиентский overlay и блокировка элементов управления относятся к UIX-584. В
этом пуле не меняются `apps/web/src/App.tsx`, `apps/web/src/styles.css`,
`apps/web/src/sidebar/ChatPanels.tsx` и `apps/web/src/assets/`.

## Сначала замер

На `origin/main@d789d97` подтверждены следующие точки записи.

### Durable HTTP и Socket.IO

Все перечисленные обработчики уже имеют транзакцию. Guard становится первым
действием внутри той же транзакции, до scene/definition/journal/target locks и
до любой записи:

- `POST /api/tokens`;
- `POST /api/token-definitions/:id/placements`;
- `PATCH /api/tokens/:id/size`;
- `PATCH /api/tokens/:id/appearance`;
- `PATCH /api/tokens/:id/conditions`;
- `PATCH /api/tokens/:id/layer`;
- `DELETE /api/tokens/:id`;
- `PATCH /api/token-definitions/:id`, потому что name/default asset/character
  меняют проекцию уже размещённых токенов;
- `DELETE /api/token-definitions/:id`, потому что FK cascade удаляет placements;
- `POST /api/fog-reveals`;
- `POST /api/drawings`;
- `PATCH /api/drawings/:id`;
- `POST /api/drawings/:id/copy`;
- `DELETE /api/drawings/:id`;
- `POST /api/canvas/bulk`;
- `POST /api/canvas/undo` и `POST /api/canvas/redo`;
- `POST /api/scenes/activate`;
- `PATCH /api/scenes/:id` при смене map/background-проекции;
- `PATCH /api/scenes/:id/canvas`;
- `POST /api/encounters/start` в режиме `LINKED_SCENE`, потому что он меняет
  active scene и переносит PLAYER-токены между сценами;
- Socket.IO `token:moved`.

`DELETE /api/fog-reveals/latest` уже retired и отвечает `410`, поэтому новой
мутации там нет. Создание offscreen scene/определения токена без placement,
управление контроллерами, архивная материализация имени, чат, броски и звук не
являются видимой Canvas-мутацией этого пула и не получают лишний запрет.

### Эфемерный realtime

Под guard попадают:

- `token:moving`;
- `ruler:update` и `ruler:clear`;
- `map:ping`;
- `cursor:move` и клиентский `cursor:gone`.

Простого `SELECT paused` перед `emit` недостаточно: пауза может зафиксироваться
между чтением и рассылкой. Relay должен держать совместимую блокировку строки
кампании до самого `emit`.

## Доменное решение

### Единый порядок блокировок

1. campaign row;
2. scene row;
3. definition/journal/target rows.

Команда pause/resume и durable Canvas-команда берут campaign row `FOR UPDATE`.
Если мутация вошла первой, она заканчивается до принятия перерыва. Если первой
вошла пауза, следующая мутация просыпается уже на `paused=true` и ничего не
пишет. Так не существует commit Canvas после принятой паузы.

Эфемерный relay берёт campaign row `FOR SHARE` в короткой read-транзакции и
делает проверку, необходимые campaign-scoped чтения и `emit` до освобождения
lock. Pause `FOR UPDATE` либо ждёт завершения старого relay и затем выполняет
очистку, либо relay ждёт pause и молча отклоняется.

### Общий primitive и ошибки

- Общий helper открывает транзакцию, первым действием блокирует campaign row и
  только затем вызывает callback на том же `tx`.
- HTTP-мутация получает `409 { error: "CAMPAIGN_PAUSED" }`.
- `token:moved` получает bounded ack
  `{ ok: false, status: "CONFLICT", reason: "CAMPAIGN_PAUSED" }`.
- Эфемерные события без ack молча не рассылаются; `map:ping` отвечает
  `{ ok: false, reason: "CAMPAIGN_PAUSED" }`.
- Отсутствующая кампания обрабатывается fail-closed и не превращается в запись.

Exact replay, который только возвращает уже сохранённый ответ, может быть
доступен во время перерыва. Любая классификация, способная создать event или
journal row, повторяется уже под campaign lock.

### Очистка при pause

После записи `paused=true`, но до commit той же транзакции, сервер:

- рассылает `ruler:cleared` для campaign-scoped сцен и участников;
- рассылает `cursor:gone` для участников в campaign и GM-аудиторию;
- затем пересобирает snapshots, что убирает незавершённый token preview.

Очистка не хранит новые durable данные, не раскрывает приватные координаты и не
выходит за rooms текущей кампании.

## Проверки

### Focused

- структурный inventory фиксирует весь список durable handlers и запрещает
  новую Canvas-транзакцию без общего helper;
- HTTP: каждый класс token/drawing/fog/bulk/history/scene canvas получает 409,
  target/event/journal остаются без изменений;
- realtime: durable `token:moved` получает bounded ack, эфемерные события не
  доходят, pause очищает уже видимые ruler/cursor;
- отрицательные контроли: GM и PLAYER продолжают писать в чат и бросать кости;
  звук не блокируется;
- foreign campaign одновременно сохраняет право на Canvas и не получает чужую
  очистку.

### Детерминированная гонка PostgreSQL

1. Tx pause удерживает campaign `FOR UPDATE`; параллельная Canvas-команда ждёт,
   после commit паузы получает `CAMPAIGN_PAUSED`, а Canvas/event/journal diff
   пуст.
2. Tx mutation удерживает тот же lock; pause ждёт, мутация фиксируется первой,
   затем фиксируется пауза. Проверка доказывает, что после authoritative pause
   нет более поздней Canvas-записи.
3. Аналогичный барьер для `FOR SHARE` доказывает, что relay не может приехать
   после pause cleanup.

### Диверсия

Временно убрать вызов guard из одного репрезентативного durable handler
(`POST /api/drawings`) и запустить только его focused-тест. Ожидание: падает
ровно проверка `CAMPAIGN_PAUSED`/отсутствия записи, а не весь набор. После
восстановления production-кода тот же тест зелёный. Результат записывается в
тело коммита и PR.

### Гейты

Последовательно, без параллельной тяжёлой нагрузки:

1. focused Vitest с `--maxWorkers=1`;
2. `pnpm format:check`;
3. `pnpm lint`;
4. `pnpm typecheck`;
5. `pnpm build`;
6. `pnpm test`;
7. isolated `pnpm test:multiplayer` без конвейера вывода и с проверкой точного
   exit code.

UI-поток UIX-584 не входит в этот пул, поэтому новый Playwright E2E здесь не
заменяет серверные integration/multiplayer доказательства. Docker запускается
только для финального multiplayer-гейта; до него тесты идут одним worker.

## Этапы

1. [x] **Измерение** — поверхность durable/ephemeral и lock order зафиксированы.
2. [x] **Guard primitive** — единые update/share wrappers и bounded ошибки.
3. [x] **Интеграция** — HTTP, Socket.IO и campaign-scoped cleanup.
4. [x] **Доказательство** — focused, гонки, отрицательные контроли и диверсия.
5. [ ] **Gate** — полный локальный набор и isolated multiplayer.

## Чекпоинт реализации

- Cleanup линейки и курсора выполняется внутри pause-транзакции под campaign
  `FOR UPDATE`; replay старого receipt не повторяет transition-side cleanup.
- Post-commit snapshot повторно сверяет `paused + revision` под эксклюзивной
  блокировкой и не рассылает историческое состояние после более новой команды.
- Disconnect и завершившийся после disconnect async relay не оставляют
  недоступную для будущей очистки эфемеру.
- Оба режима запуска encounter берут campaign lock до уникального ACTIVE slot,
  чтобы LINKED_SCENE и SCENE_REGION не образовали взаимную блокировку.
- Диверсия `POST /api/drawings`: без guard целевой тест дал `201` вместо `409`;
  после восстановления тот же тест зелёный.
- Focused после adversarial fixes: 6 файлов, 124 теста — passed одним worker;
  серверный typecheck и формат изменённых файлов — passed.
