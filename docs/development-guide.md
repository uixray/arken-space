# Разработка и onboarding

Этот документ — короткий путь от свежего клона до безопасного изменения кода.
Общее устройство системы описано в [architecture.md](./architecture.md), а
production-процедуры — в [operations.md](./operations.md).

## Требования

- Node.js `>=20.19.0`; production images используют Node 20.
- pnpm `10.12.1`, зафиксированный полем `packageManager`.
- Docker Engine/Compose для PostgreSQL, full-stack multiplayer и restore tests.
- Git и desktop Chrome; Firefox/Edge нужны для ручного release rehearsal.
- Для production/restore работ: Linux, nginx, systemd, PostgreSQL tools и restic.

Если в установленном Node есть Corepack:

```sh
corepack enable
corepack prepare pnpm@10.12.1 --activate
```

В новых версиях Node Corepack может отсутствовать. Тогда установите pnpm
отдельно и проверьте `pnpm --version`. Не обновляйте lockfile другой major-версией
package manager.

## Первый локальный запуск

`docker-compose.yml` рассчитан на production-сеть: PostgreSQL в нём **не
публикует порт на host**. Кроме того, pnpm-скрипты читают `process.env` и **не
загружают `.env` автоматически**. Docker Compose использует `.env` только для
подстановки своих переменных — это не передаёт их `db:migrate` или `dev`.

Из корня репозитория сначала создайте локальный override (он gitignored) и
выберите свободный host-port, например `5433`:

```yaml
# docker-compose.override.yml
services:
  postgres:
    ports:
      - "127.0.0.1:5433:5432"
```

PowerShell-последовательность для текущего простого формата `.env.example`:

```powershell
Copy-Item .env.example .env
Get-Content .env | ForEach-Object {
  if ($_ -match '^(?!#)([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$env:DATABASE_URL = 'postgres://arken:arken@localhost:5433/arken'

corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm dev:db
corepack pnpm db:migrate
corepack pnpm dev
```

Для POSIX shell загрузите те же переменные через
`set -a; . ./.env; set +a`, затем переопределите `DATABASE_URL` на host-port из
override перед `pnpm db:migrate` и `pnpm dev`. Если выбраны другие локальные
credentials или порт, измените URL согласованно. `POSTGRES_PASSWORD` применяется
только при первой инициализации volume; правка `.env` не меняет пароль уже
созданной БД.

Забыть этот экспорт теперь нельзя незаметно: `pnpm db:migrate` и `drizzle-kit`
падают с явным сообщением, если `DATABASE_URL` не задан. Раньше они молча
подставляли `postgres://arken:arken@localhost:5432/arken` — то есть на машине,
где порт 5432 занят другим PostgreSQL, уходили в чужую базу, а на хосте с
production применили бы миграции к боевой. Сообщение об ошибке — это ошибка
запуска, а не повод угадывать базу.

В production по той же причине обязательны `DATABASE_URL` и `GM_ACCESS_TOKEN`:
дефолты из схемы существуют только для разработки и тестов, и при
`NODE_ENV=production` сервер не стартует на них.

`pnpm build` после свежего клона важен: workspace-пакеты `@arken/contracts`,
`@arken/db` и `@arken/system` экспортируют файлы из `dist`. Без первой сборки
часть Vitest/server imports не разрешится.

Откройте:

- `http://localhost:5173/gm/<GM_ACCESS_TOKEN>` — мастер;
- `http://localhost:5173/join/<player-access-secret>` — персональный игрок;
- `http://localhost:5173/play/<handle>` — временный закрытый beta-flow без
  секрета, не предназначенный для публичного доступа.

После успешного входа token исчезает из address bar, а браузер получает
HttpOnly session cookie.

### Остановка локальной БД

```sh
docker compose stop postgres
```

Не используйте `docker compose down -v`, если хотите сохранить локальные данные:
ключ `-v` удаляет volume PostgreSQL.

## Настройка IntelliJ IDEA

1. Откройте корень `arken-space`, а не отдельный `apps/web` или `apps/server`.
2. Выберите Node interpreter версии 20.19.0+ и pnpm из `packageManager`.
3. Укажите корневой `package.json` для pnpm scripts.
4. Используйте TypeScript из `node_modules/typescript`.
5. Создайте run configuration для `pnpm dev`; PostgreSQL и migrations запустите
   отдельными конфигурациями `dev:db` и `db:migrate`.
