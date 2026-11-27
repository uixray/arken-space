# Автономная игра: первый архитектурный пул

Дата: 22.11.2026. Владелец поручил начать вторую задачу из оставшегося списка;
это новое указание имеет приоритет над прежним откладыванием задачи.

## Что уже существует

| Область | Источник | Вывод |
|---|---|---|
| Игровая authority | apps/server/src/realtime.ts, routes.ts, snapshot.ts | Команды и роль-фильтрованная проекция принадлежат серверу |
| База | packages/db/src/schema.ts, pglite.ts | Есть SQL-модель и persistent локальный вариант; PGlite нельзя считать эквивалентной заменой production PostgreSQL без проверки |
| Локальный хост | server-runtime.ts, local-host-identity.ts, local-host-web.ts | Уже есть владелец инстанса, отдельная идентичность и loopback-only режим |
| Доступ игрока | auth.ts, campaign-route.ts, snapshot.ts | Нельзя передать игроку полный дамп кампании вместо проекции |
| Транспорт | apps/web/src/realtime.ts, api.ts | Socket.IO и HTTP сейчас привязаны к origin; подмена только socket оставит HTTP-команды в облаке |
| Доставка | gameEvents, actionJournal, action IDs/revisions | Уже есть идентификаторы действий; это не готовый outbox для двух независимых баз |
| UX | ConnectionNotice.tsx, use-game-socket-subscriptions.ts | Reconnect/resync есть; подключённый сокет ещё не означает готовность игрового состояния |

## Предварительное решение

Переиспользовать независимый Node/Fastify runtime и существующую SQL-модель,
web-клиент оставить общим. Окончательный выбор local storage делается после
проверки нужных SQL-функций/триггеров/миграций. Windows launcher — оболочка,
не новое игровое ядро. Реализация не должна требовать WinAPI от протокола.

| Вариант оболочки | Польза | Цена/риск | Решение этого пула |
|---|---|---|---|
| Отдельный локальный сервис + web | Переиспользует действующий Fastify/HTTP/Socket.IO | Нужны безопасный lifecycle, origin, pairing и установка runtime | Базовый путь исследования |
| Tauri | Может упаковать web UI и внешние binary | Добавляет Rust/sidecar lifecycle и различия webview | Кандидат оболочки позже |
| Electron | Общая web/Node экосистема | Дополнительная desktop security surface и обновление bundled runtime | Кандидат, не добавлен |

