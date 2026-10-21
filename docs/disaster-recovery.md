# Если сервер потерян: восстановление из локальной копии

Инструкция для владельца на случай, когда production-хост недоступен совсем:
провайдер удалил машину, потерян root-доступ, умер диск. Источник данных —
независимая зашифрованная копия на ноутбуке в `D:\ArkenBackups`, её делает
`infra/backup/copy-snapshot-local.ps1` из еженедельного снимка
`weekly-capture.sh`.

Пока старый сервер жив, эта инструкция не нужна: откат релиза и проверка копии
описаны в [production-release-checklist.md](production-release-checklist.md) и
[operations.md](operations.md#restore-rehearsal). Ничего из этого документа
не запускайте против работающего production.

## Что лежит в снимке

Каждый снимок `arken-service-snapshot-v1` — одна папка внутри restic:

| Путь                                                       | Что это                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `database.dump`                                            | `pg_dump --format=custom` базы кампании                                         |
| `database-counts.txt`                                      | число строк в каждой таблице на момент снимка — для сверки после восстановления |
| `migration-ledger.txt`                                     | журнал миграций (`id\|hash\|created_at`)                                        |
| `postgres-version.txt`                                     | версия PostgreSQL                                                               |
| `media/`                                                   | все загруженные файлы кампании                                                  |
| `images/server.tar`, `web.tar`, `postgres.tar`, `edge.tar` | точные образы всех четырёх сервисов, которые работали в момент снимка           |
| `config/`                                                  | compose-файл, override релиза, runtime env сервера, конфиг edge (nginx)         |
| `capture-manifest.json`                                    | sha256 каждого файла выше                                                       |

В `config/` лежат секреты сервиса (пароль базы, `GM_ACCESS_TOKEN`). Папку
восстановленного снимка не публикуйте, не кладите в Git и удалите после
восстановления.

**Чего в снимке нет:** TLS-сертификатов Let's Encrypt и DNS-записей. Их
придётся выпустить и настроить заново (шаги 6–7).

## Что нужно заранее

- Пароль локального репозитория `D:\ArkenBackups\repo` (он отдельный от
  пароля серверного репозитория).
- restic для Windows: `D:\ArkenBackups\bin`.
- Новый Linux-сервер amd64 с Docker и Docker Compose, не меньше 2 vCPU,
  4 ГБ RAM и 30 ГБ диска; доступ по SSH.
- Доступ к DNS домена `arken-khar.space`.

## 1. Выбрать снимок

```powershell
$env:RESTIC_REPOSITORY = 'D:\ArkenBackups\repo'
D:\ArkenBackups\bin\restic.exe snapshots
```

Restic спросит пароль. Возьмите самый свежий снимок и запишите его полный ID.
Квитанции копий лежат в `D:\ArkenBackups\receipts\`: `copiedSnapshotId` в
квитанции — это ID в локальном репозитории, `sourceSnapshotId` — ID того же
снимка на сервере.

## 2. Проверить копию и распаковать снимок

```powershell
D:\ArkenBackups\bin\restic.exe check --read-data
D:\ArkenBackups\bin\restic.exe restore <ID> --target D:\ArkenRestore
```

`check --read-data` читает весь репозиторий; при ошибке остановитесь и
возьмите предыдущий снимок. После распаковки найдите внутри
`D:\ArkenRestore` папку с `capture-manifest.json` — дальше это «папка
снимка».

Сверьте файлы с manifest (в папке снимка, нужен Node.js):

```powershell
node -e "const fs=require('fs'),c=require('crypto');const m=JSON.parse(fs.readFileSync('capture-manifest.json'));let bad=0;for(const f of m.files){const h=c.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex');if(h!==f.sha256){bad++;console.log('MISMATCH',f.path)}}console.log(bad?'FAIL':'OK',m.files.length,'files')"
```

Нужен ответ `OK`. Любой `MISMATCH` — снимок повреждён, возьмите предыдущий.

## 3. Перенести снимок на новый сервер

Скопируйте папку снимка целиком, например в `/opt/arken-space/recovery/`:

```powershell
scp -r <папка снимка> root@<новый-сервер>:/opt/arken-space/recovery/
```

Если входящий канал у нового провайдера медленный, режьте большие файлы
(`images/server.tar`) на части и передавайте параллельно, как в разделе
«Доставка параллельными частями» checklist релиза.

## 4. Загрузить образы и поднять базу

На новом сервере, в папке снимка:

```sh
cd /opt/arken-space/recovery/<папка снимка>
for f in images/*.tar; do docker load --input "$f"; done
mkdir -p /opt/arken-space/app && cp -r config /opt/arken-space/app/config
chmod 700 /opt/arken-space/app/config && chmod 600 /opt/arken-space/app/config/*
```

Откройте `config/compose.yml` и override релиза (`compose.release.override.yml`
или `compose.activation.override.yml`): в них прописаны image ID, имена
сервисов (`postgres`, `server`, `web`, `edge`), путь к env-файлу и том медиа.
Поправьте пути, если на новом сервере каталог другой. Image ID не меняйте:
`docker load` восстановил ровно те образы.

Поднимите **только** PostgreSQL и восстановите дамп в пустую базу:

```sh
docker compose -p arken-prod -f config/compose.yml -f config/<override> up -d postgres
docker compose -p arken-prod -f config/compose.yml -f config/<override> exec -T postgres \
  sh -c 'pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --exit-on-error --no-owner' \
  < database.dump
```

Сверьте счётчики таблиц с `database-counts.txt` тем же запросом, которым их
снимал capture, — `infra/backup/database-counts.sql`:

```sh
docker compose -p arken-prod -f config/compose.yml -f config/<override> exec -T postgres \
  sh -c 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-align --tuples-only --field-separator="|"' \
  < database-counts.sql > counts-restored.txt
diff database-counts.txt counts-restored.txt && echo COUNTS-OK
```

(`database-counts.sql` возьмите из репозитория той же ревизии.) Нужен ответ
`COUNTS-OK`.

## 5. Вернуть медиа и запустить сервис

Скопируйте `media/` туда, куда compose монтирует медиа сервера (смотрите
`volumes` у `server` и переменную `MEDIA_ROOT` в runtime env), сохранив
владельца и права файлов. Затем:

```sh
docker compose -p arken-prod -f config/compose.yml -f config/<override> up -d server web
curl -fsS http://127.0.0.1:4100/healthz
```

В ответе `buildRevision` и `schemaVersion` должны совпасть со снимком, а
`database` — быть `ok`. Сервер сам применит миграции, только если образ новее
журнала; при восстановлении того же образа журнал не меняется.

## 6. Edge, TLS и DNS

1. Направьте A-записи `arken-khar.space`, `www` и поддоменов игроков на новый IP.
2. Выпустите сертификаты: `infra/deploy/install-nginx.sh` показывает
   используемый порядок с certbot и webroot `/var/www/certbot`.
3. Поднимите edge с конфигом из `config/edge-nginx.conf` и проверьте
   `nginx -t`. Если на том же сервере живут ваши другие сайты
   (`uixray.tech` и т. п.), их конфиг тоже есть в этом файле, но их данных в
   снимке нет.

## 7. Проверить вручную

- `https://arken-khar.space/healthz` — та же ревизия и схема.
- Вход мастером и игроком по постоянным ссылкам.
- Карта и токены текущей сцены, журнал бросков, музыка и картинки из
  медиатеки открываются.
- `docker compose … restart postgres server web` — после перезапуска данные
  на месте.

После этого заново настройте еженедельный снимок
(`/opt/arken-space/backup-tools/weekly-capture.sh` из
[production-release-checklist.md](production-release-checklist.md#bb03-фактическая-схема-выкладки))
и удалите `D:\ArkenRestore` и папку `recovery` на сервере.

## Что уже проверено и что нет

- 14.10.2026: из `D:\ArkenBackups\repo` (снимок `7f26c96a…`) восстановлены база
  и медиа в изолированный контур: 309 файлов сверены по sha256, 71/71 таблиц
  совпали, захваченный образ сервера поднялся с health `6db32f2d` / schema 60.
  Это шаги 1–5 в проверочном раннере `scripts/run-restore-rehearsal.mjs`
  (`RESTORE_FORMAT=service-v1`, `ARKEN_ISOLATED_ONLY=true`).
- Шаги 6–7 (новый хост, DNS, TLS, вход людьми) целиком ещё не репетировались.
