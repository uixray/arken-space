# Измерения UIX-408 / UIX-409 / UIX-450 — рунбук и результат

**Замер выполнен 24.08.2026.** Числа ниже. Рунбук сохранён, потому что
измерение придётся повторять при следующих изменениях рассылки, а половина
шагов неочевидна.

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

## Результат (24.08.2026, ревизия `8ec37be`)

Снято на восстановленной копии того же дампа, 1 GM + 6 PLAYER, 5 прогонов:

| Метрика              | До       | После             | Изменение  |
| -------------------- | -------- | ----------------- | ---------- |
| **Байт на рассылку** | 2 580 КБ | **868.2 КБ**      | **−66.3%** |
| Запросов на рассылку | 239      | 167               | −30.1%     |
| Время рассылки       | 872 мс   | 239 мс            | −72.6%     |
| Снапшот ГМ           | 692.9 КБ | 292.5 КБ          | −57.8%     |
| Снапшот PLAYER       | ~315 КБ  | 95.7 КБ (медиана) | −69.6%     |

Состав по полям:

| Поле         | До               | После            | Изменение |
| ------------ | ---------------- | ---------------- | --------- |
| `messages`   | 1 726 КБ (67.0%) | 178.8 КБ (20.7%) | −89.6%    |
| `fogReveals` | 443 КБ (17.2%)   | 372.6 КБ (43.1%) | −15.9%    |
| `drawings`   | 230 КБ (8.9%)    | 119.2 КБ (13.8%) | −48.2%    |

Требование UIX-450 «не меньше чем вдвое» выполнено: падение в 2.97 раза.

`fogReveals` стал крупнейшей статьёй, упав всего на 16%. Это согласуется с
поправкой из плана (§2.2): игрокам туман чужих сцен не уезжал и раньше — отсев
стоял в DTO, — поэтому сужение выборки дало экономию в основном мастеру.

### Что в этих числах надёжно, а что нет

- **Байты и количество запросов** детерминированы и сопоставимы напрямую.
- **Время** сравнивать осторожно: базовая линия могла сниматься на другом
  железе, поэтому «в 3.6 раза быстрее» — не точная величина.
- **Схема БД отличается от исходной.** Дамп 15.08 не содержит колонки
  `tokens.conditions`, добавленной более поздней миграцией, и текущий код на
  нём падает. Пришлось применить миграции к копии: «после» измерено на
  **данных** 15.08, но на **схеме** текущей ревизии. Иначе никак — старую схему
  новый код не читает.

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

Клон вне production:

```sh
mkdir -p ~/measure && cd ~/measure && git clone --depth 50 https://github.com/uixray/arken-space.git repo && cd repo && git checkout <REVISION> && corepack pnpm install --frozen-lockfile
```

**Сборка нужна.** Скрипт действительно импортирует `scripts/` и `apps/server/src`
напрямую, но `snapshot.ts` тянет `@arken/system`, а workspace-пакеты
экспортируются из `dist`. Без сборки — `ERR_MODULE_NOT_FOUND`.

Вложенные скрипты вызывают `pnpm` по имени, а corepack его в PATH не кладёт, из
за чего `pnpm build` падает с `sh: 1: pnpm: not found`. Локальный shim решает
это, ничего не меняя в системе и не требуя sudo:

```sh
mkdir -p ~/measure/bin && printf '#!/bin/sh
exec corepack pnpm "$@"
' > ~/measure/bin/pnpm && chmod +x ~/measure/bin/pnpm && cd ~/measure/repo && PATH="$HOME/measure/bin:$PATH" corepack pnpm build
```

**Миграции обязательны.** Дамп несёт схему на дату снимка; текущий код ожидает
более новые колонки и падает на `column ... does not exist`:

```sh
cd ~/measure/repo && DATABASE_URL=postgres://arken:measure-only-local@127.0.0.1:5544/arken PATH="$HOME/measure/bin:$PATH" corepack pnpm db:migrate
```

Замер:

```sh
cd ~/measure/repo && ARKEN_MEASURE_CONFIRM=isolated-copy ARKEN_MEASURE_CAMPAIGN_ID='<CAMPAIGN_ID>' ARKEN_MEASURE_GM_VIEWED_SCENE_ID='<VIEWED_SCENE_ID>' ARKEN_MEASURE_RUNS=5 DATABASE_URL='postgres://arken:measure-only-local@127.0.0.1:5544/arken' PATH="$HOME/measure/bin:$PATH" corepack pnpm exec tsx scripts/measure-broadcast.ts
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

## Параметры, использованные 24.08

Из восстановленной копии, для воспроизведения:

- кампания `f5bbc188-550a-4dee-ae04-e17f7a2b8e5e`;
- активная сцена `05282e64-6692-437f-a3d6-4b1eff8115cc`;
- неактивная сцена для ГМ `39b5db45-3918-456e-a580-9e1c7fc012ef`;
- состав: 1 GM + 6 PLAYER, 6 сцен — совпадает с базовой линией.

После замера копия удалена: контейнер снят, `/tmp/arken-measure` и `~/measure`
стёрты, production-контейнеры не перезапускались.

## Что мешало закрыть 24.08

Не отсутствие данных, а разрешения: исходящий `ssh` из рабочей сессии
блокировался, пока в `.claude/settings.local.json` не добавлено правило
`Bash(ssh:*)`. Сами данные и окружение к тому моменту были готовы.