Основания по возможностям оболочек: [Tauri](https://v2.tauri.app/start/),
[безопасность Electron](https://www.electronjs.org/docs/latest/tutorial/security).
Это архитектурное предпочтение по исходникам, а не измеренный spike packaging.

Для первого browser transport выбран кандидат WebRTC DataChannel:
[стандарт W3C](https://www.w3.org/TR/webrtc/) определяет data channels,
negotiation и ICE. Наличие API не доказывает прохождение NAT или работу
в фоне на телефоне. libp2p/Iroh и независимый discovery требуют отдельного
сравнения в этой же задаче до окончательного выбора сети.

## Защита от split-brain

Транспорт и authority разделены. Идентичность активной сессии:
campaignId + sessionId + hostId + epoch. Смена CLOUD/DIRECT/RELAY/LAN не меняет
эти значения. Потеря облака не назначает нового мастера. Возврат облака не
разрешает ему начать второй поток записей. Передача authority должна быть
отдельной атомарной операцией с fencing и проверкой сохранённого checkpoint.

Добавлен чистый route-policy: допускает только ready/authenticated route
с той же authority и согласованным checkpoint; при расхождении требует resync.
Сохраняет текущий маршрут пока он пригоден, чтобы не переключаться туда-сюда.
Это политика выбора, не аутентификация: evidence создаётся доверенным
application handshake, а не заявлением пира или событием DataChannel.open.

## Реализованный изолированный канал

apps/web/src/local-first/peer-probe.ts создаёт RTCPeerConnection и ordered
reliable channel. Поддерживает offer/answer, trickle ICE, bounded PING/PONG,
один pending запрос, timeout, backpressure и cleanup. Он не отправляет
игровые snapshot, команды, cookie, ключи или секреты кампании.

SDP/candidates передаются вызывающим кодом через доверенный signaling;
публичный STUN/TURN не подключается автоматически. Обмен ICE может раскрывать
сетевые метаданные. Успех PING означает только достижимость конкретного канала,
не удостоверяет личность мастера, не разрешает играть и не служит E2EE-чату.
Прототип изолирован от основного клиента до авторизованного pairing.

## Следующие связанные пулы этой задачи

### Постоянная authority и pairing — второй кодовый пул

Добавлен server-only local-session-authority.ts и миграция 0095.
Authority хранится на кампанию с host/session/epoch; ротация по expectedEpoch
аннулирует прежние pairing и credentials. Создать/повернуть её может только
действующий GM, чей user совпадает с владельцем LOCAL_HOST инстанса.
Одноразовый pairing привязан к уже одобренному PLAYER membership и device UUID,
срок 5 минут. В БД только SHA-256 случайного 256-bit bearer secret.
Погашение под campaign lock создаёт 12-часовую credential; повторное погашение
отклоняется. Отзыв устройства удаляет приглашение и отзывает credential.

withLocalPeer проверяет epoch/session, membership и отзыв в той же SQL-транзакции,
в которой доверенный gateway должен исполнять команду. Иначе между проверкой
и записью возникнет TOCTOU. Все операции берут общий campaign row lock.
Секреты возвращаются один раз; их нельзя логировать, класть в URL или передавать
по неподтверждённому signaling. Это bearer pairing, не криптографическая
проверка физического устройства и не независимая E2EE-идентичность друга.

Модуль пока server-only: публичные endpoints не регистрируются до готовности
доверенного gateway/pairing UI. LOCAL_HOST loopback gate прежний. Миграция
подготовлена, не применена; storage таблицы SQL-only, без новых ORM exports.
Для будущего gateway запретить обход withLocalPeer и применять прежние
action-id/idempotency и role-filtered snapshot policies; credential сама по
себе не разрешает произвольный SQL, GM-действия или передачу полного snapshot.

1. **Identity/pairing/fencing:** связать cloud membership с локальной сессией
   и устройством мастера, выдать ограниченный доступ, реализовать отзыв;
   отделить локальные и cloud credentials. Не открывать текущий loopback API
   всем адресам ради удобства LAN.
2. **Локальная authority:** атомарный журнал/outbox в той же транзакции,
   полный GM import/export, медиа, миграции и безопасное восстановление.
   Дубликаты, RNG и ревизии обрабатывает одно ядро, не браузерный плеер.
3. **Player transport gateway:** общий dispatcher HTTP и socket команд,
   role-filtered персональные snapshots, ограничение очередей/размера,
   sequence/ACK/replay protection и предустановленный резервный канал.
4. **Failover/reconciliation:** привязать route-policy к подтверждённой
   authority, перенести незавершённые action IDs без слепого повтора;
   восстановить cloud как реплику, затем отдельный handover.
5. **Сеть и чат:** независимый bootstrap/relay, NAT/reconnect, локальные
   очереди сообщений, vetted E2EE protocol и store-and-forward с TTL/квотами.
   Гарантия доставки offline-получателю требует доступного узла хранения.
6. **UX/упаковка:** явные direct/relay/LAN/waiting/resync состояния;
   platform matrix, Windows packaging reuse, затем macOS/Linux/PWA ограничения.

## Свидетельства

### Интерфейс и транспорт — 26.11.2026

В меню мастера добавлено окно LocalSessionPanel по capability localSessionBridge
из role-filtered snapshot. Оно запрашивает состояние при открытии, запускает
сессию, выдаёт код конкретному PLAYER/device и отзывает устройство.
Остановка всех подключений требует подтверждения. Код только в памяти:
скрывается при закрытии/смене получателя и через5минут. Поздний ответ закрытого
окна не показывает секрет. Owner запросы привязаны к campaign/membership.

Добавлены bounded DataChannel RPC и session-channel adapters: reliable ordered
channel, UTF-8/base64 chunks8KiB, request32KiB/response8MiB, один in-flight,
backpressure и timeout без автоматического повтора возможного commit.
Повреждённые/чужие/out-of-order frames закрывают канал. Peer error не содержит
SQL/credentials. Host adapter привязывает канал к campaign/device/session/epoch
и вызывает только loopback redeem/peer. Player проверяет authority/recipient,
держит credential только в памяти и очищает при закрытии/истечении.

Открытый объём: signaling/ICE/TURN, привязка к живому snapshot/move loop,
preview, остальные команды, медиа и cloud-reconciliation. Доверенный обмен
SDP/fingerprint — предусловие adapters, не готовая независимая identity/E2EE.

Приёмка пула:15 unit/DOM/PGlite tests — owner CAS, one-time pairing, hash-only
storage, pairing expiry, revoke/epoch, rollback, TOKEN_MOVE без дублей/подмены
и без GM-only объекта в ответе; bounded RPC и поздний UI response.
Не доказывает межпроцессный PostgreSQL locking или все категории секретов.

Browser fixture: реальные компоненты и production ThemeRoot, mock control-plane
ответы, не реальная кампания. Chromium151/Playwright1.62:1365×1000 и390×844,
просмотр screenshots, bounds и Axe WCAG A/AA для диалога. Первый harness
оказался без ThemeRoot/непрозрачной поверхности — исправлен fixture,
добавлен opaque-surface assert. Две настоящие вкладки проверили reliable WebRTC
с крупным Unicode echo. Это transport proof, не игровая GM+PLAYER сессия
и не свидетельство WAN/NAT/mobile background performance.

### Возобновление здесь и локальный gateway — 22.11.2026

Владелец вернул разработку автономного режима в этот чат. Подготовленный
gateway подключён к server-runtime через registerLocalSessionRoutes, отдельно
активируется LOCAL_SESSION_BRIDGE_ENABLED=true только в LOCAL_HOST.
По умолчанию false. Историческое указание выше об отсутствии endpoints
описывает второй пул; текущая реализация содержит следующий control plane:

| POST endpoint | Назначение |
|---|---|
| /api/local-session/status | Авторизованный владелец узнаёт текущую authority/последний epoch |
| /api/local-session/start | Owner-only CAS start/rotation |
| /api/local-session/stop | Owner-only остановка и отзыв всех peer credentials |
| /api/local-session/pairings | Одноразовое приглашение одобренного PLAYER/device |
| /api/local-session/redeem | Погашение bearer pairing в credential |
| /api/local-session/revoke | Отзыв конкретного PLAYER/device |
| /api/local-session/peer | Авторизованный SNAPSHOT или TOKEN_MOVE |

Все маршруты ограничены origin, no-store и rate/body limits; loopback bind,
Host и remote-address gate в server-runtime сохранены. Ошибки этой группы
обрабатываются как чувствительные, без SQL/секретов в диагностике/ответе.
Они пока не дают удалённому игроку HTTP-доступ: сетевой P2P gateway/сигналинг
и экран подключения — отдельный оставшийся пул.

Токен перемещается через общий commitTokenMove, выделенный из прежнего
Socket.IO handler без второй реализации записи. Перед командой gateway
проверяет актуальные контроллеры/видимость/сцену и ревизию через editableToken;
прежние movement/floor/stair правила, журнал undo и gameEvents сохранены.
local_command_receipts (миграция0096, теперь зарегистрирована в journal)
записывает action ID, hash канонической команды и sequence в той же транзакции.
Повтор возвращает DUPLICATE, подмена payload/actor/device отклоняется.
При переходе со старого маршрута сравниваются actor/type/entity/revision/payload.
После команды возвращается свежий role-filtered snapshot, а не сохранённый
ACK с прежними правами. После commit обычные локальные socket-клиенты получают
обновление через существующий broadcastSnapshots; ошибка уведомления не
выдаётся за откат уже совершённой записи.

Общие authority/peer/ACK типы и request schema вынесены в contracts.
Это ограниченный первый command gateway, а не полная реализация всех игровых
команд: чат, броски, realtime preview, медиа и DataChannel framing ещё впереди.
Миграции0095/0096 подготовлены, не применены; флаг реально не включался.

Первый пул выполнен по исходникам. Код WebRTC, маршрутизация и packaging
не исполнялись, тесты/сессии не запускались по текущему указанию владельца.
Нет доказанной отказоустойчивости, E2EE, cloud-sync или готовой локальной
мультиплеерной сессии. Задача остаётся In Progress; production не менялся.

## Исполняемое продолжение, 26.11.2026 — media/shared App/chat

Эта запись обновляет статус более раннего source-only этапа выше. Реализованы
ручные trusted offer/answer для native WebRTC, экран PLAYER /local-session до
cloud auth и адаптер общего App (не отдельный renderer). Bootstrap/snapshot,
TOKEN_MOVE, STORY_PAGE, ASSET_CHUNK и CHAT_SEND проходят local authority fence.
Медиа: общий с HTTP resolveReadableAsset; bounded128KiB части, pinned version и
SHA256; memory-only Blob projection с отзывом URL и очисткой по выходу/ошибке.
Текущие защитные пределы100MiB/file и256MiB/session; отдельное world-map storage
пока требует собственного media route. Снимки не передаются из GM браузера:
loopback backend строит текущую разрешённую проекцию PLAYER.

Обычный stream chat вынесен в общий submitStreamChat для HTTP/P2P. Campaign row
lock и action ID/actor/type/thread/body/visibility/character match защищают
повторы/подмену. HTTP сохраняет201/200/broadcast, конфликт409, ACL403/404.
Только известные domain errors преобразуются в публичные коды. Вызов peer идёт
внутри той же authority/revoke транзакции; после commit вызывается существующее
обновление проекций. Личные диалоги, вложения и независимый от GM E2EE чат этим
пулом не объявлены реализованными.

Фактические доказательства и точные логи: .qa-temp/final-release-20261126,
POOL4-WIP-CHECKPOINT.md, POOL5-CHECKPOINT.md и POOL6-CHECKPOINT.md. PGlite/disk
покрывают authority/media/chat ACL и idempotency. Chromium2tabs покрывает native
ручной handshake, общий App, реальные raster pixels на canvas, mobile journal,
CHAT_SEND из UI и выход с6.5s ожиданием; backend браузерного сценария синтетический
mock и не доказывает серверные права (они проверены отдельно). Диагностика и
саундпад теперь используют fence, cloud requests в указанном lifecycle отсутствуют.

Остаток полного объёма: остальные canonical игровые команды/броски, realtime
preview (включая выход за fog), world-map media, cached/offline client,
cloud/P2P автоматическое переключение и reconciliation, independent identity,
E2EE/GM-offline messaging, WAN/NAT/relay, platform/install/restore и release QA.
Задача In Progress; частичная сетевая сессия не заменяет эти критерии.

### Броски через общий серверный pipeline, 26.11.2026

submitDiceRoll выделен из HTTP /api/dice и используется peer DICE_ROLL. RNG,
формула/режимы/semantic outcome/style frame сохранены в существующих dice helpers.
Весь read/ACL/RNG/write выполняется через один transaction handle под campaign
fence; актуальный персонаж повторно читается под row lock перед вычислением.
В event payload хранится serverCommandHash канонического запроса (не включается
в DTO/сообщение). Replay требует совпадения actor/type/hash до вызова RNG;
подмена409. У старых events без fingerprint точный intent недоказуем: повтор
fail-closed409, не новый бросок и не ложный DUPLICATE. HTTP сохраняет201/200,
400 INVALID_DICE_FORMULA,403 CHARACTER_FORBIDDEN и обычный room broadcast.
Peer возвращает текущую role-filtered projection; приватный бросок не появляется
у другого игрока. Это free-dice; skill/ability roll commands требуют общего
pipeline отдельно. Evidence и остаток в POOL7-CHECKPOINT.md.

### Получение movement previews в прямой сессии, 26.11.2026

Socket.IO token:moving использует общий prepareTokenPreview с прежними ACL,
revision/scene/isometric/fog/epoch проверками. Для включённого LOCAL_HOST bridge
валидированные hints попадают в process-memory buffer (128/campaign,256campaigns,
TTL3s). Durable game log/история не меняются. Thin PREVIEW_POLL через loopback
previews route и DataChannel возвращает только recipient-filtered события под
withLocalPeer revoke/authority fence. Fog/контроллеры/слои/ревизия/epoch повторно
проверяются в момент чтения; скрытый переход выдаёт HIDDEN без новых координат,
GM-only token ID не раскрывается. Утрата burst/cursor/epoch требует snapshot
resync, не воспроизведения старого drag. Клиент polls120ms без перекрытия с
канонической очередью; EOF/ошибка идёт обычным offline состоянием.

Свежий hint сохраняется поверх periodic canonical snapshot до750ms, пока та же
placement revision/scene/epoch и token ещё разрешён; это устраняет snapback между
кадрами. Передача от PLAYER в обратную сторону и общий финальный GM+2PLAYER
end-to-end сценарий ещё требуются. Browser native DataChannel + raster centroid
проверил два промежуточных положения и последующее скрытие; backend этого
browser fixture synthetic mock, серверная фильтрация проверена отдельно PGlite.
Точные evidence и baseline failures в POOL8-CHECKPOINT.md.

### Реальная связанная проверка PostgreSQL/GM+2PLAYER — 26.11.2026

Текущие authority/peer/media/chat/free-dice/preview/move прошли связанный native
Chromium-прогон с настоящими Fastify/Socket.IO и PostgreSQL18.1, без mock backend.
97 миграций применились к новой изолированной базе под production LOCAL_HOST env
gates. GM имеет штатную ACCOUNT game session, PLAYER два раздельных контекста
без cookies. Подтверждены промежуточные позиции A→B, fog disappearance, один
commit/revision1, отсутствие GM marker в PLAYER projection, revokeA и дальнейшие
chat/diceB. Протокол/скрины/ограничения — POOL10-CHECKPOINT.md и JSON report.
Это loopback, не WAN/physical-device/failover/E2EE/upgrade/restore qualification;
парольный login и production packaging требуют отдельного полного RC-сценария.
Изолированный QA PostgreSQL штатно остановлен, данные существующих баз сохранены.

### Личные сообщения и загрузка изображений по прямому каналу — 27.11.2026

Общие HTTP/peer-команды обеспечивают диалоги, историю, прочитанное, строгий replay
и participant-only чтение файлов. Игрок отправляет файл существующим fileinput:
16KiB chunks, device/session/epoch ACL на каждом запросе, source SHA256,
bounded host RAM/TTL, реальная серверная image validation/WebP и staging.
Миграция0097 сохраняет финальный receipt атомарно со staging; точный replay
возвращает прежний файл. Это ACL, не E2EE. Незавершённые чанки не персистятся.
Пул13: 57 связанных тестов; native GM+2PLAYER PostgreSQL/WebRTC browser PASS,
реальный PNG49456bytes→128×128 Blob в штатном чате, GMhistoryempty/file404,
исправленная ширина composer подтверждена скрином. Exact hashes и ограничения:
.qa-temp/final-release-20261126/POOL13-CHECKPOINT.md. Полный автономный scope
(все команды, offline/failover/identity/E2EE/relay/platforms) остаётся в работе.

### Перезарядка способностей — 27.11.2026

HTTP и прямой канал используют один транзакционный rechargeCharacterEntry:
права/ревизия под блокировками, clock anchors, GM-only creation restriction,
атомарные uses+systemmessage+receipt и actor/request-bound replay. ENTRY_RECHARGE
вызывается существующим APIaction без cloudfetch. Связанный набор57/57;
границы evidence и legacyreceipt policy — POOL14-CHECKPOINT.md. NativeRCпрогон
новых байтов ещё предстоит вместе с оставшимися игровыми командами.

### Навыки и способности в прямом канале — 27.11.2026

ENTRY_ROLL и прежний HTTP используют executeCharacterEntry: общие RNG/модификаторы,
executeAll/SHARE/activation, цена/uses, creation guards/consumption и undoReceipt.
Права и receipt читаются под транзакционной блокировкой до RNG; подтверждённый
точный повтор не бросает и не списывает заново, changed-payload получает409.
130 связанных tests и contracts/server/web tsc прошли на финальных байтах.
NativePG/WebRTC/visual приёмка новых действий ещё предстоит; ограничения и
exacthashes в .qa-temp/final-release-20261126/POOL15-CHECKPOINT.md.

### Ресурсы, кошелёк и отдых в прямом канале — 27.11.2026

CHARACTER_COUNTERS использует общий с HTTP updateCharacterCounters: права,
ревизия/полный requesthash, отдельные SP/inspiration ledgers, scoped rest/recharge,
wallet aggregation и атомарный журнал. Точный повтор возвращает актуальный
CharacterDto и исходную sequence без повторного применения. DB JSON typing
включает уже поддерживаемые resource metadata; SQLформат ресурсов не изменялся.
134/134 связанных тестов и contracts/db/server/web tsc прошли на финальных байтах.
Границы доказательств и обнаруженный долг metadata0097 (descriptor/snapshot),
который исправляется перед следующим nativeпрогоном: POOL16-CHECKPOINT.md.

### Native character/receipt qualification — 27.11.2026

SQL0097 теперь согласован с ORMdescriptor и generatedsnapshot0097. Будущий
Drizzle diff к текущей схеме пуст;42 migration/integrity/authoritytests прошли,
db/server/web tsc прошли. На fresh nativePostgreSQL18 фактически применены98SQL,
121publictable; PK/FK/check receipt подтверждены read-onlySQL.

Настоящий GM+2PLAYER WebRTC/browserпрогон подтвердил wallet/skill/ability/retry/
recharge/rest через APIadapter и отображение resources/audit, а также прежние
movement/fog/DM/fileupload/revoke/dice. Скрины просмотрены. Exactbytes, setupFAIL
и границы (не WAN/failover/E2EE/physicaldevices/productionrestore) сохранены:
.qa-temp/final-release-20261126/POOL17-CHECKPOINT.md. ВсеQAпроцессы остановлены.

### Фоны карт мира используют общий assetканал — 27.11.2026

Проверка source опровергла необходимость отдельного хранилища для world-map
background: это backgroundAssetId кампании, уже включённый в разрешённые assets.
Удалён obsolete PEER_WORLD_MAP_MEDIA_PENDING guard, мешавший bootstrap всей
кампании. Используются прежние ASSET_CHUNK/roleACL/version/SHA/Blob/revocation.
55 connectedtests подтверждают publishedbackground/hidden-draft denial и отказ
после archive. NativeworldmapUI ещё предстоит: POOL18-CHECKPOINT.md.

### Области и отмена через peer — 27.11.2026

AREA_APPLY/CANCEL/APPLICATION_UNDO используют существующие canonicalфункции.
Outer authoritytransaction явно SERIALIZABLE дляapply/undo: nestedDrizzle
savepoint не повышает isolation. Campaignfirst lockorder согласован с HTTP.
Известные отказы откатываются и повторно авторизуются перед безопасным
commandError; SQL/targets/exceptiontext не раскрываются, unknown RPCmask сохранён.
ClientApiError сохраняет безопасные коды/notApplied и actorcontext.75 connected
тестов прошли; границы и pendingnativeprobe — POOL19-CHECKPOINT.md.

### Native area/cancel/undo и world-map transport — 27.11.2026

Связанный nativeGM+2PLAYER прогон на actualPostgreSQL/WebRTC подтвердил area
apply/retry, cancellation fencing, undo/repeat и403 чужому игроку; journalcancel
маркер фактически просмотрен. SHOWtransaction_isolation на той же roottx вернул
serializable6раз. Publishedworldmapbackground256×128 доставлен и декодирован как
Blob; WorldMapsWorkspace целиком этимнепроверен. Старые core/token/DM/upload
сценарии тоже прошли,0PLAYERHTTPrequests/pageErrors/cookies,98freshSQL.
Exactinputinvariance/ограничения/cleanup: POOL20-CHECKPOINT.md; это loopback,
не полная отказоустойчивость/E2EE/platform/productionreleasequalification.

### Upload refusals и неизвестный COMMIT — 27.11.2026

Staging и cleanup используют общий campaignfence. Ошибка COMMIT больше не
доказывает rollback: новый READCOMMITTED read сохраняет файл при durable reference,
удаляет только подтверждённый orphan, а при недоступнойDB сохраняет/PENDING.
Knownvalidation errors передаются безопасным code/status, неизвестные остаются
uncertain; HTTP/peer fileUI использует общий русский словарь и сохраняет draft.
76 connectedtests, включая реальные PGlite rollback и моделирование lostACK,
прошли; exacthashes/границы в POOL21-CHECKPOINT.md. Durablecleanupjournal и
restart/partialwrite recovery ещё впереди, полной crashsafety не заявляем.


## Пул 23 — восстановление загрузок после перезапуска (27.11.2026)
Файловый журнал загрузок теперь обрабатывается ChatUploadRecovery после запуска HTTP listener и каждые 30 секунд. Один проход сканирует максимум 256 записей и выполняет максимум 25 сверок; открытый курсор сохраняется между проходами, поэтому свежие/повреждённые записи не блокируют очередь. Grace 120 секунд; активный writer защищён прежним campaign fence. Сверка выполняется в новой READ COMMITTED транзакции: ссылка в chat_attachment_uploads сохраняет файл, доказанное отсутствие удаляет только owned файл/пустую директорию; недоступность БД сохраняет журнал для повтора. Неизвестные форматы и symlink entries сохраняются. Worker не сканирует committed media; при shutdown ожидает текущий проход и закрывается до DB client.
Проверено PGlite + реальная файловая система: restart-style orphan cleanup, недоступная БД с последующим повтором, сохранение committed bytes/row и снятие остаточного marker. Отдельно проверены bounded cursor/fairness, grace, overlapping pass deduplication и ожидание stop. Это доказательства component/integration уровня; native PostgreSQL с реальным concurrent writer, process kill/restart, Windows installer и физический power loss требуют отдельных доказательств.

### Атомарный журнал локальной authority — пул54
SQL0098: server-only local_event_outbox и AFTER INSERT game_events capture под active authority. Envelope/origin/session/epoch сохраняются атомарно с event, rollback не оставляет pending, удаление campaign pending не удаляет. PGlite41/41; native/ACK/cloud apply/шифрование полного GM storage ещё впереди. Это staging существующих событий активной authority, не полная синхронизация и не охват всех подготовительных изменений. Evidence POOL54-CHECKPOINT.md.
