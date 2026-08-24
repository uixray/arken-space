# Измерения UIX-408 / UIX-409 / UIX-450 — рунбук и состояние на 24.08.2026

Единственный незакрытый blocker трёх Urgent-задач — числа «после» на той же
копии данных, на которой снята базовая линия. Этот файл фиксирует, что уже
подготовлено и какие шаги остались, чтобы следующий заход не начинался с
разведки.

## Зачем это нужно

Acceptance требует сравнимых до/после:

- **UIX-408** — размер снапшота ГМ измерен до и после;
- **UIX-409** — количество запросов к БД на одну рассылку до и после;
- **UIX-450** — байт на рассылку падает не меньше чем вдвое, «замер тем же
  скриптом на том же дампе».

## Базовая линия (уже есть)

Снята 15.08.2026 и записана в UIX-450. Пересчитывать её не нужно:

| Метрика (ГМ + 6 игроков, одна рассылка) | Значение |
| --------------------------------------- | -------- |
| Запросов на рассылку                    | 239      |
| Байт на рассылку                        | 2 580 КБ |
| Время рассылки                          | 872 мс   |
| Снапшот ГМ                              | 692.9 КБ |

Состав: `messages` 1 726 КБ (67%), `fogReveals` 443 КБ, `drawings` 230 КБ.

## Что уже подготовлено на сервере

- **Дамп найден.** В локальных бэкапах `/home/uixray/apps/arken-space-data/backups`
  его уже нет — retention оставил только 22–24 августа. Но в restic он
  сохранился: снапшот **`7198f062`** от `2026-08-15T06:57:38`, что точно
  соответствует `arken-20260815T065736Z`. Значит сравнение будет честным.
- **Дамп восстановлен** в `/tmp/arken-measure/home/uixray/apps/arken-space-data/backups/`,
  1.4 МБ, владелец `uixray`. Медиа намеренно не восстанавливались.
- Production не затронут: боевые контейнеры работают, каталог приложения не
  изменялся.

> Если к работе вернутся нескоро, эту копию боевых данных стоит удалить:
> `rm -rf /tmp/arken-measure`. Восстановить её заново — одна команда, она ниже.

## Фактические параметры окружения

Проверено, а не предположено:

| Что                | Реальность                                                             |
| ------------------ | ---------------------------------------------------------------------- |
| Хост               | `51.250.26.16`, пользователь `uixray`                                  |
| Ключ               | `id_ed25519` — **не** `ssh-key-arken`, тот сервер отвергает            |
| Docker             | `uixray` не в группе docker, нужен `sudo` (он без пароля)              |
| PostgreSQL         | нативные `psql`/`pg_restore` есть; нативный сервер на 5432 не отвечает |
| Свободный диск     | 9.5 ГБ из 39 — с запасом                                               |
| restic credentials | `/etc/arken-space/restic.env`, root, режим 600 — только через `sudo`   |

## Правила, которые нельзя нарушать

1. **Мерить на боевой базе нельзя.** `measure-broadcast.ts` в пути чтения
   вызывает `normalizeAudioTrackDeadlines`, который **пишет** в БД. Отсюда
   обязательный `ARKEN_MEASURE_CONFIRM=isolated-copy` и проверка, что хост
   подключения — loopback.
2. **Production-каталог `/home/uixray/apps/arken-space` не трогать.** Никакого
   `git pull` там: следующий рестарт подхватил бы чужой код. Работать в
   отдельном клоне.
3. Изолированный PostgreSQL публиковать **только на `127.0.0.1`** и на
   нестандартном порту.

## Шаги

Восстановить дамп (если `/tmp/arken-measure` уже удалён):

```sh
mkdir -p /tmp/arken-measure && sudo sh -c "set -a; . /etc/arken-space/restic.env; set +a; restic restore 7198f062 --target /tmp/arken-measure --include /home/uixray/apps/arken-space-data/backups/arken-20260815T065736Z.dump" && sudo chown -R uixray:uixray /tmp/arken-measure
```

Поднять изолированную БД. Пароль одноразовый и виден только на loopback:

```sh
sudo docker run -d --name arken-measure-db -e POSTGRES_DB=arken -e POSTGRES_USER=arken -e POSTGRES_PASSWORD=measure-only-local -p 127.0.0.1:5544:5432 postgres:17-alpine
```

Восстановить копию:

```sh
cd /tmp/arken-measure/home/uixray/apps/arken-space-data/backups && sudo docker cp arken-20260815T065736Z.dump arken-measure-db:/tmp/dump && sudo docker exec arken-measure-db pg_restore -U arken -d arken --no-owner --no-privileges /tmp/dump
```

Проверить, что сценарий подходит — скрипт требует ровно 1 GM + 6 PLAYER.
Запрос печатает только идентификаторы и счётчики, без игровых данных:

```sh
sudo docker exec arken-measure-db psql -U arken -d arken -tAc "select c.id, c.active_scene_id, (select count(*) from memberships m where m.campaign_id=c.id and m.role='GM'), (select count(*) from memberships m where m.campaign_id=c.id and m.role='PLAYER') from campaigns c;"
```

Взять неактивную сцену той же кампании:

```sh
sudo docker exec arken-measure-db psql -U arken -d arken -tAc "select id from scenes where campaign_id='<CAMPAIGN_ID>' and id is distinct from '<ACTIVE_SCENE_ID>' limit 1;"
```

Клон вне production и измерение. Сборка не нужна: скрипт импортирует
`packages/db/src` и `apps/server/src` напрямую и запускается через `tsx`:

```sh
mkdir -p ~/measure && cd ~/measure && git clone --depth 50 https://github.com/uixray/arken-space.git repo && cd repo && git checkout dfe39b1 && corepack pnpm install --frozen-lockfile
```

```sh
cd ~/measure/repo && ARKEN_MEASURE_CONFIRM=isolated-copy ARKEN_MEASURE_CAMPAIGN_ID='<CAMPAIGN_ID>' ARKEN_MEASURE_GM_VIEWED_SCENE_ID='<VIEWED_SCENE_ID>' ARKEN_MEASURE_RUNS=5 DATABASE_URL='postgres://arken:measure-only-local@127.0.0.1:5544/arken' corepack pnpm exec tsx scripts/measure-broadcast.ts
```

Убрать за собой:

```sh
sudo docker rm -f arken-measure-db && rm -rf /tmp/arken-measure ~/measure
```

## Оговорка о сопоставимости

Текущий скрипт печатает медианы по 5 прогонам и делает прогрев, а базовая линия
15.08 снималась его более ранней версией. Порядок величин и пропорции
сопоставимы, но расхождение в единицы процентов может объясняться методикой, а
не кодом. Если это окажется важно, «до» можно переснять на ревизии `7e441a4` в
отдельном клоне на той же копии базы.

## Что мешало закрыть 24.08

Не отсутствие данных, а разрешения: исходящий `ssh` из рабочей сессии
блокировался, пока в `.claude/settings.local.json` не добавлено правило
`Bash(ssh:*)`. Сами данные и окружение к тому моменту были готовы.
