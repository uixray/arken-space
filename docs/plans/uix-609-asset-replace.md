# UIX-609 — атомарная замена asset

## Цель

Заменять содержимое существующего asset без изменения `assets.id` и без
разрушения ссылок. Операция доступна только GM своей кампании, идемпотентна по
`actionId` и не должна оставлять metadata, указывающую на отсутствующий blob.

## Решения

### Версия и cache

- Отдельная миграция `assets.revision` не нужна: текущий `storageKey` уже
  меняется при каждой записи и остаётся серверной деталью.
- Публичный version token — SHA-256 от `storageKey`; исходный ключ из API и
  audit не выдаётся.
- `GET /api/assets/:id/content` возвращает этот token как `ETag`, использует
  `Cache-Control: private, no-cache` и отвечает `304` при совпавшем
  `If-None-Match`. Поэтому стабильный URL переиспользует cache, но всегда
  перевалидирует его после замены.
- Replace требует `If-Match` текущего ETag. Несовпадение даёт bounded `409
ASSET_VERSION_CONFLICT`.

### Commit protocol

1. Проверить auth, GM, asset кампании, `actionId`, `If-Match` и тип файла.
2. Прочитать/валидировать upload, вычислить SHA-256 содержимого и проверить
   idempotent replay до записи нового blob.
3. Проверить итоговую quota как `used - old.sizeBytes + incoming`, а свободное
   место — с учётом временного сосуществования обоих blobs.
4. Записать новый blob под новым opaque key.
5. В транзакции заблокировать asset `FOR UPDATE`, повторно проверить version,
   заменить metadata и записать `asset.replaced` без storage keys.
6. После commit удалить старый blob best-effort. Ошибка оставляет только
   недоступный orphan и возвращается как `oldBlobCleanupPending: true`.
7. При отказе до commit удалить новый blob. Старый asset остаётся рабочим.

Crash между записью blob и rollback может оставить orphan, но никогда не
создаёт битую ссылку. Его сборка остаётся отдельной housekeeping-задачей.

## Replay

Audit payload хранит `assetId`, предыдущий и новый version token, SHA-256
контента и безопасные metadata. Exact `actionId` + asset + content hash
возвращает текущий результат. Повтор того же `actionId` с другим asset или
содержимым даёт `409 ACTION_ID_REUSED`.

## Проверка

- focused HTTP integration: GM success, exact replay, reused intent, stale
  `If-Match`, PLAYER, foreign campaign, blob cleanup и content revalidation;
- unit для version/commit policy только если логика будет вынесена в чистый
  модуль;
- обязательная диверсия одного нового integration assertion;
- полный project gate один раз в конце общего asset-lifecycle пула.

## Не входит

- UI медиатеки — UIX-610;
- история всех версий blob и восстановление старой версии;
- force-delete используемых файлов;
- production deploy.

## Checkpoint — 2026-09-02

- **Решение:** ID ассета остаётся стабильным; версия содержимого — закрытый ETag
  от `storageKey`; замена требует `If-Match` и `x-action-id`.
- **Ревизия:** `5a0d893` (реализация `ffe9c74`, реестр изоляции `5a0d893`).
- **Изменено:** `asset-lifecycle.ts`, `asset-usage.ts`, `routes.ts`, HTTP-тесты,
  реестр UIX-413 и счётчик маршрутов в архитектуре.
- **Проверка:** format/lint/typecheck/build PASS; Vitest 209 файлов / 1688 тестов
  PASS; multiplayer 3 PostgreSQL probe + 2 Playwright PASS; cleanup и leak-check
  PASS. Диверсия дала ровно 1 failed / 12 passed, после возврата 13/13 PASS.
- **Блокеры:** нет. Ветка локальная, push/PR/merge не выполнялись.
- **Дальше:** UIX-610 — клиентское использование API usage/delete/replace без
  правок конфликтных файлов Claude.

## Checkpoint — 2026-09-08, подготовка acceptance-пула

- **Решение:** усилить существующий реальный HTTP/PGlite-тест, не менять
  production-код, API, миграции, таймауты или конфигурацию проверок.
- **Ревизия:** база `3f6b7c4`, ветка `codex/uix-609-replacement-acceptance`;
  изменения пока не закоммичены и не опубликованы.
- **Изменено:** только `tests/asset-lifecycle-http.integration.test.ts` и этот
  план. Новых media fixtures нет: AUDIO использует существующий собственный
  `tests/multiplayer/uix642-synthetic-tone.ogg` (Vorbis, 0.7 s).
- **Подготовленные проверки:**
  - atomic replace сохраняет ID, campaign, uploader, kind, name, createdAt и
    публичный URL; обслуживает новые байты с новым ETag;
  - ровно один receipt кампании/actionId содержит точный безопасный payload;
    SHA-256 считается от входного PNG, а не от преобразованного WebP;
    storage keys и приватный путь отсутствуют в audit и ответе;
  - exact replay не меняет metadata, receipt и полный список файлов с хешами;
    stale/reused intent и foreign request также не меняют этот результат;
  - реальные MAP→scene/world map, TOKEN→definition/placement,
    PORTRAIT→character, IMAGE→character gallery/world content cover/media,
    AUDIO→campaign audio track сохраняют полные relation rows, включая ID,
    ревизии и timestamps, при реальной HTTP-замене файла;
  - временный `BEFORE INSERT` trigger на `game_events` отклоняет только
    `asset.replaced` заданного actionId после проверки уже изменённого
    `assets.storage_key`. Уникальная sequence фиксирует достижение этого
    участка вне rollback. После HTTP 500 проверяются исходная полная asset row,
    старые disk/GET bytes, ETag, полный file inventory и отсутствие receipt;
    trigger/function/sequence удаляются в `finally`, затем тот же actionId
    успешно выполняется с `replayed: false`.
- **Границы доказательства:** AUDIO повторно загружает те же корректные Ogg
  bytes под новым ключом/ETag и проверяет реальный parser/duration; это не
  проверка смены композиции или слышимого browser playback. Изображения дают
  новые PNG→WebP bytes, а не визуальную приёмку картинки. Инъекция отказа audit
  проверяет DB rollback и cleanup уже записанного нового blob, но не физический
  отказ диска, crash-gap, конкурентные процессы или production.
- **Проверка:** тесты, browser QA, lint/typecheck/build ещё не запускались в
  этом пуле; PASS не заявляется. Production/Linear не изменялись.
- **Уточнение прежней диверсии:** запись от 02.09 выше историческая; изменение
  ожидания теста не подтверждает чувствительность к дефекту production-кода и
  не засчитывается как текущий negative gate. Следующая диверсия должна менять
  только ветку `If-None-Match` в `routes.ts` с `304` на `200` против неизменного
  HTTP-теста; затем нужен побайтовый возврат source и повторный PASS.
- **Блокеры / дальше:** root выполняет единый pooled gate после freeze,
  указанную source-диверсию и проверку восстановления. До этого UIX-609 не
  объявляется принятой или готовой к публикации по этому checkpoint.
