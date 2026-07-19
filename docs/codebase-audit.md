# Аудит текущего состояния кодовой базы

- Дата: 2026-07-19
- Ревизия: `abcb2efc25e8e9664fdf2becd66b9645e22f82ae`
- Метод: structural index всех 126 исходных файлов, затем file-by-file чтение web,
  server, contracts/system/db, migrations, tests, scripts, infra и tracked root
  configs. Это статический технический обзор, а не penetration test и не
  разрешение на production deployment.

## Проверка checkout

На чистом clone после `pnpm install --frozen-lockfile` выполнены:

| Проверка                               | Результат                                                    |
| -------------------------------------- | ------------------------------------------------------------ |
| `pnpm lint`                            | PASS                                                         |
| `pnpm typecheck`                       | PASS, все 5 workspace projects                               |
| `pnpm build`                           | PASS; Vite предупреждает о main chunk 763.81 kB после minify |
| полный Vitest                          | PASS, 26/26 файлов и 157/157 tests                           |
| Prettier для README и новых документов | PASS                                                         |
| local Markdown links                   | PASS                                                         |
| `git diff --check`                     | PASS                                                         |

В restricted sandbox `tests/realtime.test.ts` не может открыть временный
`127.0.0.1` listener (`EPERM`); вне этого ограничения полный suite проходит за
22.31 s. Оставшиеся 25 suites отдельно прошли в sandbox: 141/141 tests.

Repository-wide `pnpm format:check` имеет существующий baseline из пяти файлов:
`apps/web/src/token-placement.test.ts` и четыре исторических checkpoint-документа
`uix-225`, `uix-226`, `uix-227-uix-231`, `uix-230`. Новые документы отформатированы;
baseline-файлы в рамках этого обзора не менялись.

Docker multiplayer, Playwright и restore rehearsal в рамках документирования не
запускались. Их прошлые результаты и release constraints остаются теми, что
зафиксированы в существующих release/runbook документах.

## Резюме

Проект имеет сильную production-oriented основу для закрытого single-instance
MVP: server-authoritative mutations, role-filtered snapshots, hashed secrets,
optimistic revisions, idempotency, durable canvas history, реальные integration
и GM+6 recovery tests, guarded backup/restore/reset workflows.

Главный риск не в отсутствии базовой архитектуры, а в накопившемся drift между
её частями. Особенно важны пять направлений:

1. временный beta login по публичному handle;
2. application-level authorization/tenant инварианты, применённые неодинаково;
3. рассогласованные Drizzle metadata и backup table manifests;
4. крупные frontend/backend composition roots и гибридная event/snapshot модель;
5. release evidence, monitoring/CI и human cross-browser gate ещё не завершены.

Ниже findings отделены от уже документированного product debt. Перед исправлением
каждый новый static finding следует закрепить минимальным regression test или
reproduction.

## Что сделано хорошо

- Session/access secrets случайны, хранятся как hashes; cookie `HttpOnly`,
  `SameSite=Strict`, а в production также `Secure`.
- Для unsafe HTTP requests сервер отклоняет присутствующий `Origin`, если он не
  равен `WEB_ORIGIN`; отсутствие `Origin` сейчас допускается. CORS ограничен
  одним frontend origin.
- Player snapshot фильтруется server-side; GM-layer tokens не должны доходить до
  игрока.
- Durable commands используют UUID `actionId`, DB uniqueness и entity revisions.
- Сложные mutations объединяют state, events, journal и audit chat в transactions.
- Dice parser не исполняет произвольные expressions; dice RNG вызывается на
  сервере.
- Upload pipeline проверяет content type, размеры/длительность и безопасный путь;
  image content конвертируется.
- Integration tests используют реальные Fastify/Socket.IO flows и SQL migrations
  над PGlite; отдельный Docker story использует PostgreSQL 17 и семь клиентов.
- Restore rehearsal изолирован namespace/volumes/ports guards, а gameplay reset
  требует backup, rehearsal, exact evidence и явное подтверждение.
- Incident bundle bounded и redacted; application logs ограничены по размеру.

