# Компетенции для работы с Arken Space

Проект можно поддерживать небольшой full-stack командой, но canvas, realtime и
production recovery требуют разных специализаций. Не каждому разработчику нужно
знать всё: таблицы ниже показывают обязательную базу и зоны, где нужен профильный
reviewer.

## Общая база

| Навык                    | Зачем нужен                                       | Минимальный уровень                                           |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------- |
| TypeScript strict + ESM  | весь application code и scripts                   | уверенно читать generics/unions, не обходить типы через `any` |
| pnpm workspaces          | package graph, build order, local exports         | понимать filters, lockfile и необходимость build `dist`       |
| Zod и contract-first API | runtime validation между web/server               | менять schema и producer/consumer атомарно                    |
| Git/GitHub               | review, release identity, exact revision evidence | чистый diff, осмысленные commits, безопасная работа с secrets |
| VTT/RPG domain           | scene, token, layer, fog, character, dice         | понимать GM/PLAYER authority и visibility                     |
| Security mindset         | приватная кампания и персональные ссылки          | проверять authn, authz, tenant scope, secret/log boundaries   |
| Автоматические тесты     | изменения затрагивают несколько layers            | выбирать unit/integration/browser/full-stack уровень          |

## Матрица по областям

| Область               | Основные технологии                          | Нужные знания                                                                    | Когда обязателен профильный review                                   |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Web application       | React 19, Hooks, Gravity UI, Vite            | controlled forms, effects, optimistic state, error boundaries, accessibility     | изменение `App`, `Sidebar`, auth flow или conflict reconciliation    |
| Canvas                | Konva, react-konva, browser pointer APIs     | coordinate transforms, zoom/pan, hit testing, compositing, geometry, performance | fog/layers, drag/resize, grid/snap, bulk selection, keyboard access  |
| Realtime              | Socket.IO 4                                  | rooms, ack, ordering, reconnect/recovery, dedupe, backpressure                   | новый event/command, audience/visibility, resync behavior            |
| Backend/API           | Node.js, Fastify 5                           | lifecycle/plugins, cookies, multipart, CORS, rate limits, structured errors      | новый public endpoint, auth/access, uploads, server process behavior |
| Domain consistency    | action IDs, revisions, journals              | idempotency, optimistic concurrency, state machine, undo/redo                    | durable mutation, replay/retry, campaign clock/audio/history         |
| Database              | PostgreSQL 17, Drizzle                       | transactions, row locks, sequences, JSONB, FK/index design, migration safety     | schema/migration, tenant relation, destructive/data backfill change  |
| Media                 | Sharp, file-type, music-metadata, filesystem | magic bytes, image bombs, duration/ranges, quotas, cleanup                       | новый type/codec, upload/content visibility, storage layout          |
| QA                    | Vitest, PGlite, Playwright                   | fixtures, Fastify inject, Socket.IO clients, multi-context and recovery tests    | permissions, concurrency, multiplayer, migration/restore behavior    |
| Platform              | Docker/Compose, nginx, Linux/systemd         | TLS/WebSocket proxy, volumes, healthchecks, log limits, container hardening      | Dockerfile/Compose/nginx/host preparation                            |
| Recovery              | pg_dump/pg_restore, restic, S3               | consistent snapshot, checksums, RPO/RTO, isolated rehearsal, rollback            | backup/restore/reset, retention или production release               |
| Observability/privacy | structured logs, incident response           | request/action IDs, redaction, data minimization, retention                      | telemetry, diagnostics, feedback attachments, incident bundle        |

## Роли и ownership

Это не требование к штатной структуре, а удобное распределение ответственности.

### Product frontend

Отвечает за:

- `apps/web/src/App.tsx`, `Sidebar.tsx`, `ui/**`;
- Gravity UI, CSS, responsive desktop layouts и accessibility;
- REST error/conflict UX, local drafts и feedback;
- component/browser tests.

Должен понимать snapshot/event model, но не обязан самостоятельно проектировать
DB migration.

### Canvas/realtime engineer

Отвечает за:

- `renderers/**`, token placement, fog, drawings, ruler/pings;
- `SceneRendererProps` boundary;
- optimistic movement, event ordering, reconnect/resync;
- performance при длинной игровой сессии и семи клиентах.

Любое изменение visibility согласует с backend/security reviewer.

### Backend/domain engineer

Отвечает за:

- Fastify routes, Socket.IO handlers и snapshot projection;
- role/ownership/campaign checks;
- transactions, `actionId`, revisions, `game_events`, `action_journal`;
- dice, catalog, character, campaign clock и audio state machine.

Изменение wire contract делает совместно с web owner.

### Data/reliability engineer

Отвечает за:

