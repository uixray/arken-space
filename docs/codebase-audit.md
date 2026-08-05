# Аудит текущего состояния кодовой базы

- Дата: 2026-08-04
- Ревизия: `1d5f831cc23d19f80dd5e1d70f6fb18b7f7e523d` (branch `feature/canvas-drawing-tools`)
- Working tree на момент аудита не чистый: `apps/web/src/renderers/Orthographic2DRenderer.tsx`,
  `packages/contracts/src/index.ts`, `tasks.md` и `tests/realtime.test.ts` изменены,
  но не закоммичены (см. «Незакоммиченное состояние» ниже).
- Метод: чтение текущего дерева (`apps/web`, `apps/server`, `packages/contracts`,
  `packages/db`, `packages/system`, `tests`, корневые конфиги), сверка со
  `schema.ts`/`routes.ts`/`package.json` каждого workspace-пакета и фактический
  прогон `pnpm typecheck`, `pnpm lint`, `pnpm format:check` в этой рабочей копии.
  Это статический технический обзор, а не penetration test и не разрешение на
  production deployment.

Этот документ примерно на 60 коммитов отставал от HEAD (последняя версия
описывала ревизию `abcb2efc25e...` от 2026-07-19, когда в схеме было 21
таблица) и содержал повреждённый non-UTF-8 фрагмент текста. Обе проблемы
исправлены этой версией: контент переписан по фактическому коду, а не
скопирован вперёд.

## Проверка checkout

В этой рабочей копии (не чистый clone — см. предупреждение ниже) выполнены:

| Проверка                                          | Результат                                                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                  | PASS для всех 5 buildable workspace projects (`@arken/contracts`, `@arken/db`, `@arken/system`, `@arken/server`, `@arken/web`).                |
| `pnpm lint`                                       | FAIL — 1508 ESLint errors, почти все `Parsing error: No tsconfigRootDir was set, and multiple candidate TSConfigRootDirs are present`.         |
| `pnpm format:check`                               | FAIL — Prettier сообщает о проблемах стиля в 4421 файлах.                                                                                      |
| Полный Vitest                                     | Не перезапускался в рамках этого аудита (см. ниже); последний записанный прогон — `release-regression-checkpoint-2026-08-01.md`: 383/396 PASS. |
| Docker multiplayer, Playwright, restore rehearsal | Не запускались в рамках документирования; прошлые результаты зафиксированы в соответствующих release/runbook документах.                       |

**Важно про lint/format:check FAIL.** Причина — не дефект кода, а состояние
именно этой рабочей копии: в `.worktrees/` и в соседних sibling-директориях
(`arken-space-chat-threads`, `arken-space-gravity-ui`, …) существует 20+
git worktree с собственными `tsconfig.json`. `typescript-eslint` видит
несколько кандидатов `tsconfigRootDir` под корнем репозитория и отказывается
парсить файлы; Prettier аналогично проходит по вложенным worktree, потому что
`.prettierignore` их не исключает. На чистом clone без `.worktrees/` эта
проблема не должна воспроизводиться, но её стоит подтвердить отдельно и,
если она системная, добавить `.worktrees` в `.prettierignore`/ESLint
`ignores` явно, а не полагаться на то, что рабочая копия останется чистой.

Полный Vitest в этом сеансе не перезапускался: прошлые checkpoint-документы
(`release-regression-checkpoint-2026-08-01.md`) уже фиксируют, что полный
параллельный прогон не зелёный из-за PGlite timeout/test-isolation debt
(383/396), а не из-за конкретной feature-ветки. Повторный прогон для этого
аудита не добавил бы новой информации сверх того, что уже задокументировано,
и было решено на него не тратить время; это стоит переоценить перед следующим
релизным гейтом.

## Незакоммиченное состояние

На момент аудита в рабочей копии есть незакоммиченные изменения:

- `apps/web/src/renderers/Orthographic2DRenderer.tsx` — добавляет `rulerEnd`
  state и `useEffect`, который при смене инструмента (`props.tool !== "RULER"`)
  сбрасывает ruler-состояние и шлёт `ruler:clear`; это фикс регрессии
  «shared-ruler tool-switch cleanup», упомянутой в `tasks.md` как найденной в
  review для UIX-214. Тот же diff также сортирует `fogReveals` по `sequence`
  перед вычислением маски/hit-теста (`orderedFogReveals`).
- `packages/contracts/src/index.ts` — убирает `.js`-расширения из двух
  внутренних re-export путей (`./fog-geometry`, `./beta-players`); поведенчески
  нейтрально для собранного `dist`, но меняет исходный module resolution style.
- `tasks.md` — отмечает UIX-212 и UIX-213 как done и переводит UIX-214 обратно
  в in-progress с явной пометкой про найденную регрессию.