## Приоритет 0: release/security blockers

### Публичный beta handle является аутентификацией

`POST /api/auth/player/:handle` выдаёт session только по известному handle, а
список handles включён в общий frontend package. Любой, кто откроет сервис, может
выбрать одного из шести beta players.

- Evidence: `apps/server/src/routes.ts`, `packages/contracts/src/beta-players.ts`,
  `.workspace/tech_debt.md`.
- Статус: осознанно принято только для закрытой beta-группы.
- До расширения доступа: персональный secret/PIN/IdP, миграция memberships и отзыв
  старых sessions.

### Production guard не запрещает development GM token

`env.ts` предоставляет известный default `GM_ACCESS_TOKEN` и не отклоняет его при
`NODE_ENV=production`. Основной Compose требует переменную, но прямой или новый
startup path может запуститься с default.

- Evidence: `apps/server/src/env.ts`, `docker-compose.yml`.
- Первое действие: startup refinement, который в production требует явно заданный
  strong token и запрещает известное development value; добавить test.

### Backup/restore count gate не покрывает feedback

TS schema содержит 21 application table, а `infra/backup/database-counts.sql` и
restore allowlist считают 19. `feedback_reports` и `feedback_attachments`
попадут в dump, но их row counts после restore не проверяются.

- Evidence: `packages/db/src/schema.ts`, `infra/backup/database-counts.sql`,
  `scripts/restore-rehearsal-core.mjs`.
- Первое действие: атомарно обновить SQL manifest, JS allowlist, expected counts и
  `backup-safety.test.ts`, затем выполнить свежий isolated rehearsal.

### Drizzle migration metadata отстаёт от SQL/schema

SQL migrations и `_journal.json` доходят до `0015`, но snapshot JSON заканчивается
на `0013`: последний snapshot описывает 19 tables/9 enums, текущая schema —
21/11. Следующий `drizzle-kit generate` может создать повторный или конфликтующий
diff.

- Evidence: `packages/db/drizzle/meta/_journal.json` и каталог `meta`.
- Первое действие: отдельно восстановить/проверить metadata на clean database и
  добавить gate «schema ↔ migrations ↔ metadata» до следующей feature migration.

### Human release gate остаётся незавершённым

Автоматические проверки не заменяют записанный 30–45-минутный GM+6 rehearsal в
независимых Chrome/Firefox/Edge profiles. Текущий tech debt прямо не авторизует
production deployment без pass/fail, defects и явного GO/NO-GO.

- Evidence: `.workspace/tech_debt.md`,
  `docs/uix-217-rehearsal-runbook.md`, `docs/publish-readiness-2026-07-19.md`.

## Приоритет 1: authorization и корректность

| Finding                                                                   | Почему важно                                                                                         | Первое действие                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Не все canvas REST handlers требуют active scene для PLAYER               | По известному UUID игрок может воздействовать на свою drawing/controlled token в неактивной сцене    | Свести scene authorization в общий helper; negative tests на каждый command              |
| Chat `characterId` не проверяется на campaign/ownership                   | Сообщение может ссылаться на чужого персонажа                                                        | Валидировать character scope и разрешённую identity перед insert                         |
| Asset visibility после изменения token definition может расходиться с DTO | Snapshot собирает visible IDs из placement asset, а DTO может использовать новый default asset       | Убрать denormalization или вычислять visibility из того же effective asset source        |
| Tenant integrity в основном application-level                             | Обычные UUID FK не гарантируют, что scene/asset/definition/character одной campaign                  | Явные service helpers + tests; для критичных relations рассмотреть composite constraints |
| `trustProxy: true` доверяет любому proxy                                  | При прямой экспозиции X-Forwarded-For влияет на IP logging/rate limit                                | Ограничить trusted proxy и гарантировать network boundary                                |
| Socket.IO handlers без общего rate/error boundary                         | Pointer/ping events делают DB work; malformed input/async reject может повредить process reliability | Валидировать object до field access, добавить throttling/rate limits и wrapper           |
| Upload capacity errors возникают до public error mapping                  | Quota/low-disk могут стать generic 500, а поздние ошибки — misleading 400                            | Перенести весь pipeline в единый typed error boundary; cleanup tests                     |
| Global media quota считается неодинаково                                  | Feedback и assets используют разный scope на общем media root; concurrent checks не атомарны         | Один quota service и reservation/serialization strategy                                  |
| Invite contract обещает `expiresInHours`, route создаёт reusable access   | API semantics не совпадает с persisted behavior                                                      | Разделить legacy expiring invite и persistent grant contracts либо удалить поле          |
| Seed/GM lookup фактически single-campaign и местами берёт «первую» row    | Вторая campaign или необычная исходная БД могут выбрать неверный GM/active scene                     | Зафиксировать single-campaign constraint или везде query по role/campaign                |