6. Не индексируйте generated `dist`, `node_modules`, `test-results`, `media` и
   `backups`; они уже перечислены в `.gitignore`.

Vite проксирует `/api`, `/healthz` и `/socket.io` с `5173` на server `4100`,
поэтому отдельный CORS URL для локального клиента не нужен.

## Команды проекта

| Команда                              | Назначение                                                    |
| ------------------------------------ | ------------------------------------------------------------- |
| `pnpm dev`                           | server + web в watch mode                                     |
| `pnpm dev:db`                        | поднять только PostgreSQL через Compose                       |
| `pnpm db:migrate`                    | применить migrations `packages/db/drizzle`                    |
| `pnpm db:generate`                   | сгенерировать новую Drizzle migration после изменения schema  |
| `pnpm db:studio`                     | открыть Drizzle Studio                                        |
| `pnpm build`                         | последовательно собрать все workspace packages/apps           |
| `pnpm typecheck`                     | strict TypeScript без emit, включая `tests/e2e/tsconfig.json` |
| `pnpm lint`                          | ESLint для всего монорепозитория                              |
| `pnpm format`                        | применить Prettier ко всему дереву; сначала проверить scope   |
| `pnpm format:check`                  | проверить Prettier без изменения файлов                       |
| `pnpm test`                          | Vitest unit/integration suite                                 |
| `pnpm test:watch`                    | Vitest watch mode                                             |
| `pnpm test:e2e`                      | Playwright UI suite, в основном с mocked API                  |
| `pnpm test:multiplayer`              | isolated Docker story: GM + 6 игроков                         |
| `pnpm restore:rehearse`              | guarded restore в отдельный Compose project                   |
| `pnpm gameplay:reset:safe`           | destructive operator workflow с несколькими gates             |
| `pnpm incident:bundle -- --since 2h` | bounded/redacted diagnostic bundle                            |

`build`, deploy и Docker build не запускают автоматически lint, typecheck и
tests. Выполняйте quality gate явно.

## Рекомендуемый quality gate

Для обычного pull request:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Порядок `build` перед `test` нужен на чистом checkout из-за package exports на
`dist`. Если менялся UI flow, дополнительно запустите:

```sh
pnpm test:e2e
```

Обычные Playwright e2e намеренно выполняются с `workers: 1`: спеки делят одну
кампанию в одной БД. Не увеличивайте параллельность без изоляции состояния на
worker. `pnpm typecheck` отдельно компилирует `tests/e2e/tsconfig.json`, поэтому
расхождение Playwright-фикстуры с `GameSnapshot` должно быть исправлено до
browser-прогона.

Сохраняйте код возврата именно Playwright. Не ставьте `grep`, `Select-String`
или другой фильтр последней командой pipeline без `pipefail`/явной передачи
exit code: тогда красный прогон может выглядеть успешным. `pnpm format:check`
также является самостоятельным read-only gate с ненулевым кодом при drift;
`pnpm format` — отдельная записывающая команда, а не доказательство gate.

Если менялись realtime, visibility, auth/access, canvas persistence, reconnect,
Docker/nginx или migrations:

```sh
pnpm test:multiplayer
```

Multiplayer runner требует Docker, не менее 6 GiB свободного места и свободный
`127.0.0.1:14180`. Он обязан работать только с созданным им `arken-e2e-*`
Compose project и не может указывать на production origin.

### Что именно проверяется

- Pure/unit: dice grammar, chat composition/state, fog geometry, token
  placement, entity reducer, audio/telemetry helpers.
- Integration: реальные Fastify handlers и Socket.IO server/client, Drizzle над
  PGlite, migrations, authz, CAS/idempotency, snapshot visibility.
- Browser: shell, сцены, sidebar, long chat, music consent, feedback и visual
  fog baseline.
- Full-stack: PostgreSQL 17 + server + web + nginx, GM + 6 contexts, privacy,
  simultaneous actions, reconnect и backend restart.
- Operations: backup/restore/reset guards, isolation, checksums, log redaction.

PGlite полезен для быстрых integration tests, но не заменяет PostgreSQL 17 для
row locking, sequences, triggers и concurrency. Критические DB/realtime изменения
должны доходить до Docker multiplayer/restore gate.

## Environment

Стартуйте с `.env.example`. `.env` нельзя коммитить. Помните: приложение и
migration runner не загружают этот файл; перед локальным запуском переменные
должны находиться в environment текущего процесса. Docker Compose загружает
`.env` для собственной интерполяции, но это другой механизм.

