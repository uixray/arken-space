# UIX-413 — checkpoint изоляции кампаний

Дата: **31 августа 2026 года**.

## Пул 1 — runtime-инвентарь и структурный контракт

- **Ревизия:** baseline `a48de5d`, ветка
  `codex/uix-413-campaign-isolation`; локальный commit ещё не создан.
- **Решение:** собирать маршруты через Fastify `onRoute`; считать ID-параметром
  `:id` и `:*Id`; удалять только автоматически производный `HEAD` при наличии
  соответствующего `GET`.
- **Замер:** 99 сырых dynamic method/path, 15 из них auto-HEAD; после
  нормализации 84 маршрута. Публичный `POST /api/auth/player/:handle` не является
  ID-маршрутом. Оставшиеся 83 классифицированы как 68 `CAMPAIGN`, 11
  `WORLD_CONTENT_CANON`, 4 `OPERATOR_FEEDBACK`.
- **Изменённые файлы:**
  `tests/helpers/campaign-isolation-routes.ts`,
  `tests/campaign-isolation-routes.test.ts`,
  `docs/plans/uix-413-campaign-isolation.md`, этот checkpoint.
- **Проверка:** focused structural suite — 5/5 PASS; Prettier, ESLint и strict
  TypeScript для structural файлов — PASS. Отдельный async Fastify plugin после
  `app.ready()` попадает в инвентарь и даёт точный `UNLISTED_ID_ROUTE`.
- **Диверсия:** временный `GET /api/__uix413_diversion/:id` уронил только exact
  inventory case с
  `UNLISTED_ID_ROUTE: GET /api/__uix413_diversion/:id`; после восстановления
  suite снова 3/3 PASS.
- **Блокеры:** нет.
- **Следующее действие:** механически связать 56 путей с точным сегментом `:id`
  с исполняемыми двухкампанейными probes и прогнать behavioral matrix.

## Пул 2 — двухкампанейная behavioral matrix

- **Решение:** разделить probes по центральному router и sub-router, но
  механически сравнивать их общий набор со структурным реестром.
- **Изменённые файлы:**
  `tests/campaign-isolation-core.integration.test.ts`,
  `tests/campaign-isolation-subrouters.integration.test.ts`,
  `tests/helpers/uix413-core.ts`, `tests/helpers/uix413-subrouters.ts`.
- **Покрытие:** 56/56 campaign-маршрутов с точным сегментом `:id`: 36 core и
  20 sub-router. Используются реальные PGlite/Fastify, две кампании, валидные
  роли/payload, точные `403/404` и error code; мутации сверяются широким
  fingerprint БД/media. Multi-ID world-map link/unlink проверяют оба ID.
- **Проверка:** общий focused run — 3 файла / 68 тестов PASS; отдельно sub-router
  — 20/20 PASS, structural — 5/5 PASS, core после review — 43/43 PASS.
- **Mixed-ID защита:** catalog assignment и sticker entitlements проверены в
  обе стороны; player-pack consent имеет валидный Player A control, а составной
  FK отдельно доказан красным `23503` для cross-campaign subject membership.
- **Диверсия:** снятие `campaignId` predicate у `PATCH /api/scenes/:id` дало
  ровно 1 failure / 37 pass: scene probe получил `200` и реально изменённую
  foreign scene вместо ожидаемого `404`. Predicate восстановлен, повторный core
  run — 38/38 PASS.
- **Блокеры:** нет.
- **Следующее действие:** зафиксировать и проверить единственный найденный
  replay-пробел, затем пройти общий quality/multiplayer gate.

## Пул 3 — подтверждённое серверное исправление

- **Замер до правки:** специально засеянный `game_event` кампании A ссылался на
  token кампании B. Duplicate-action replay для
  `POST /api/token-definitions/:id/placements` загрузил `tokens.id` без tenant
  join и вернул полную foreign placement с `200`; targeted suite — 37/38.
- **Решение:** replay-token загружается только при одновременном совпадении
  `token.id`, path `definitionId`, `scenes.campaignId` и
  `token_definitions.campaignId`. Если path definition не принадлежит текущей
  кампании, replay отвечает тем же
  `404 TOKEN_DEFINITION_NOT_FOUND`, что и свежий запрос.
- **Изменённый production-файл:** `apps/server/src/routes.ts`.
- **Проверка после правки:** targeted core — 43/43 PASS; общая UIX-413 матрица —
  68/68 PASS. Дополнительные replay-регрессии покрывают own-definition URL и
  DB-допустимый hybrid token: own scene + foreign definition.
- **Блокеры:** Docker gate ещё не запускался.
- **Следующее действие:** docs, format/lint/typecheck/build/test, затем
  изолированный `test:multiplayer` через уже доступный daemon, не запуская другой
  Docker Desktop вручную.

## Пул 4 — review и локальные гейты

- **Review:** независимая повторная проверка закрыла найденные P1/P2: mixed-ID
  cases, consent/composite FK, replay hybrid, async plugin inventory, explicit
  HEAD и TTL fixture. Новых code/test P0–P2 после исправлений не найдено.
- **Основной gate:** последовательность
  `format:check → lint → typecheck → build → test` завершилась с exit code 0;
  Vitest — **185 файлов / 1423 теста PASS**. Lint сохранил три существующих
  warning в `App.tsx` и `player-request-chat.tsx`, ошибок нет.
- **Focused:** UIX-413 — **68/68 PASS**; позитивный replay placement — **2/2
  PASS**.
- **Docker preflight:** использован уже работающий context `desktop-linux`
  (`docker-desktop` 29.7.2); Docker Desktop вручную не запускался. Старых
  `arken-e2e` ресурсов и listener на `14180` до прогона не было.
- **Предварительный multiplayer:** GM + 6 и shared-browser handoff — **2/2
  PASS**; backend restart, resource-leak check, удаление containers/volumes/images
  и production health before/after — PASS. Production build revision до и после
  не изменился; deploy не выполнялся.
- **Identity-attested multiplayer:** основной код зафиксирован commit
  `85a910402961510b347f337b0ef1831ca9985599`; повторный isolated health вернул
  именно этот build revision. GM + 6 и shared-browser handoff снова прошли 2/2,
  backend restart, cleanup и resource-leak check — PASS, exit code 0. Production
  revision до/после осталась `42c7ccc`; deploy не выполнялся.
- **Оставшиеся gates:** локальных issue-level гейтов нет. Push, PR, merge и
  production deploy остаются только решением владельца; UI E2E не запускался,
  потому что UI-поток не менялся.