Эти findings получены статическим чтением. Их стоит подтвердить targeted tests до
рефакторинга, чтобы сохранить точное воспроизведение и не расширить scope.

## Приоритет 2: realtime и frontend correctness

### Гибридный full-snapshot/incremental protocol

Большинство HTTP mutations запускает отдельный полный snapshot для каждого
socket; token/audio/chat/fog частично используют incremental events. Это
работает для текущих семи клиентов, но усложняет ordering и создаёт много DB
queries.

`App.tsx` обычно принимает event только при `event.sequence > snapshotVersion`.
Chat уже имеет специальный append/dedupe workaround, потому что более новый
snapshot может прийти раньше envelope и не содержать конкретное сообщение. Такой
же out-of-order риск нужно проверить для других entity events.

Рекомендация: формально описать protocol semantics — какие mutations всегда
завершаются snapshot, какие события replayable, как dedupe работает per entity и
когда обязателен resync. После этого измерить query/event volume на GM+6 fixture.

### Несогласованные action IDs

`api()` создаёт `x-action-id`, а callers часто отдельно создают body `actionId`.
Correlation ID в logs и idempotency ID в DB могут различаться.

Рекомендация: API wrapper должен принимать один command action ID и использовать
его и в header, и в body; telemetry tests должны это закреплять.

### Неатомарные UI workflows

Token definition editor сначала patch’ит definition, затем отдельным запросом
заменяет controllers, предполагая следующую revision. Частичная ошибка оставляет
половину намерения сохранённой.

Рекомендация: один server command/transaction или явно независимые UI actions с
раздельным статусом и reload-on-conflict.

### Canvas performance/accessibility

Renderer отправляет updates на pointer move без явного throttling, повторяет fog
geometry/hit tests, а основные операции завязаны на drag, middle/right mouse.
`snap()` и occupied-cell logic используют grid offset неодинаково.

Рекомендация: profiling на длинной сцене, requestAnimationFrame/throttle,
memoized spatial data, общий coordinate/grid module и keyboard/dialog paths для
критичных действий.

### Локальные UI defects, требующие regression tests

- Music playback effect может вызвать `pause()` при уже играющем server state
  после изменения зависимостей effect.
- Feedback diagnostics принимает build version/revision, но не добавляет их в
  возвращаемый payload.
- Roll toasts подавляются из-за lifecycle флага видимости chat.
- Background/world drag end может сохранить draft state, отстающий от последнего
  pointer move.

Evidence находится в `MusicBar.tsx`, `feedback-diagnostics.ts`, `App.tsx` и
`Orthographic2DRenderer.tsx`. Сначала нужны небольшие focused tests.

## Приоритет 2: поддерживаемость

Крупнейшие hotspots:

- `apps/server/src/routes.ts` — 4 919 строк;
- `apps/web/src/App.tsx` — 2 113 строк;
- `apps/web/src/Sidebar.tsx` — 2 009 строк;
- `apps/web/src/renderers/Orthographic2DRenderer.tsx` — 1 481 строк;
- `apps/web/src/styles.css` — 1 739 строк.

Проблема не только в размере. Эти файлы одновременно владеют transport,
domain/state transitions, authorization/visibility, UI composition и side
effects. Малое изменение требует широкого контекста и плохо изолируется тестом.