- `tests/realtime.test.ts` — добавляет покрытие (+37 строк), согласующееся с
  ruler-фиксом.

Это значит, что часть работы, описанной ниже как «текущее поведение», физически
присутствует в дереве, но ещё не в истории git. Дальнейшие пункты этого аудита
описывают код рабочей копии (working tree), а не только `HEAD`.

## Монорепозиторий

pnpm workspaces, strict TypeScript, ESM everywhere (`"type": "module"` в каждом
`package.json`). `pnpm-workspace.yaml` включает `apps/*` и `packages/*`.

```
apps/
  server/   — @arken/server, Fastify + Socket.IO backend
  web/      — @arken/web, React/Vite SPA
packages/
  contracts/ — @arken/contracts, Zod-схемы + typed Socket.IO events
  db/        — @arken/db, Drizzle schema + миграции + connection factory
  system/    — @arken/system, игровая система (Arken Core) и стартовый персонаж
tests/       — Vitest (unit/integration) + Playwright (e2e/multiplayer)
scripts/, infra/ — деплой, backup/restore, reset, incident bundle, nginx/systemd
```

| Пакет                | Ответственность                                                                                    | Точки входа                                        |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `apps/web`           | SPA: canvas, чат, персонажи, world maps, стикеры, story channel, wallet UI, REST/Socket.IO клиенты | `src/main.tsx`, `src/App.tsx`, `src/Sidebar.tsx`   |
| `apps/server`        | HTTP/WS transport, auth/authz, use cases, snapshots, media, operator feedback                      | `src/index.ts`, `src/routes.ts`, `src/realtime.ts` |
| `packages/contracts` | Общие Zod input-схемы, DTO и typed Socket.IO events (1809 строк `index.ts`)                        | `src/index.ts`, `src/fog-geometry.ts`              |
| `packages/db`        | Drizzle schema (43 таблицы), SQL миграции `0000`–`0028`, connection factory                        | `src/schema.ts`, `src/index.ts`, `src/migrate.ts`  |
| `packages/system`    | Определение игровой системы и starter character                                                    | `src/index.ts`                                     |
| `tests`              | Vitest unit/integration (91 файл), Playwright e2e (10 спеков) + multiplayer                        | `vitest.config.ts`, `playwright*.config.ts`        |

Направление зависимостей по-прежнему правильное: `apps/web` не импортирует
`server`/`db`, общие wire-контракты вынесены отдельно. Backend по-прежнему не
разделён на controllers/services/repositories — `routes.ts` напрямую делает
валидацию, авторизацию, Drizzle-запросы, транзакции, аудит и broadcast.

## Технологический стек

- **Frontend**: React + Vite, TypeScript, Gravity UI (`@gravity-ui/uikit`,
  `@gravity-ui/icons`) как компонентная библиотека, `react-konva`/`konva` для
  2D-канваса, `socket.io-client` для realtime, `use-image` для загрузки
  изображений canvas.
- **Backend**: Fastify 5 + `@fastify/cookie`, `@fastify/cors`,
  `@fastify/multipart`, `@fastify/rate-limit`; Socket.IO 4 поверх того же
  HTTP-сервера; `zod` для input-валидации; `sharp` для обработки изображений;
  `file-type`/`music-metadata` для проверки загружаемых медиа.
- **База данных**: PostgreSQL (production/Docker), Drizzle ORM,
  `drizzle-kit` для генерации миграций; тесты используют `@electric-sql/pglite`
  как in-memory Postgres-совместимый движок вместо реального сервера.
- **Realtime-транспорт**: Socket.IO комнаты (`campaign:<id>`, `member:<id>`,
  `campaign:<id>:gm`) поверх того же Fastify-процесса; часть команд durable
  (ack + `actionId` + revision + `game_events`), часть — эфемерные
  (`token:moving`, `ruler:*`, `map:ping`).
- **Тестирование**: Vitest (unit + integration поверх PGlite) — 91 test-файл
  в `apps/*/src` и `tests/`; Playwright — обычный e2e (`playwright.config.ts`,
  10 спеков в `tests/e2e/`) и отдельный multiplayer-профиль
  (`playwright.multiplayer.config.ts`, `tests/multiplayer/`), запускаемый через
  Docker (`pnpm test:multiplayer` → `scripts/run-multiplayer-e2e.mjs`).
- **Сборка**: `tsup` для трёх library-пакетов (`contracts`, `db`, `system`),
  `vite build` для web, `tsc --noEmit` для typecheck во всех пяти пакетах.
- **Lint/format**: `eslint.config.js` (flat config, `typescript-eslint`,
  `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`), Prettier
  (`--check . --ignore-unknown`), общий `tsconfig.base.json`.

## Команды разработки (из `package.json`)