| Группа         | Переменные                                                                  | Комментарий                                            |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ |
| Runtime        | `NODE_ENV`, `PORT`, `WEB_ORIGIN`, `PUBLIC_URL`                              | origin должен точно совпадать с браузером              |
| Build identity | `APP_VERSION`, `BUILD_REVISION`, `SCHEMA_VERSION`                           | в release должны описывать фактически запущенный build |
| Database       | `DATABASE_URL`, `POSTGRES_PASSWORD`                                         | production password не должен совпадать с example      |
| Session/auth   | `SESSION_COOKIE_NAME`, `SESSION_TTL_DAYS`, `GM_ACCESS_TOKEN`                | GM token — минимум 32 случайных символа                |
| Media          | `MEDIA_ROOT`, `MEDIA_HOST_PATH`, `MEDIA_QUOTA_BYTES`, `MIN_FREE_DISK_BYTES` | content хранится вне БД                                |
| Upload limits  | `MAX_IMAGE_BYTES`, `MAX_AUDIO_BYTES`                                        | server body limit связан с audio limit                 |
| Traffic        | `RATE_LIMIT_MAX`                                                            | есть в server schema, но отсутствует в `.env.example`  |

Production, backup/restore, reset и multiplayer используют дополнительные
переменные. Их полный контракт находится в `docker-compose*.yml`,
`infra/backup/restic.env.example` и соответствующих scripts. Не переносите backup
credentials в application `.env`.

## Как вносить изменения

### Новый HTTP use case

1. Добавьте input schema и общие DTO в `packages/contracts`.
2. Определите role, ownership, campaign и active-scene инварианты до mutation.
3. В route проверьте `actionId`/revision и выполните state + event в одной DB
   transaction.
4. Выберите один механизм доставки: canonical snapshot или typed incremental
   event; обработайте reconnect/resync.
5. Добавьте HTTP integration, visibility и idempotency/conflict tests.

Не доверяйте UUID из URL/body как доказательству принадлежности текущей
кампании. Существующие foreign keys не кодируют tenant boundary.

### Новый realtime command/event

1. Обновите обе event maps в `@arken/contracts`.
2. Валидируйте payload Zod-схемой до обращения к полям.
3. Выберите минимальную audience room и отдельно проверьте GM-only data.
4. Для durable command используйте `actionId`, revision, transaction, event и
   ack; для ephemeral event зафиксируйте, что он переживать reconnect не должен.
5. Добавьте listener/dedupe в `App.tsx` и тест порядка event/snapshot/reconnect.

### Изменение canvas

Путь изменения обычно такой:

```text
SceneRendererProps
  → Orthographic2DRenderer interaction
  → App callback/command
  → route или realtime handler
  → token/drawing/fog tables + action_journal
  → snapshot/event
  → renderer reconciliation
```

Проверяйте role/layer visibility, grid offset/scale, optimistic drag,
multi-selection, undo/redo и работу после resync. Canvas pointer flow должен иметь
доступную keyboard/dialog alternative для критических действий.

### Изменение персонажей или правил

- Fixed system defaults находятся в `packages/system`.
- Wire validation и roll/catalog schemas — в `packages/contracts`.
- Resolution/recharge/campaign clock — в server routes/dice helpers.
- UI — `CatalogEntryForm`, character sections `Sidebar` и callbacks `App`.

Не дублируйте новое правило в system и contracts без теста согласованности.
Catalog assignment создаёт snapshot-копию: последующее изменение template не
должно молча менять уже назначенную запись персонажа.

### Изменение БД

1. Измените `packages/db/src/schema.ts`.
2. Запустите `pnpm db:generate` и внимательно прочитайте SQL.
3. Проверьте forward upgrade существующих данных и rollback/recovery plan.
4. Обновите DTO/snapshot/routes/reset logic.
5. Одновременно обновите backup count manifest и restore allowlist, если
   добавилась/удалилась таблица.
6. Добавьте migration test и прогоните full-stack/restore gate.

До исправления drift, описанного в [codebase-audit.md](./codebase-audit.md), не
запускайте `db:generate` механически: metadata snapshots для `0014` и `0015`
отсутствуют и сначала требуют отдельной сверки.

### Изменение assets/uploads

Проверьте согласованно:

- Zod/DB kind enum;
- size, magic bytes, dimensions/duration и безопасное имя;
- campaign/role visibility в snapshot и `/content`;
- удаление временного файла при DB error;
- media quota и low-disk mapping;
- backup/media checksum и restore;
- Range response для аудио.

## Соглашения, которые нельзя ломать

- TypeScript strict, `noUncheckedIndexedAccess`, ES2022/ESM.
- Shared request/event contracts меняются раньше producer/consumer.
- Raw invite/access/session secrets не логируются и не сохраняются.
- Player snapshot не должен содержать GM-layer или чужие private данные.
- State mutation, `game_events` и требуемый audit chat/journal пишутся атомарно.
- Duplicate `actionId` не применяет эффект второй раз.
- Conflict не перетирает более новую revision; клиент получает canonical state
  или выполняет resync.
- Production/deploy/reset — отдельные явные gates. Успешная сборка не является
  разрешением на deployment.
- External directories из `dependencies.md` — read-only references; все
  изменения остаются внутри этого репозитория.
- **Документация обновляется тем же коммитом, что и код.** Новая таблица, новое
  realtime-событие, новый маршрут или новый инвариант — это правка
  [architecture.md](./architecture.md), а не «потом». Проверяемая часть этого
  правила закреплена тестом (см. ниже), непроверяемая — на совести автора.

## Как документация не отстаёт

Правило в тексте держится до первой спешки, поэтому проверяемые утверждения
документации проверяются автоматически. `tests/documentation-freshness.test.ts`
сверяет с кодом:

- количество таблиц и **имена всех** таблиц схемы;
- диапазон миграций;
- количество HTTP-маршрутов;
- имена всех realtime-событий, которые сервер принимает и шлёт;
- что индекс `docs/README.md` не ссылается на несуществующие файлы.

Добавили таблицу или событие и не упомянули в `architecture.md` — падает сборка.
**Когда этот тест краснеет, неправ документ, а не тест.**

Прозу он не проверяет: нельзя утверждать, что объяснение всё ещё верно. Но
число, имя таблицы и имя события — это факты с единственным источником, а
документ, повторяющий их, — копия, которая может протухнуть.

## Ловушки, на которые уже наступали

Список не теоретический: каждый пункт — реальный инцидент или дефект, найденный
в этом коде. Стоит прочитать целиком до первой правки.

### `.sql` без записи в журнале не применяется в production

Drizzle исполняет `packages/db/drizzle/meta/_journal.json`, а не содержимое
каталога. Файл миграции без записи в журнале локально не заметен, потому что
тесты поднимают схему иначе, — и молча не применяется на проде. Случилось
дважды. Закреплено `tests/migration-integrity.test.ts`.

### `Pick<SidebarProps, ...>` превращается в `unknown`

Соблазн не переписывать громоздкие сигнатуры. Но как только проп убирается из
`Sidebar`, `Pick` молча резолвится в `unknown`: ошибка вылезет не в месте
объявления, а десятком непонятных ошибок в местах вызова. То же самое с
`Props["onChat"]` внутри компонентов. **Домен объявляет свои сигнатуры сам.**

### Тест чистой функции ничего не говорит о вызывающем коде

Дважды подряд: маршрут телеметрии проходил все тесты хелперов, хотя санитайзер
выбрасывал каждое измерение; рендерер тумана вызывал не ту из двух корректных
функций. Правило: если решение важно — вынести его в функцию и протестировать
**решение**, а не только арифметику под ним.

### Проверяйте, что новый тест умеет падать

Дешёвая привычка, которая уже несколько раз спасала: сломайте фичу нарочно и
убедитесь, что падает именно новый тест. Вакуумный тест выглядит точно так же,
как работающий.

### `tsc` и `eslint` держат разные границы

Осиротевшие импорты типов компилятор не видит — линтер видит. Гонять `eslint` по
всему дереву (`corepack pnpm lint`), а не по узкому пути: на узком уже был
ложный отчёт «чисто».

### Скриптовая правка текста ломает то, что кажется безобидным

Вставка импорта «после первого перевода строки за первым `import`» попала внутрь
многострочного `import {` и сломала файл. Извлечение сигнатур регуляркой дважды
дало мусор: она обрывается на `;` внутри вложенного объекта, а подсчёт
вложенности ломается об `Promise<void>`. Читать скриптом можно, править — руками.

### Контекст действий не терпит изменяемых значений

