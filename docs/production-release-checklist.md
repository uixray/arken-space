# Production release checklist

This checklist prepares and verifies a release. It is not evidence that backup,
restore, deployment, the human GM + 6 rehearsal, or final manual production
acceptance has passed.

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
corepack pnpm test:e2e
corepack pnpm test:multiplayer
```

GitHub `checks` дополнительно запускает `sh -n` для `release.sh`,
`build-and-start.sh` и `smoke-auth.sh`; structural unit-тесты не заменяют parser
POSIX shell.

`pnpm typecheck` includes `tests/e2e/tsconfig.json`; Playwright remains at
`workers: 1` because the specs share one campaign/database. Preserve the exit
code of each command. In particular, do not pipe Playwright into a trailing
`grep`: without `pipefail` a failed browser run can look green. `format:check`
is the read-only gate; running the writing `pnpm format` is not equivalent
evidence.

## The scripted host path (preferred)

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