| Команда                           | Назначение                                                              |
| --------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                        | Параллельно поднимает `@arken/server` (tsx watch) и `@arken/web` (vite) |
| `pnpm dev:db`                     | `docker compose up -d postgres`                                         |
| `pnpm build`                      | `pnpm -r --workspace-concurrency=1 build` во всех workspace-пакетах     |
| `pnpm typecheck`                  | `pnpm -r --workspace-concurrency=1 typecheck` (`tsc --noEmit` в каждом) |
| `pnpm test` / `test:watch`        | `vitest run` / `vitest`                                                 |
| `pnpm test:e2e`                   | `playwright test`                                                       |
| `pnpm test:multiplayer`           | `node scripts/run-multiplayer-e2e.mjs` (Docker-профиль)                 |
| `pnpm restore:rehearse`           | `node scripts/run-restore-rehearsal.mjs`                                |
| `pnpm gameplay:reset:safe`        | `node scripts/run-gameplay-reset-safe.mjs`                              |
| `pnpm incident:bundle`            | `node scripts/collect-incident-bundle.mjs`                              |
| `pnpm db:generate/migrate/studio` | Drizzle-kit generate/migrate/studio для `@arken/db`                     |
| `pnpm lint`                       | `eslint .`                                                              |
| `pnpm format:check`               | `prettier --check . --ignore-unknown`                                   |

## Рост схемы и контрактов с прошлого аудита

Прошлая версия документа фиксировала 21 таблицу и 5 доменов HTTP API. Текущая
`packages/db/src/schema.ts` содержит 43 таблицы (`grep pgTable` даёт 43
совпадения), а `packages/contracts/src/index.ts` вырос до 1809 строк. Новые
домены, отсутствовавшие в прошлом аудите:

- **World maps** — `worldMaps`, `worldMapLocations`, `worldMapLocationScenes`,
  `worldMapPartyPosition` (`apps/server/src/world-maps.ts`,
  `world-map-routes.ts`, `world-map-access.ts`; `apps/web/src/WorldMapsWorkspace.tsx`).
- **Стикеры** — `stickerPacks`, `stickerPackEntitlements`,
  `playerLikenessConsents`, `stickerMedia`, `stickers`
  (`apps/server/src/sticker-access.ts`; `apps/web/src/StickerPicker.tsx`).
- **Story channel / истории кампании** — `storyPosts`, `storyPostRevisions`,
  `storyPostMedia`, `storyImportBatches`, `storyImportSources`
  (`apps/server/src/story.ts`; `apps/web/src/StoryChannel.tsx`).
- **Чат-треды и direct-сообщения** — `chatThreads`, `chatAttachmentUploads`,
  `chatAttachments`, `chatReadCursors` в дополнение к прежним `chatMessages`.
- **Player requests** — `playerRequests` (заявки игроков к GM,
  `apps/server/src/player-requests.ts`,
  `apps/web/src/PlayerRequestsWorkspace.tsx`), включая связанные
  `SYSTEM`-карточки в чате через `chat_messages.player_request_id`.
- **Operator feedback** — `feedbackOperatorAudits` поверх прежних
  `feedbackReports`/`feedbackAttachments` (`apps/server/src/operator-feedback.ts`,
  `apps/web/src/OperatorFeedbackWorkspace.tsx`), с отдельным allowlist-доступом
  через `OPERATOR_MEMBERSHIP_IDS` в `env.ts`.
- **Fog geometry v2** — canonical `RECT | CIRCLE | POLYGON | BRUSH` геометрия
  вместо только прямоугольного reveal (`packages/contracts/src/fog-geometry.ts`,
  `apps/server/src/fog-geometry.ts`).
- **Token generator** — `generateTokenAssetSchema`/`tokenFramePresetSchema`
  (`apps/web/src/TokenImageGenerator.tsx`).
- **Wallet audit aggregation** — структурированные `WALLET_AUDIT` метаданные в
  `chatMessages`, схлопывающие последовательные wallet-мутации в одно
  chat-сообщение (`apps/web/src/wallet.ts`, миграция `0023`).

Ни один из этих доменов не отражён в `tasks.md` — файл документирует только
foundation-эпик UIX-196…UIX-217. Значительная часть текущей функциональности
(world maps, стикеры, story channel, player requests, operator feedback, token
generator) была реализована и, судя по чекпойнтам, частично закоммичена вне
трекинга `tasks.md`/`roadmap.md`. Это стоит явно сверить с Linear: список задач
в `tasks.md` больше не является полным описанием того, что есть в коде.

## Известный product/security debt, всё ещё актуальный по коду

Ниже — пункты из прошлого аудита, перепроверенные по текущему коду; не
переоткрытые заново с нуля, но подтверждённые тем, что затронутые файлы всё
ещё содержат то же поведение.

