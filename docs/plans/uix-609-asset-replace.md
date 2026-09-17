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

## 2026-09-17 — missing replacement UI: client intent foundation (UIX-293)

Live UIX-293 is In Progress and still requires a user-facing replacement action.
UIX-610 is Done but its original criteria cover usage/delete, not replacement.
Current MediaPanel and AssetActions expose no replacement action. The server PUT
and ETag contract already exist; do not change storage/version policy or create
another issue to fill this gap.

New isolated asset-replacement.ts captures a fresh authenticated HEAD version
(no file download), selected File and one action ID in an immutable intent.
Missing/weak/malformed versions and HTTP failures fail closed with Russian text.
Cancellation retains its original reason. Commit sends multipart PUT with that
exact If-Match and action ID through the existing api helper. It never fetches
a newer version or retries automatically. An explicit retry of the same intent
keeps the same file/action ID; a409 remains a409 for the future review UI.
The response preserves replay and old-blob-cleanup flags.

13 new protocol tests plus30 unchanged api tests PASS (43 total,637ms,worker1),
web TypeScript and scoped ESLint/Prettier/diff PASS. Fetch is mocked; this is not
an executed HEAD/PUT server, browser, file replacement or finished UI acceptance.
No caller imports this module yet. No new dependency, backend change, build,
full suite, CI, publication or Linear write.

Next connected pool: integrate GM-only replacement review in the existing file
row using this intent, show existing usage/impact and selected replacement,
require explicit confirmation, retain the same intent after ambiguous transport
failure, require fresh review on version conflict, and distinguish committed
replacement from later catalog-refresh failure. Reuse ImageUploadField/
AudioUploadField without losing asset ID/name/kind; no force overwrite or
implicit retry. Add component and actual-App browser success/cancel/conflict/
retained-draft checks before claiming that masters can use the feature.

## 2026-09-17 — replacement review UI wired, browser gate pending

GM file rows now open a shared-modal replacement review. It uses the existing
image/audio intake controls, lists server usage, explains the irreversible content
change, and requires a separate confirmation after the version check. PLAYER rows
have no entry. File/intent freeze while reviewed or pending; changing the choice
requires a new review. A409 discards only the old intent, retaining the file;
ambiguous failure offers an explicit retry with the same intent/action ID.

Commit and catalog refresh are separate stable AssetActions. Acknowledged commit
moves to success before refresh; a thrown refresh failure never offers PUT again.
App's existing load catches its own errors and displays the global error; this
was not changed or misrepresented as a successful fresh catalog. The modal's
separate refresh warning covers rejected refresh callbacks. Cleanup-pending is
shown as maintenance, not failed replacement. Async callbacks after unmount are
ignored; pending preparation is aborted, and modal identity includes campaign,
actor and asset. No force overwrite or server contract changes.

Connected component gate16/16PASS10.53s (five new dialog scenarios, existing media
and action tests); then one additional action identity/commit-vs-refresh test plus
two existing hook tests3/3PASS1.52s. Web types and scoped lint/format/diff PASS.
Five action-context fixtures gained fail-fast stubs; their behavior tests were
not rerun. Dialog/intake controls are mocked in the five component cases: these
are lifecycle assertions, not Gravity portal/focus, actual decoding or browser QA.

Still required before feature acceptance: actual-App GM/PLAYER responsive browser
flow, cancel/pending/409/explicit retry; real backend HEAD/PUT integration; verify
already-mounted media consumers refresh after replacement. Current URLs in
assetDto/snapshot remain stable, so snapshot reload alone must not be assumed to
refresh rendered pixels/audio. No build/CI/release or full UIX-293 acceptance.
