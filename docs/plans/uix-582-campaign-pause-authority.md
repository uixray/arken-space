# UIX-582 — сервер-авторитетное состояние перерыва

## Граница пула

UIX-582 реализует только durable основу UIX-511:

- состояние паузы кампании в PostgreSQL;
- строгую GM-only команду pause/resume;
- revision/CAS, actionId и безопасный повтор команды;
- проекцию состояния в `GameSnapshot` и realtime broadcast;
- проверку reload/reconnect, ролей и изоляции кампаний.

Canvas guards и гонка pause с Canvas mutation вынесены в UIX-583. Overlay,
GM control, клиентская блокировка и artwork вынесены в UIX-584. В этом пуле не
меняются `apps/web/src/App.tsx`, `apps/web/src/styles.css`,
`apps/web/src/sidebar/ChatPanels.tsx` и `apps/web/src/assets/`.

## Сначала замер

1. Сверить текущую схему `campaigns`, последнюю migration и требования журнала.
2. Выбрать существующий паттерн command hash + сохранённый response, а не слабый
   replay «любой event с таким actionId».
3. Проверить, как `buildSnapshot` восстанавливает campaign state для обеих ролей.
4. Добавить падающие тесты до production-кода.

## Доменное решение

- `campaigns.paused` — `boolean NOT NULL DEFAULT false`; старые кампании после
  additive migration продолжают игру без паузы.
- `POST /api/campaign/pause` принимает `{ actionId, revision, paused }`.
- Команда разрешена только GM и работает с кампанией из auth context; campaignId
  из клиента не принимается.
- Транзакция блокирует строку кампании, повторно проверяет receipt и revision,
  меняет `paused`, увеличивает campaign revision и сохраняет receipt с
  command hash и исходным response.
- Exact retry возвращает исходный response; повтор actionId с иным actor/type/
  payload возвращает `ACTION_ID_CONFLICT`.
- Повтор желаемого состояния новым actionId возвращает bounded state conflict,
  а не создаёт фиктивную ревизию.
- После commit выполняется campaign snapshot broadcast. Exact replay также
  повторяет безопасную рассылку: если первая рассылка упала уже после commit,
  повтор клиента восстанавливает подключённые сокеты. Сам event не содержит
  приватных или Canvas-данных.

## Проверки

### Focused

- contract parse: strict schema, paused true/false, revision/actionId;
- migration: default false, NOT NULL, upgrade существующей строки;
- route: GM pause/resume, auth/role до разбора тела, PLAYER 403, stale revision
  409, exact retry, changed payload/revision 409, wrapped unique race, no-op
  state conflict, одинаковый actionId в двух кампаниях;
- snapshot: GM и PLAYER получают persisted `paused`; новый snapshot после
  accepted command согласован для всех сокетов; replay восстанавливает
  рассылку после post-commit ошибки.

### Диверсия

В изолированной PGlite-базе временно повредить `commandHash` сохранённого
receipt и запустить только тест exact retry / changed intent. Ожидание: exact
retry получает 409 вместо 200, падает ровно этот тест, остальные пропущены;
после удаления тестовой мутации тот же тест снова зелёный. Production-код при
диверсии не ослабляется.

### Гейты

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm build`
5. `pnpm test`
6. `DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true`,
   `pnpm test:multiplayer` без конвейера вывода.

Изменение включает migration, persistence, realtime snapshot и reconnect,
поэтому multiplayer обязателен. Production deployment не входит в пул.

## Этапы

1. [x] **Измерение и тест-контракт** — план, schema/route/snapshot тесты
       красные.
2. [x] **Persistence и API** — migration metadata, contract, route, broadcast.
3. [x] **Проверка** — 97 focused tests, диверсия, два независимых review.
4. [ ] **Gate** — основной локальный набор уже зелёный; остаются exact-code
       isolated multiplayer, финальный checkpoint и перевод UIX-582 в In Review.