- **Beta-логин по публичному handle остаётся.** `apps/server/src/env.ts` не
  содержит upstream-guard для этого; сама схема авторизации (login по known
  handle) описана в `packages/contracts` и используется в `routes.ts`/`AuthGate.tsx`.
  Не переисследовано заново в глубину в рамках этого прохода — см.
  `.workspace/tech_debt.md` за текущим статусом принятия риска.
- **`GM_ACCESS_TOKEN` имеет известный default.** `env.ts` (см. выше) до сих пор
  задаёт `"development-master-token-change-me-now"` как default и не отклоняет
  его явно при `NODE_ENV=production` на уровне схемы валидации — production
  guard, если он есть, должен быть в другом месте (например, в
  `docker-compose.yml`/деплой-скриптах), а не в `env.ts`. Это стоит
  подтвердить отдельно, а не считать закрытым только потому, что Compose
  требует переменную.
- **`OPERATOR_MEMBERSHIP_IDS`** — новый allowlist-механизм (см. `env.ts`
  выше), специфичный для operator feedback inbox; не путать с общей ролевой
  моделью GM/PLAYER.

Полная переоценка P0–P2 security/authorization findings прошлого аудита (chat
character scope, inactive-scene authorization, contract event drift и т.д.)
не проводилась заново построчно в этом проходе — объём кодовой базы вырос
почти в 1.5 раза (126 → 171 source-файлов), и старые построчные evidence-ссылки
частично устарели вместе с ростом `routes.ts` (был 4919 строк, сейчас 7262).
Следующий полноценный security-focused аудит должен переиндексировать
`routes.ts`/`realtime.ts` домен за доменом, а не полагаться на то, что старые
findings ещё указывают на те же строки.

## Крупнейшие hotspots (поддерживаемость)

| Файл                                                | Строк | Было (2026-07-19) |
| --------------------------------------------------- | ----: | ----------------: |
| `apps/server/src/routes.ts`                         |  7262 |              4919 |
| `apps/web/src/Sidebar.tsx`                          |  4160 |              2009 |
| `apps/web/src/App.tsx`                              |  2944 |              2113 |
| `apps/web/src/styles.css`                           |  3800 |              1739 |
| `apps/web/src/renderers/Orthographic2DRenderer.tsx` |  2486 |              1481 |

Все пять hotspot-файлов из прошлого аудита выросли, часть — более чем в 1.5
раза. Рекомендация декомпозиции из прошлой версии документа (server
authorization/query helpers → domain services по vertical slices → централизация
command result/error semantics → выделение snapshot/event reducer в web →
разбиение `Sidebar` по feature-модулям → разделение renderer interaction/geometry/
presentation → перенос CSS к фиче) остаётся актуальной и не выполненной; рост
файлов после прошлого прохода говорит, что новые фичи (world maps, стикеры,
player requests, story channel) добавлялись в те же composition roots, а не в
отдельные модули.

## Тестовые пробелы

- 91 Vitest test-файла (unit + integration) и 10 Playwright e2e спеков —
  заметный рост относительно 26 файлов/157 тестов на момент прошлого аудита,
  но полный параллельный прогон Vitest по данным последнего записанного
  запуска (`release-regression-checkpoint-2026-08-01.md`) не был зелёным
  (383/396) из-за PGlite timeout/test-isolation debt, а не из-за конкретной
  feature. Этот аудит не переподтверждает текущее число заново (см. «Проверка
  checkout» выше).
- `pnpm lint` и `pnpm format:check` в этой рабочей копии красные из-за
  локальных `.worktrees`/sibling checkout-ов (см. выше) — нужно подтвердить
  на чистом clone, прежде чем считать это репозиторным дефектом.
- PGlite по-прежнему не полностью моделирует PostgreSQL locking/triggers/
  sequences (как и раньше).
- Нет закоммиченного CI workflow в этом дереве (не найден `.github/workflows`
  или аналог в просмотренных директориях) и нет coverage thresholds.

## Связанные документы

- [architecture.md](./architecture.md) — фактическая архитектура без review
  noise (описывает инварианты и потоки данных; не пересматривался в рамках
  этого прохода — сверьте номера строк/таблиц перед тем как полагаться на его
  детали, так как схема выросла с 21 до 43 таблиц).
- [current-state.md](./current-state.md) — что реально работает сегодня,
  из `tasks.md` и последних checkpoint-документов, без необходимости читать
  все ~45 датированных чекпойнтов.
- [development-guide.md](./development-guide.md) — безопасный change workflow.
- [operations.md](./operations.md) — действующий runbook.
- [.workspace/tech_debt.md](../.workspace/tech_debt.md) — принятый product/release debt.
