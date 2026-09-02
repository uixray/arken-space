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