Рекомендуемая последовательность декомпозиции:

1. Выделить server authorization/query helpers без изменения endpoint behavior.
2. Выделить domain services по вертикальным slices: access, characters/catalog,
   scenes/canvas, communication/media.
3. Централизовать command result/error/idempotency semantics.
4. В web выделить snapshot/event reducer и domain command hooks из `App`.
5. Разбить `Sidebar` по workspace feature modules.
6. Разделить renderer interaction state, geometry и Konva presentation.
7. Перенести CSS к feature/components и удалить скрытый legacy UI после
   подтверждения владельца продукта.

Это должен быть incremental refactor с текущими integration/multiplayer tests,
а не переписывание системы.

## Contract drift

В `ServerToClientEvents` объявлены `scene:activated`, `fog:removed`,
`character:updated` и `server:error`, но фактический server их не emit’ит.
Клиент при этом содержит listeners для части событий. Legacy audio command также
сохраняет другой revision behavior.

Рекомендация: contract-level test, который сопоставляет объявленные events с
реальными producer/consumer paths, затем удалить dead variants или реализовать
их единообразно.

## Тестовые пробелы

- Frontend pure tests проходят, но React components/hooks, `App`, `Sidebar`,
  `MusicBar`, canvas pointer flows, routing, focus и accessibility напрямую не
  тестируются.
- Обычный Playwright suite в основном mock-based и может переиспользовать старый
  Vite server (`reuseExistingServer: true`).
- Visual baseline только Chromium/Windows; Firefox/Edge — ручной gate.
- PGlite не полностью моделирует PostgreSQL locking/triggers/sequences.
- Нет coverage thresholds и committed CI workflow.
- Нет автоматической проверки clean Drizzle generation и полноты backup table
  manifest.

Минимальная следующая инвестиция: focused regression tests для P0/P1 findings,
component tests для event reconciliation/music/token editor и repository-level CI
с frozen install → lint → typecheck → build → test.

## Operations и supply chain

| Наблюдение                                                                   | Риск                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Manifests широко используют `latest`, хотя lockfile фиксирует текущие версии | lock refresh может принести несколько major upgrades сразу    |
| Base container tags не pinned digest                                         | повторная сборка той же ревизии может взять другой base layer |
| Server container запускается root и содержит build/dev dependencies          | лишняя attack surface                                         |
| Нет metrics, tracing, central log shipping и backup-freshness alert          | деградация обнаруживается вручную                             |
| Backup DB dump/counts/media checksums делаются последовательно без quiesce   | DB и media могут представлять разные моменты времени          |
| `prepare-host.sh` распаковывает поверх старого каталога                      | удалённые файлы старой версии могут остаться                  |
| Release checklist упоминает migrations только до `0008`                      | документация не соответствует текущим `0000`–`0015`           |
| Пути media и quotas различаются между example/deployment/prepare-host        | operator может подготовить другой layout, чем ожидает runbook |

## Предлагаемый порядок работ

1. Закрыть или явно изолировать beta handle auth; добавить production token guard.
2. Исправить backup feedback counts и Drizzle metadata, выполнить restore
   rehearsal на текущей revision.
3. Закрепить targeted tests для inactive-scene auth, chat character scope и
   effective token asset visibility; затем исправить.
4. Свести action IDs и realtime protocol semantics; добавить reconciliation
   tests.
5. Исправить focused frontend defects и добавить component tests.
6. Ввести repository CI и dependency/container pinning policy.
7. Начать incremental decomposition hotspots.
8. Завершить human GM+6 Chrome/Firefox/Edge rehearsal и только затем принимать
   отдельное production GO/NO-GO решение.

## Связанные документы

- [architecture.md](./architecture.md) — фактическая архитектура без review noise.
- [development-guide.md](./development-guide.md) — безопасный change workflow.
- [skills-matrix.md](./skills-matrix.md) — компетенции и review ownership.
- [operations.md](./operations.md) — действующий runbook.
- [.workspace/tech_debt.md](../.workspace/tech_debt.md) — принятый product/release debt.