См. [architecture.md](./architecture.md#команды-доменные-хуки-и-контекст-действий).
Нарушение не ломает приложение — оно тихо возвращает перерисовку всего дерева на
каждое событие.

### Предупреждение в консоли живёт ровно столько, сколько на него не смотрят

React печатал «Cannot update a component (`WorkspaceNav`) while rendering a
different component (`Orthographic2DRenderer`)» — setState во время рендера
чужого компонента. Это не косметика: лишний синхронный проход, а порядок
обновлений начинает зависеть от момента отрисовки, а не от данных. Тот же класс
дефектов уже давал нестабильность в тестах раскладки.

Продержалось это столько, сколько никто не читал лог dev-сервера: ни один гейт
консоль не проверял. Когда за него взялись (UIX-521), вызов уже не
воспроизводился — ушёл вместе с чьей-то правкой, и что именно его убрало,
установить нечем.

Поэтому проверка теперь есть: `tests/e2e/react-console-guard.ts` роняет тест на
консольных ошибках React, и все спеки идут через неё. Список отслеживаемых
сообщений намеренно узкий — только setState во время чужого рендера и цикл
обновлений. Ронять прогон на любой строке из консоли нельзя: там 401 на
`/api/bootstrap` до входа, 404 на favicon и недоступный CDN шрифтов, и такая
проверка была бы выключена в первый же красный день.

Вывод шире одного предупреждения: **сигнал, который виден только человеку,
читающему лог, не является проверкой.** Либо он роняет прогон, либо его нет.

## Проверить факты из архитектуры

Числа в [architecture.md](./architecture.md) не переписываются на глаз:

```bash
grep -cE 'pgTable\(' packages/db/src/schema.ts
```

```bash
ls packages/db/drizzle/*.sql | wc -l
```

```bash
grep -cE 'app\.(get|post|patch|put|delete)\(' apps/server/src/routes.ts
```

## Быстрая навигация по проблеме

| Симптом/задача                     | Начать с                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| Страница не входит                 | `AuthGate.tsx` → `routes.ts` auth routes → `auth.ts`               |
| Данные пропали/утекли у игрока     | `snapshot.ts` → route/realtime authz → `visibility.test.ts`        |
| Дубли или конфликт после reconnect | `api.ts`/`App.tsx` → `game_events` → command ack/tests             |
| Токен двигается неверно            | renderer pointer/snap → `token:moved` → CAS/journal                |
| Undo/redo ошибочен                 | canvas routes → `actionJournal` → history tests                    |
| Музыка рассинхронизирована         | `MusicBar.tsx` → realtime `audio:set` → `audio-state.ts`           |
| Upload падает                      | `ImageUploadField`/feedback → routes → `storage.ts` → media env    |
| Migration/restore расходятся       | schema/migrations → `database-counts.sql` → restore core/tests     |
| Production incident                | `/healthz`, `/api/diagnostics`, `incident:bundle`, `operations.md` |

## Частые проблемы

### `Failed to resolve entry for package "@arken/..."`

Workspace package ещё не собран:

```sh
pnpm build
```

После этого повторите test/dev command.

### Сервер не стартует после клона

Проверьте последовательно:

```sh
docker compose ps
pnpm db:migrate
pnpm --filter @arken/server dev
```

Типовые причины: PostgreSQL ещё не healthy, его порт не опубликован локальным
override, переменные из `.env` не экспортированы в процесс, занят порт 4100 или
`DATABASE_URL` не совпадает с host-port/Compose credentials.

### Web загружается, API/Socket.IO недоступны

Проверьте `WEB_ORIGIN=http://localhost:5173`, server на 4100 и Vite proxy.
Unsafe requests с другим `Origin` намеренно получают 403.

### Playwright использует не тот frontend

Обычный config имеет `reuseExistingServer: true`. Остановите старый Vite server
или убедитесь, что он запущен из текущей ревизии.

## Дальнейшее чтение

- [skills-matrix.md](./skills-matrix.md) — какие компетенции нужны по областям.
- [codebase-audit.md](./codebase-audit.md) — текущие риски и приоритеты.
- [brief.md](./brief.md) — продуктовая цель и MVP boundary.
- [first-session.md](./first-session.md) — подготовка первой игры.
- [operations.md](./operations.md) — backup, restore и incidents.
- [uix-217-rehearsal-runbook.md](./uix-217-rehearsal-runbook.md) — human GM+6 gate.
