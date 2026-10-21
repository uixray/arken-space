# Production release checklist

This checklist prepares and verifies a release. It is not evidence that backup,
restore, deployment, the human GM + 6 rehearsal, or final manual production
acceptance has passed.

> **Текущий production — хост bb03 (`80.85.154.36`).** `infra/deploy/release.sh`
> и разделы ниже про `/home/uixray/apps/arken-space`, `/etc/arken-space` и
> Compose project `arken-space` на bb03 **сейчас неприменимы**: скрипт упадёт
> на первой проверке `APP_ROOT`. Выкладывайте по разделу
> [bb03: фактическая схема выкладки](#bb03-фактическая-схема-выкладки). Code
> quality gate, требование «ревизия в `origin/main`», правила rollback и запрет
> сброса игры действуют и там.

## bb03: фактическая схема выкладки

Схема проверена релизами 6db32f2 (11.10.2026) и c1d1243 (17.10.2026). Скрипты
и receipts последнего релиза лежат на хосте в
`/opt/arken-space/releases/release-c1d1243f-20261017/`; новый релиз кладёт
свои в новую папку `release-<sha8>-<YYYYMMDD>/` (root, `umask 077`). Каждый
этап — отдельный fail-closed скрипт с receipt JSON; любой FAIL — остановка и
отчёт, а не обход. На прод выкладывается только ревизия, на которую владелец
дал GO.

### Чем хост отличается от предположений `release.sh`

| `release.sh` ожидает                                    | На bb03                                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| пользователь `uixray`, git checkout в `APP_ROOT`        | вход `root@80.85.154.36`, checkout и build-окружения нет                                                                                                              |
| `/home/uixray/apps/arken-space`, `.env` в checkout      | база `/opt/arken-space/releases/bb03e115`: `config/compose.production-ff9.yml` + `config/compose.env`                                                                 |
| Compose project `arken-space`                           | Compose project `arken-prod-bb03` + per-release `compose.release.override.yml`, который пинит image ID server/web, `BUILD_REVISION` и `SCHEMA_VERSION`                |
| сборка образов на хосте                                 | сборка в GitHub Actions (`release-images.yml`), доставка архивом, `docker load`                                                                                       |
| `/etc/arken-space/restic.env`, `infra/backup/backup.sh` | отдельный restic-репозиторий на каждый снимок в `/opt/arken-space/backups/<имя>/`; ядро снимка — `capture-portfolio-cutover-20261016` (`capture-service-snapshot.sh`) |
| schema `2`, `test-results/restore/runner.json`          | `SCHEMA_VERSION` = число записей журнала миграций (на c1d1243 — `62`); репетиция пишет свой receipt                                                                   |
| edge принадлежит проекту                                | edge общий с другими сайтами: только `nginx -t` и `nginx -s reload`, **не пересоздавать** и не менять его конфиг                                                      |

Перед стартом снимите read-only состояние: `healthz` (ревизия, schemaVersion),
image ID всех четырёх сервисов (server, web, postgres, edge), ledger миграций
(`<число>|<when последней>`), sha256 `bb03e115/config/default.conf` и текущего
override, свободное место. Если `default.conf` не совпадает с последним
записанным пином — уточните у владельца, прежде чем закреплять новое значение.

### Сборка образов

Образы собираются не на хосте: сборка монорепо съест RAM/CPU живого сервиса и
несколько ГБ диска. Запуск — вручную, только по точному SHA из `origin/main`:

```sh
gh workflow run release-images.yml -f revision=<reviewed-40-character-sha>
```

Workflow сам отвергает SHA вне `origin/main`, собирает `Dockerfile.server` и
`Dockerfile.web` (amd64), кладёт оба образа в один `docker save`-архив и пишет
`manifest.json` (ревизия, image ID, sha256 и размер архива, run id). Artifact
живёт сутки; секретов в образах нет. Скачайте artifact на ноутбук
(`gh run download <run-id>`).

### Доставка параллельными частями

Входящий канал хоста ограничен **~17 KiB/s на одно TCP-соединение** (и с
GitHub, и с ноутбука), поэтому одиночный `scp` или `curl` архива на сотни МБ
идёт часами. Рабочий способ 17.10: разрезать архив на ~32 части (`split`),
передать их `scp` в ~24 параллельных потока (~1 MiB/s суммарно), на хосте
сверить sha256 каждой части, склеить и сверить sha256 и размер архива с
`manifest.json`.

### ID образов на containerd

Docker на bb03 работает с хранилищем образов containerd: `docker image inspect`
и `.Image` контейнера показывают **digest OCI-манифеста**, а не config digest,
который печатает CI в `manifest.json`. Поэтому прямое сравнение «image ID =
manifest» после `docker load` всегда даст расхождение. Проверка:

1. sha256 архива = `manifest.json`;
2. в `index.json` архива найти manifest каждого образа и убедиться, что его
   `config.digest` равен ID из `manifest.json`;
3. после `docker load` ID тегов `arken-release-server:<sha>` и
   `arken-release-web:<sha>` должны равняться digest этих манифестов. Именно
   эти digest-и пинятся в override и сверяются с запущенными контейнерами.

### Этапы

1. **Preflight и снимок** (прод не меняется, кроме паузы API ~2–3 мин).
   Preflight: живые image ID = текущий релиз, ledger, sha256 `default.conf` и
   override, место (см. порог ниже). Неизменяемые теги на **уже существующие**
   образы: `arken-space-rollback-server:<production-sha>` и
   `arken-space-rollback-web:<production-sha>`; существующий тег с другим ID —
   FAIL. Копии `default.conf` и текущего override — в папку релиза. Снимок
   `capture-service-snapshot.sh` в новый restic-репозиторий
   `/opt/arken-space/backups/pre-release-<sha8>-<YYYYMMDD>/`, точный
   `snapshotId` из receipt, затем `restic check --read-data`. Health старого
   API после возобновления.
2. **Репетиция восстановления и миграций на одноразовом loopback-контуре.**
   Отдельный Compose project `arken-restore-<sha8>`, только `127.0.0.1`,
   свой том PostgreSQL и временная папка медиа. `restic restore <snapshotId>`,
   сверка sha256 файлов снимка с его manifest, восстановление дампа в
   PostgreSQL того же образа, что на проде, сверка счётчиков таблиц. Старт
   кандидата на этой копии: сервер сам применяет новые миграции. Ожидание:
   healthz = кандидат и новый `SCHEMA_VERSION`, ledger = журнал кандидата,
   счётчики таблиц и старые строки ledger не изменились. Receipt — по смыслу
   `runner.json`, но это не вывод `restore:rehearse`; так и пишите в отчёте.
3. **Медиа-проверка на копии.** Через SSH-туннель на loopback-порт контура:
   вход тестовым аккаунтом, созданным только в копии, загрузка одной картинки
   и одного аудиофайла, чтение через `/api/assets/:id/content`. В живой
   кампании ничего не загружается. Затем
   `docker compose -p arken-restore-<sha8> down -v`, удаление временных папок,
   проверка, что контейнеров, томов, сетей и порта проекта не осталось.
4. **Активация с trap-откатом** — единственный шаг, меняющий прод. Скрипт с
   явным гейтом подтверждения (`ARKEN_RELEASE_CONFIRM=publish-<sha8>-after-gate`)
   и предусловиями: receipts этапов 1–3 есть и PASS, живые образы = текущий
   релиз, `default.conf` = записанный sha256, загруженные образы = проверенные
   digest-и. Новый `compose.release.override.yml` копирует edge-сети из
   текущего override (без них edge теряет `edge-ingress` — урок 11.10).
   Затем `up -d --no-deps --force-recreate server web` (postgres и edge не
   пересоздаются), `nginx -s reload` в контейнере edge, ожидание health до
   120 с. `trap` на любой ненулевой выход поднимает server/web со старым
   override (образы сверены с rollback-тегами), делает `nginx -s reload` и
   проверяет старый health.
5. **Проверки после выкладки.** Скриптом: image ID всех четырёх сервисов,
   ledger, `nginx -t`, публичный `https://arken-khar.space/healthz` = кандидат,
   `/socket.io/` upgrade → `101`, соседние сайты на общем edge отвечают, в
   логах server/edge нет ошибок. `docker compose … restart postgres server web`
   и сверка счётчиков таблиц и ledger до/после. Руками: вход мастером и
   игроком (входит владелец, агент пароли не вводит), карта, броски, журнал,
   музыка, новые возможности релиза. `infra/deploy/smoke-auth.sh` здесь не
   запускается: он рассчитан на layout `release.sh`.
6. **Перепин weekly-capture.** `/opt/arken-space/backup-tools/weekly-capture.sh`
   держит пины: образы server/web, `EXPECT_BUILD`, schemaVersion,
   `EXPECT_LEDGER`, sha256 override и `default.conf`. Сохраните старую копию
   (`weekly-capture-<sha8>-<YYYYMMDD>.sh`), обновите пины на новый релиз,
   прогоните `PREFLIGHT_ONLY=1`, затем первый снимок `weekly-<YYYYMMDD>` и
   `restic check --read-data`.

### Диск: порог и снимки

Сервер отклоняет загрузки медиа, если свободного места меньше
`MIN_FREE_DISK_BYTES` (по умолчанию **5 GiB**, на проде не переопределён).
Каждый restic-снимок занимает **~0.7 GB**; восстановленная копия на этапах 2–3
и архив образов временно съедают ещё столько же и больше. 17.10 первая
медиа-проверка получила `LOW_DISK_SPACE`, а пока лежали архивы образов, живые
загрузки на проде тоже отклонялись бы. Перед этапами 1–3 посчитайте запас:
свободно минус (архив образов + снимок + восстановленная копия) должно
оставаться выше 5 GiB; архивы удаляйте сразу после проверки `docker load`.
Чистить старые образы и бэкапы — только с разрешения владельца (локальная
копия данных — `D:\ArkenBackups`).

### Откат на bb03

Пока в базе нет данных, которые старый код не понимает: поднять server/web со
старым override (`-f config/compose.production-ff9.yml -f
<папка прошлого релиза>/compose.release.override.yml up -d --no-deps
--force-recreate server web`), `nginx -s reload` в edge, проверить старый
health. Если новые виды данных уже появились — сначала удалить их; иначе
восстановление снимка этапа 1 только через изолированную репетицию и отдельно
согласованную процедуру. Команду сброса игры не запускать.

## Release identity

Use one reviewed, committed revision for every gate:

```sh
export EXPECTED_BUILD_REVISION="$(git rev-parse HEAD)"
test -z "$(git status --porcelain --untracked-files=normal)"
test "$(printf %s "$EXPECTED_BUILD_REVISION" | wc -c)" -eq 40
```

На production host `release.sh` после `git fetch origin` принимает target только
если он входит в историю `origin/main`; локальный или ещё не смерженный SHA
выкладывать нельзя.

Production `.env` проходит fail-closed gate: это обычный не-symlink файл,
который принадлежит оператору, имеет mode `600` и не отслеживается Git. Он
должен задавать:

- `APP_VERSION`, `POSTGRES_PASSWORD`, `GM_ACCESS_TOKEN`;
- `WEB_ORIGIN=https://arken-khar.space` and
  `PUBLIC_URL=https://arken-khar.space`;
- absolute persistent `MEDIA_HOST_PATH` outside the checkout;
- media quota, free-disk reserve, image and audio limits.

Restic and S3 credentials belong only in root-owned mode-`600` files under
`/etc/arken-space`, never in the application `.env` or GitHub. Release gate
проверяет владельца и права restic env и password file до чтения, запрещает
backup-секреты в `.env` и никогда не печатает их значения.

## Code quality gate (outside `release.sh`)

Run this on the exact reviewed revision before using the production-host script:

```sh
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test
corepack pnpm test:multiplayer
```

Browser coverage is split by runtime, not by product scope. With the exact
candidate's disposable PostgreSQL/server/web stack running, set
`E2E_BASE_URL` to its loopback edge URL and run
`corepack pnpm exec playwright test --config=playwright.release.config.ts`.
That config requires an explicit URL and never starts a Vite fallback. Run the
four Vite-only `/tests/fixtures/` specs separately with
`corepack pnpm exec playwright test --config=playwright.fixtures.config.ts`
on a dedicated local `E2E_PORT`/`E2E_BASE_URL`. Both projects (Chromium and
Firefox) must pass. If sharded, record the candidate SHA, image IDs, test
inventory and all shard reports; the union must equal the complete suite, with
no missing or duplicate cases.

GitHub `checks` дополнительно запускает `sh -n` для `release.sh`,
`build-and-start.sh` и `smoke-auth.sh`; structural unit-тесты не заменяют parser
POSIX shell.

`pnpm typecheck` includes `tests/e2e/tsconfig.json`; Playwright remains at
`workers: 1` mainly to avoid CPU contention in geometry-sensitive browser
checks. Live-backend tests isolate campaigns, so worker count is not a shared
campaign correctness requirement. Preserve the exit
code of each command. In particular, do not pipe Playwright into a trailing
`grep`: without `pipefail` a failed browser run can look green. `format:check`
is the read-only gate; running the writing `pnpm format` is not equivalent
evidence.

## The scripted host path (не для bb03)

`infra/deploy/release.sh` automates the host-side safety and deployment gates:
nginx/certificate/disk preflight, environment/permission validation, exact
rollback image preservation, restic check, fresh backup, exact-snapshot restore
rehearsal, exact checkout, build/start, health, authenticated smoke and
WebSocket upgrade. It does **not** run the code quality gate above, upload
media, restart the stack to prove persistence, or perform the human GM/player
browser rehearsal. Скрипт использует фиксированный Compose project `arken-space`
независимо от общего development `.env` и удерживает host release lock до выхода.

```sh
sh infra/deploy/release.sh <reviewed-40-character-sha>
```

It stops after the restore rehearsal and prints the exact command to proceed.
It does not change the running production stack until the deploy is confirmed
explicitly:

```sh
RELEASE_CONFIRM=deploy-now \
MEDIA_SMOKE_APPROVAL=non-live-candidate-passed \
sh infra/deploy/release.sh <same-sha>
```

Confirmed invocation fail-closed требует, чтобы host checkout уже начинался с
той же целевой ревизии. Поэтому первый rollout, который меняет саму release
automation, нельзя начинать сразу с `RELEASE_CONFIRM=deploy-now`: сначала
выполните unconfirmed pass, отдельно проверьте
`test "$(git rev-parse HEAD)" = "<same-sha>"`, и только затем запускайте
напечатанную confirmed-команду. Confirmed pass заново выполняет все host gates.

The stop is not a dry run: the backup and the rehearsal are real. Only the
production-changing steps wait for confirmation. A failure at any gate aborts
with a non-zero status and repeats the rollback revision recorded before the
first change.

`MEDIA_SMOKE_APPROVAL=non-live-candidate-passed` — это ручная аттестация, а не
автоматический тест. До confirmed deploy оператор должен на одноразовом
disposable non-live candidate-контуре точной release revision проверить
загрузку одного изображения и одного аудиофайла, затем удалить контур вместе с
его данными. Никогда не создавайте тестовую загрузку в live-кампании.

До build скрипт получает image ID ровно одного запущенного контейнера каждого
сервиса и создаёт неизменяемые теги
`arken-space-rollback-server:<production-sha>` и
`arken-space-rollback-web:<production-sha>`. Существующий тег принимается только
если он указывает на тот же ID. После build оба тега повторно сверяются с
исходными IDs; итоговый release evidence печатает точные rollback tags и image
IDs вместе с IDs новых запущенных образов.

The manual host steps below remain the fallback and the specification of the
host-side part only. They are also what to follow when the script itself is
suspect. Post-deploy browser/media/persistence checks remain manual in either
path.

## Mandatory pre-deploy gates

1. Confirm DNS resolves to the intended host and the existing certificate covers
   `arken-khar.space`. Validate nginx with `sudo nginx -t`.
2. Install `restic`; load `/etc/arken-space/restic.env`; run `restic check`.
3. Create a fresh backup with `infra/backup/backup.sh`. Record the exact snapshot
   ID emitted by that invocation. Do not use `latest` as release evidence.
4. Rehearse that exact snapshot in the isolated `arken-restore-*` environment:

   ```sh
   export ARKEN_RESTORE_CONFIRM=isolated-clean-target
   export RESTORE_BUILD_REVISION="$EXPECTED_BUILD_REVISION"
   export SNAPSHOT_ID=<exact-snapshot-id>
   corepack pnpm restore:rehearse
   ```

5. Inspect `test-results/restore/runner.json`: overall result, dump/media
   checksums, table counts, schema `2`, exact build revision, cleanup,
   production health and disk checks must all pass.
6. На файловой системе `MEDIA_HOST_PATH` подтвердите свободное место не меньше
   `MIN_FREE_DISK_BYTES + 5 GiB`. Byte-accurate gate должен пройти перед build и
   сразу после build. Confirm
   `/home/uixray/apps/arken-space-data/media` and the Compose PostgreSQL volume
   are included in the backup/restore evidence.

## Deploy exact revision

Only after the gates above pass:

```sh
export EXPECTED_BUILD_REVISION=<reviewed-40-character-sha>
export VERIFIED_BACKUP_SNAPSHOT_ID=<exact-snapshot-id>
export RESTORE_REHEARSAL_REVISION="$EXPECTED_BUILD_REVISION"
export EXPECTED_SCHEMA_VERSION=2
sh infra/deploy/build-and-start.sh
```

The server applies every pending migration recorded in
`packages/db/drizzle/meta/_journal.json` before accepting traffic; do not copy a
numeric migration range into this runbook because that range changes with the
schema.
After startup, require all services healthy and verify:

```sh
curl -fsS https://arken-khar.space/healthz
APP_ROOT=/home/uixray/apps/arken-space \
DOMAIN=https://arken-khar.space \
EXPECTED_BUILD_REVISION="$EXPECTED_BUILD_REVISION" \
EXPECTED_SCHEMA_VERSION="$EXPECTED_SCHEMA_VERSION" \
sh infra/deploy/smoke-auth.sh
```

The health and authenticated diagnostics responses must report the exact
release revision and schema `2`. Auth smoke также требует точную session cookie
и каждый её флаг: `HttpOnly`, `Secure`, `SameSite=Strict`. После logout старая
cookie обязана получить `401 AUTH_REQUIRED` на diagnostics — ответ `{ok:true}`
сам по себе не доказывает инвалидирование сессии. The script verifies the
WebSocket upgrade; an operator must still verify GM/player production flows and
persistence of legitimate existing data across
`docker compose restart postgres server web`. Record these results separately:
a zero exit and final success output from `release.sh` do not prove manual
production acceptance.

## Rollback

Before deploy, record the previous commit, exact rollback server/web tags and
image IDs, and the fresh snapshot ID. If startup, migration, health,
authentication, realtime, or persistence verification fails:

1. stop application writes and retain logs;
2. stop the failed stack;
3. verify that `arken-space-rollback-server:<production-sha>` and
   `arken-space-rollback-web:<production-sha>` still resolve to the recorded
   image IDs, then restore those exact preserved images; rebuilding the previous
   revision is not a substitute for the captured image identity;
4. if migrations changed persisted data, restore the recorded exact snapshot
   using the isolated rehearsal procedure first, then the separately approved
   production recovery procedure;
5. verify health, schema, authentication, media and realtime before reopening.

Never run the gameplay-reset command as part of deployment or rollback. It is a
separate destructive operation requiring its own explicit approval.

## Remaining release evidence

- A local Docker GM + 6 pass does not replace the real 30–45 minute browser
  rehearsal.
- Publishing the public GitHub repository does not deploy production.
- Do not mark the release ready until the fresh backup and exact-snapshot restore
  rehearsal have actually passed on the operator environment.
- Final automated release output is evidence only for scripted gates. It does
  not prove manual production acceptance or authorize marking the release Done.