- Drizzle schema/migrations/metadata;
- PostgreSQL behavior, indexes, locks и data integrity;
- backup/restore/reset manifests и rehearsal;
- Docker/nginx/systemd, monitoring и release gates.

Нужен для любого изменения таблиц или production storage.

### QA/release owner

Отвечает за:

- выбор test pyramid и regression scenarios;
- GM + 6 isolated story и human browser matrix;
- exact revision/build/schema evidence;
- GO/NO-GO отдельно от факта успешной сборки.

## Учебный маршрут нового разработчика

### 1. Контекст продукта — 30–60 минут

Прочитать:

1. `README.md`;
2. `docs/brief.md`;
3. `docs/architecture.md`;
4. `docs/architecture-decisions-2026-07-14.md`.

Результат: понимать MVP boundary, роли GM/PLAYER и почему 2D/single campaign —
осознанное текущее ограничение.

### 2. Общий контракт — 1–2 часа

Пройти по:

1. `packages/contracts/src/index.ts`;
2. `packages/system/src/index.ts`;
3. `packages/db/src/schema.ts`.

Результат: видеть domain vocabulary, wire DTO, revisions/action IDs и durable
relations до чтения transport/UI деталей.

### 3. Один вертикальный slice — 2–4 часа

Для первого прохода удобнее token movement:

```text
Orthographic2DRenderer
  → App callback
  → ClientToServerEvents["token:moved"]
  → registerRealtime
  → tokens + game_events + action_journal
  → ServerToClientEvents["token:moved"]
  → App reducer
  → realtime.test.ts / multiplayer game-session.spec.ts
```

После этого аналогично проследить один HTTP flow, например character counters или
scene activation.

### 4. Локальный gate — 30–90 минут

Выполнить setup из [development-guide.md](./development-guide.md), затем:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Результат: разработчик знает build order и умеет отличить pure test от PGlite,
mocked browser и full-stack Docker gate.

### 5. Production safety — до первого ops-изменения

Прочитать:

- `docs/operations.md`;
- `docs/production-release-checklist.md`;
- `scripts/run-restore-rehearsal.mjs`;
- `scripts/run-gameplay-reset-safe.mjs`.

Нельзя учиться backup/restore/reset впервые на production.

## Review checklist по типу изменения

### Любая mutation

- Кто имеет право выполнить её?
- Все связанные UUID принадлежат текущей campaign?
- Есть ли `actionId` и duplicate behavior?
- Есть ли revision/CAS и понятный conflict response?
- State, event и обязательный audit пишутся в одной transaction?
- Как state приходит другим клиентам и восстанавливается после reconnect?
- Не расширилась ли player projection?

### UI/canvas

- Есть ли loading/empty/error/conflict состояния?
- Работает ли GM и PLAYER projection?
- Не зависит ли correctness только от порядка incremental events?
- Есть ли keyboard/dialog alternative критическому pointer action?
- Проверены ли zoom, grid offset, map scale и long-session performance?
- Не появились ли unbounded listeners, timers или socket emissions?

### Schema/migration

- Forward migration работает на существующих данных?
- Schema, SQL и Drizzle metadata согласованы?
- Новая таблица входит в backup count manifest и restore allowlist?
- Reset/retention/privacy policy определены?
- PGlite test дополнен PostgreSQL/full-stack проверкой, где важна семантика DB?

### Auth/security/media

- Secret не попадает в URL после exchange, DB, logs или diagnostics?
- Cookie/origin/proxy assumptions явно сохранены?
- Payload валидируется до доступа к полям?
- MIME определяется по content, а не имени?
- Quota и partial-file cleanup работают при конкурентной ошибке?
- Content endpoint повторно проверяет visibility?

### Release/operations

- Checkout clean и совпадает с exact revision?
- Есть fresh backup и rehearsal именно этого build/schema?
- Проверен rollback, health и disk?
- Human GM+6 gate завершён, а GO/NO-GO записан отдельно?
- Команда не использует production target для e2e/rehearsal?

## Навыки, которых пока особенно не хватает архитектуре

Для следующего этапа проекта наиболее полезны:

1. Декомпозиция больших React/Fastify composition roots без потери end-to-end
   invariants.
2. Формализация REST response/error contracts и единая command semantics.
3. Realtime ordering/reconciliation и нагрузочное профилирование full snapshots.
4. PostgreSQL tenant integrity и migration metadata verification.
5. Threat modeling закрытой beta-аутентификации и переход на персональные
   secrets/identity provider.
6. Container hardening, metrics/alerts и автоматизированный CI gate.
7. Accessibility и cross-browser human testing сложного canvas UI.

Конкретные технические долги перечислены в
[codebase-audit.md](./codebase-audit.md).
