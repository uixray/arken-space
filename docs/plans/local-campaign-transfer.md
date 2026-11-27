# Полный перенос кампании: реализация и границы безопасности

27.11.2026. Часть исходного local-first объёма, не отдельная урезанная версия продукта.

## Проверенное исходное состояние

128 public-таблиц текущей схемы. Полного campaign-scoped export/import нет. Service snapshot/recovery копирует весь сервис: его нельзя применять как выдачу одной кампании её мастеру. Игровой snapshot — роль-фильтрованная проекция, а не полный редактируемый источник кампании. Нативные синтетические проверки синхронизации пока зеркалировали UUID через SQL seed.

## Добавлено

`campaign-transfer-policy.ts`: явная классификация всех128 таблиц и проверка полноты относительно ORM; тест сверяет её с настоящими public-таблицами после всех миграций PGlite. Новая таблица требует явного решения, автоматического экспорта по наличию campaign_id нет.

`campaign-transfer-manifest.ts`: versioned internal manifest, campaign/schema/migration binding, точная bigint-позиция исходных событий, полный каталог таблиц, counts/bytes/SHA256 файлов и медиатеки. Имена таблиц из reviewed catalog; reader получает только сгенерированные `tables/<table>.ndjson` и `media/<sha256>`. Проверяются полнота, исключение credentials, размеры, дубликаты media, hash метаданных и каждый файл. SHA — целостность, не аутентификация, лицензия или E2EE.

Это основа формата, а не готовый exporter/importer. HTTP/UI переноса подключаются после следующих частей.

Добавлен `campaign-transfer-source.ts`: внутренняя граница hosted-account GM,
проверка текущего membership/user/archive, installed migration hashes и полного
каталога public tables. Чтение ROOT/CAMPAIGN_ROWS постранично в одной repeatable-read
транзакции, с порядком по PK и исходным JSON-текстом PostgreSQL, без округления
больших чисел JSON-драйвером. Утёкший из callback reader после закрытия запрещён.
Специальные классы требуют отдельных обработчиков и через общий reader недоступны.
Native PostgreSQL проверкой подтверждены стабильность снимка при concurrent commit,
видимость новой версии только следующим снимком, удержание owner fence и отказ
после отзыва. Это согласованный источник, ещё не сборщик полного пакета.

Добавлены отдельные readers участников (стабильные membership IDs/roles,
`user_id=null` вместо переноса облачной авторизации), шести DEPENDENT-групп
через campaign-owned parents и разрешённых MEMBER_ACL-групп: авторские заметки,
доступные потоки, собственные read cursors, GM-заявки своей кампании.
Чужие личные потоки исключаются даже для GM. Для таблиц без PK порядок
использует только полный уникальный non-null индекс/constraint, не partial index.
Для chat_messages добавлен отдельный selector: participant-only DIRECT,
замороженная аудитория стикера и видимость заявки применяются до pagination.
Отозванный стикер заменяется текстовой заглушкой с сохранением комментария;
ссылка inspiration на невидимое сообщение обнуляется. Эти изменения помечаются
отдельным provenance record и не являются локальными командами для возврата
в облако. Manifest содержит отдельный проверяемый `projections.ndjson`.
Для разрешённых chat_attachments отдаётся metadata только CLAIMED content,
без переноса срока/состояния pending upload. Storage key остаётся внутренним
указателем source-reader; пакет должен содержать проверенные content-addressed
bytes, а importer — создавать новую локальную CLAIMED content-запись.
История событий, лицензии/общая библиотека и pin/copy медиаданных остаются
за отдельными обработчиками; общий reader не обходит эту границу.

Реализован media pin/copy для обычных campaign assets, их постеров и разрешённых
CLAIMED chat attachments. Source API принимает asset/content IDs, проверяет их
в той же авторизованной транзакции и только затем открывает файл. Открытый handle
сохраняет доступ к конкретному файлу при последующем unlink; копирование проверяет
размер/mtime и SHA256, пишет через частный staging и публикует digest-name только
после полного fsync через no-replace hard link. Дубликаты проверяются повторно,
чужие final/temporary files не перезаписываются и не удаляются. Symlink/junction,
traversal и Windows device paths отвергаются. Лицензированные sticker/world/global
медиа требуют отдельных scoped handlers. Полный assembler ещё должен обеспечить
free-space reserve, persistent staging/recovery journal и atomic manifest publish.
Текущий file-pin не обещает защиту от hostile same-user in-place writes или
физического power loss; hard-link-less filesystem пока fail closed.

Для campaign stickers общий table-reader теперь закрыт: metadata пакетов,
entitlements/consents сохраняется отдельно, а art/item/media выбираются только
при действующем GRANTED для PLAYER subject. Пакеты с отозванным/отсутствующим
согласием сохраняются как configuration без копирования изображений; ссылки
на недоступные стикеры в переносимой истории заменяются audited-заглушками.
Общая sticker library ограничена реально разрешёнными ссылками истории и
собственными заготовками текущего GM при включённой функции. Соседние элементы
того же публичного пакета и несвязанные публичные пакеты не копируются.
Foreign creator/uploader bindings и чужой manager-only source_reference
обнуляются с provenance record; публичные authorCredit/licenseNote сохраняются.
Media-copy проверяет исходный DB SHA256. Consent/global-pack SHARE locks удерживают
права на время snapshot; это не обещание perpetual/offline revoke после выдачи.
Эти правила относятся к частному переносу в клиент, а не к публикации арта
в публичном установщике. Для остальных библиотек нужны отдельные scoped handlers.

Для world content реализован GM-only referenced graph: campaign instances,
canonical map locations, merchant regions и дополнительные выбранные статьи.
Recursive closure включает region ancestors, обе стороны явных relations и
канонические article permalinks; cycles дедуплицируются, чужие mutable campaign
instances и несвязанные соседние статьи не подтягиваются. Галереи/обложки и их
image library records выбираются по этому графу; captureWorldImage проверяет
связь и поддерживаемый image MIME до открытия source file. GM-only text и
provenance/review status сохраняются без изменения прав/одобрения. Snapshot
использует private temporary selection ON COMMIT DROP и явный fail при превышении
графа1млн nodes; дополнительные roots ограничены1000 на текущий internal call.
World action ledger отнесён к FILTERED_HISTORY: его opaque payload нельзя
выдать целиком через graph reader. Creation library и typed history ещё впереди.

## Единый следующий implementation-пул

1. **Согласованный capture.** Текущая hosted-account GM авторизация; согласованный transaction snapshot данных кампании, immutable migration ledger и media reference set. Согласовать capture с удалением/заменой media через lease/pin, иначе DB snapshot может ссылаться на уже удалённый файл. Зафиксировать реальный baseline state digest, а не только max(game_events.sequence).
2. **Обработчики каждого класса.** ROOT и CAMPAIGN_ROWS — только запрошенная кампания; DEPENDENT — транзитивное замыкание через проверенные FK; REFERENCED_LIBRARY — только действительно разрешённые ссылки кампании и их замыкание, а не вся общая библиотека. Неизвестный тип/неполный handler — отказ всего capture.
3. **Приватность.** MEMBER_ACL: личные сообщения только с участием текущего пользователя, личные заметки только автора, прочие данные по существующим ACL. У GM нет обходного доступа к чужой переписке. FILTERED_HISTORY требует типизированной фильтрации payload, поскольку game_events/action_journal могут содержать приватные сведения. Нельзя безопасно считать любой event с campaign_id общедоступным.
4. **Идентичности и лицензии.** Сохранять стабильные campaign/membership/object IDs, отдельно проверять связь source owner с локальным владельцем. Облачные users/password/session/token/mail/webhook credentials исключены; импорт не создаёт чужую авторизацию. LICENCE_BOUND сохраняет проверенное происхождение и доступ, не выдаёт новые права. NON_REPLAYABLE quotes не должны становиться новыми покупками после переноса.
5. **Пакет и import staging.** Построчная строгая проверка типов/precision, PK/unique/FK closure и всех media bytes. Adapter отвергает traversal, symlink, duplicate/extra archive entries и превышение квот до файловых записей. Изолированный staging, атомарная публикация DB+media/root pointer, crash recovery и отказ от перезаписи существующей кампании по умолчанию. Реальные данные до commit сохраняются.
6. **Пользовательский путь.** Облачный GM получает перенос, локальный владелец выбирает/импортирует пакет в интерфейсе и получает полноценную редактируемую кампанию. Прогресс/ошибки/возобновление и очистка секретов. После независимого запуска проверяются map/story/media/characters/GM secrets/PLAYER ACL и локальные изменения.
7. **Обратная синхронизация.** Writer lease/fence и typed apply/reconcile используют этот baseline. Отсутствие строки в разрешённой ACL-проекции НЕ означает удаление исходной облачной строки; скрытые DM/заметки не стираются при возврате локальной кампании. Применение не подменяется нынешним STORED_ONLY.

## Ограничения текущего формата

Internal bounds: до1млн строк и256MiB на table-file,32GiB суммарно,100тыс media entries. Это защитные проверки формата, а не утверждённые продуктовые квоты; при необходимости больших кампаний потребуются chunked tables с теми же гарантиями, а не отбрасывание данных. Полный набор ACL/row semantics, encryption, archive adapter, package authentication и atomic import ещё предстоит завершить и проверить. Авторизация source и repeatable-read capture уже реализованы отдельно; они не заменяют полный exporter/importer.

## История энциклопедии — пул 82

Internal readWorldHistory выбирает до пагинации записи выбранных статей и
исторические удалённые relation/media по проверяемым payload endpoints. Девять
существующих типов проходят strict typed validation; неизвестные типы/поля,
несовпадение entity ID/type и повреждённые данные завершают capture ошибкой.
Чужой actor membership обнуляется с отдельным provenance record. Исходный JSON
истории не пересериализуется, точность sequence остаётся в исходном SQL тексте.
Исторические article/image references возвращаются assembler как обязательные
зависимости: удалённая связь или сменённая обложка не означают, что старую
зависимость можно silently потерять. Полная assembly должна расширить closure
и скопировать/проверить эти зависимости перед публикацией пакета. Текущий
world graph/media reader ещё не является таким полным архиватором.
Game events и action journal по-прежнему требуют собственных typed handlers.

## Журнал сцены — пул 83

readActionJournal обрабатывает 14 текущих видов canvas history: создание/удаление,
перемещение, размер, вид, состояния и слой токена; создание/изменение/удаление
рисунка; создание тумана; групповые move/delete; изменение конфигурации сцены.
Before/after остаются исходными SQL JSON, включая данные отмены и повтора.
Проверяются известные shape/type/target/scene/scope; opaque неизвестные варианты
отклоняются. Исторические asset/definition/character/member/scene зависимости
возвращаются полному assembler для замыкания. Это GM-only snapshot reader,
не player export. Legacy snapshot shapes и полный history dependency closure
требуют явной совместимости до открытия пользовательского экспорта.

## События доставки чата — пул 84

readChatDeliveryEvents покрывает chat.created/dice.created, включая direct chat,
стикеры, вложения и gallery-share DTO. Message ACL применяется перед пагинацией;
исторический DTO сверяется с id/thread/member/body/visibility текущей разрешённой
записи, а неизвестные поля, в том числе внутри dice/skill card, отклоняются.
Недоступные стикеры заменяются audited tombstone, скрытая корневая inspiration
удаляется вместе с source total/label; произвольные скрытые вложенные inspiration
завершают capture отказом до реализации их явной проекции. Исправлен и перенос
самих chat_messages: скрытый source ID удаляется также из dice.inspiration.
Raw SQL JSON event header/sequence остаётся без JS-пересериализации.
Entry/area/undo receipts и остальные типы game_events ещё требуют своих handlers;
assembler должен проверить полноту покрытия, а не считать этот reader полным
экспортом game_events.

## Применение и отмена — пул 85

readApplicationEvents покрывает entry.roll/entry.shared/ability.area.applied/
entry.undo. Сохраняет исторические undoReceipt/preimages расходуемых предметов,
ресурсов и entry data. Конверты, карты и структурные поля типизированы; entryData
и beforeResources остаются явно предусмотренными доменными extension bags,
а не произвольным opaque event envelope. Проверяются message ID, автор карты,
межкампанейные известные ссылки. Undo с недоступным исходным сообщением
отсеивается до пагинации; скрытые inspiration refs вызывают явный отказ.
References разделены на message/character/entry/catalogEntry/object/instance/
scene/membership: удалённые исторические объекты должен замкнуть и проверить
assembler. Это ещё не полное покрытие всех game_events, не готовый импорт.

## Полнота игровых событий — пул 86

scripts/qa/campaign-event-inventory.mjs выполняет статический TypeScript AST обход
прямых insert(gameEvents).values(...) без исполнения исходников: найдено106 мест,
82 literal type и14 dynamic/shorthand/spread мест для отдельного разбора. Это
инвентарь прямых producers, не автоматическое доказательство покрытия raw SQL,
aliases, старых исторических типов или payload schemas.

source.assertEventCoverage читает GROUP BY type/entity_type/count в том же
snapshot; неизвестная пара type/entity блокирует полный пакет вместо пропуска.
Counts сохраняются decimal bigint text. Registry сейчас содержит6 реально
реализованных chat/dice/application types. Успешный coverage gate сам по себе
не означает ACL/row/FK/media/import qualification: assembler обязан вызвать и
проверить все typed readers. До готовности остальных handlers полный экспорт
кампании с их событиями закономерно отклоняется.

## События сцены — пул 87

readCanvasEvents покрывает27 типов: scene CRUD/activation/isometry/canvas,
token creation/placement/movement/size/appearance/conditions/layer, definition
CRUD/sprite/controllers, drawings CRUD/copy, fog creation, bulk move/delete,
canvas undo/redo. Schemas и зависимые entity domains проверяются по реальным
producer payloads; known nested JSON fields проверяются отдельно от stripping
runtime normalizers. Registry coverage теперь включает эти27 типов плюс6
chat/application типов.

Undo/redo обязательно связывается с journal в той же кампании, по точному
sequence, target ID и lower-case target type. Ссылка sequence читается SQL text,
поэтому даже bigint выше MAX_SAFE_INTEGER не округляется. Исходная JSON строка
сохраняется. Проверяются текущие межкампанейные зависимости через scenes для
токенов/рисунков/тумана и напрямую для assets/definitions/characters/members.
Удалённые исторические зависимости возвращаются assembler; их отсутствие
в live tables не заменяет последующую полноценную closure/legacy проверку.

## События кампании и персонажей — пул 88

readCharacterEvents добавляет27 типов событий времени/паузы/инициативы/настроек
кампании, персонажей/счётчиков/архива/вдохновения, каталога/личных записей,
галереи и развития. Проверяются typed payloads и текущие foreign-campaign
зависимости, включая character entry→character. Вдохновение со скрытым source
или result message исключается по реальному chat ACL до пагинации. Resources
остаются намеренным custom-key domain bag, artwork IDs выделяются отдельно;
полный JSON-reference closure остаётся обязанностью assembler. Неуточнённый
ненулевой media.relatedEntityId вызывает явный отказ до появления его typed
модели. Общий registry содержит60type names; это не полное покрытие всех producers.

## Журналы мастерской и экономики — пул 89

readCommerceEvents покрывает14 creation types (13 reviewed команд и cancellation)
и4 economy types. Общие gameevents содержат только requestHash. Creation event
обязательно совпадает с immutable creation_actions по campaign/action/actor/hash;
cancellation дополнительно сверяется с original command type и typed receipt.
Economy config привязан к root campaign, merchant/offer refs проверяются на
foreign campaign; purchase связан с economy_purchases и instance action по actor,
quote/inventory/action/hash. Ledger dependencies возвращаются assembler.
Registry теперь78type names; это не полное покрытие всего gameevent инвентаря.

## Сюжетная лента и заявки — пул 90

readNarrativeEvents покрывает6 story и6 request event types. Сохраняет immutable
исторические admin DTO ленты с gmNotes, lifecycle, media metadata и provenance;
request events содержат только commandHash. Проверяются post identity, resolved
linkTargets против entityLinks, вложенные известные поля и foreign-campaign refs.
Peer direct thread не может попасть через подставленный historical story DTO.
Возвращаются typed post/request/thread/member/content/link dependencies. WORLD_ENTITY
links нужно включить в world closure полного assembler; content IDs нуждаются
в отдельном source-owned story-media copy handler, не в upload runtime export.
Registry90names всё ещё требует остальных domains и полного coverage gate.

## События карты мира — пул 91

readWorldMapEvents покрывает13 типов world_map events: карты, фон и утверждение,
публикация/архив, локации, связи со сценами, положение отряда. Typed identity,
map/location consistency и известные foreign-campaign map/location/scene/asset
refs проверяются до выдачи. Маркеры удалённой локации и очищенного положения
сохраняются, refs не отбрасываются только из-за отсутствия live row. Полный
assembler должен различать обязательные текущие зависимости и допустимые
исторические marker-only references, а не выдумывать отсутствующие старые данные.
Registry103type names ещё требует остальных domains и полного coverage audit.

## Заклинания, награды и привязки — пул 92

readMagicAwardEvents покрывает4 spell-pack,3 spell-assignment и2 award/binding
типа. Pack markers сверяются с immutable pack/version/lifecycle, включая typed
previous-version audit. Назначения сверяются с immutable assignment version,
character/pack/target/author/override и previous assignment version; audit
prerequisiteFailures сохраняется по существующему contract schema. Achievement
marker требует matching achievement_history, binding marker — instance action.
История не переоценивает старые требования по текущему состоянию персонажа.
Registry112names; отдельный literal-gap report перечисляет18 оставшихся прямых
пар type/entity, дополнительно остаётся dynamic encounter helper и полный audit.

## Доступ, перезарядка и отмена — пул 93

readControlEvents добавляет10 typed markers. Исторические UUID invite/playeraccess
сохраняются как явно unbound auth-runtime references с provenance record;
никакие credential rows не восстанавливаются из такого marker. Payload whitelist
не допускает token/tokenHash/password/url/accountSessionId. Existing runtime IDs
проверяются на foreign campaign через SELECT id, без чтения credential fields.
Membership/character/entry/root/action identities проверяются отдельно. Registry122
names ещё требует assets/audio/story-attachment-delete/dynamicencounters и полного
audit; поддержанный type сам по себе не означает готовый полный package/import.

## Структура строк перед импортом — пул99

campaign-transfer-rows.ts предоставляет отдельный structural gate по текущему
catalog: точный набор SQL колонок, nullability, принадлежность campaign/root,
обнулённый memberships.user_id и transfer_invalidated=true для quotes.
Runtime credential tables отклоняются целиком. Проверены настоящие source rows
campaigns/scenes и отрицательные варианты. Gate не проверяет SQL primitive types,
дубликаты JSON keys, FK closure или nested domain JSON. Он ещё должен быть
обязательно подключён полным importer до первой target write; наличие функции
само по себе не означает готовый импорт. Manifest file gate пока проверяет
syntax/count/hash отдельно. Следующий связанный шаг — общий validator pipeline,
полнота обязательных зависимостей и атомарная сборка/импорт пакета.

## Формат2 и привязки медиа — пул110

Внутренний неопубликованный формат переведён в version2 с отдельным domainhash
arken-campaign-transfer-v2. Старый version1 отклоняется, PASS старых fixtures не
переносится. Capture policy остаётся1. mediaBindings — обязательный nullable
файловыйdescriptor: ненулевой при наличии media, null при пустойmedia. Фиксированный
media-bindings.ndjson имеет собственные bytes/SHA256, strict kind/id/hash/size/MIME
строки, уникальностьkind/id, точное совпадение сlistedblob и полное покрытиеmedia.
Draft записываетsidecar fsync+nooverwritehardlink вprivate data root. Это integrity
bindings, не доказательство принадлежностиbindingid конкретнойSQLrow: следующему
whole-package gate ещё требуется сверка binding target/variant с таблицами и
обратная полнота для каждого текущегоmedia-bearing record. Публикацияmanifest,
единыйcontainer, projections, domainclosure иimporter остаются отдельными частями.

## Единый structural candidate — пул115

Owned source draft консолидируется в один private data root: media blobs получают
nooverwrite hardlinks вmedia/, после чего whole structural gate читает всеkeys
изединогокаталога. Fresh fsynced candidate-manifest.json фиксирует именноinternal
STRUCTURAL_CANDIDATE, неfinal manifest.json/import-ready commitmarker. Ownership
capability однократна иsnapshotroots/descriptors хранятсявWeakMap: forged/copied
objects иповторнаясборкаотвергаются. Domain/event/uniqueconstraint qualification,
archiveauthentication, recoveryjournal/free-space иреальныйatomicimport ещё нужны.

## Пользовательский экспорт — пулы 126–127

Реализован зашифрованный потоковый контейнер с паролем и обратным чтением в отдельный приватный staging-каталог. В кабинете мастера добавлены подтверждение пароля учётной записи, отдельный пароль файла с повтором, подготовка в фоне, статус и обычное скачивание файла браузером без загрузки всего файла в память JavaScript.

Маршруты доступны при CAMPAIGN_TRANSFER_ENABLED=true, HOSTED и включённых аккаунтах; production требует HTTPS. Флаг по умолчанию false до связанной приёмки переноса и итогового выпуска. Приложение сверяет установленные migration hashes. Работа привязана к исходной account session, поколению password hash и текущему GM membership. Source snapshot повторно проверяет и блокирует текущую сессию/пользователя. Смена пароля, отзыв сессии/доступа и другой аккаунт/сессия прекращают доступ к ссылке. Готовый зашифрованный файл хранится 15 минут; исходный plaintext capture удаляется до статуса READY. FAILED публикуется после очистки неудачной сборки. При рестарте URL инвалидируется, просроченные остатки отдельного export root подлежат очистке.

Пул127: HTTP source capture → structural/SQL qualification → archive → browser download → decrypt/private-stage проверен на новой синтетической кампании в native PostgreSQL18 и Chromium при ширинах 1365/390. Это не физическая мобильная приёмка и не итоговая готовность автономного режима. Далее атомарный target importer с привязкой локального владельца, материализацией медиа, восстановлением и локальным запуском. Полный исходный объём local-first/P2P/E2EE/platform и финальной версии сохраняется.

## Атомарный локальный импорт — пул 128

Добавлен внутренний импортёр аутентифицированного private stage. Однократная capability защищает выбор файловой системы от переданного клиентом root. Stage повторно проверяется на точных байтах; SQL изменяет только явно разрешённые поля: user_id мастера привязывается к местному владельцу, остальные аккаунтные привязки остаются пустыми, медиа получают новые ключи в отдельном import-media/UUID namespace. Вложения создаются как новые CLAIMED записи; один blob может иметь разные hardlink-имена, поэтому удаление asset не удаляет файл вложения.

FK-порядок выведен из явного каталога. Единственный межтабличный цикл memberships.dice_frame_asset_id временно разрывается и восстанавливается до commit. Self-FK строки загружаются одной SQL-командой на таблицу; неизменяемые версии не UPDATE-ятся. Триггеры и ограничения работают штатно. Автоматические пустые чаты удаляются только для новой ещё не опубликованной кампании. Исходный текст JSON не проходит через JSON.stringify(parsed row), включая bigint.

Миграция0103 создаёт local_campaign_imports: receipt фиксируется в той же транзакции, что кампания, и сохраняется при удалении кампании ради независимой библиотеки иллюстраций. Таблица исключена из переноса. Теперь104 миграции/129 таблиц; старые QA-кандидаты103/128 не подтверждают новые байты. После рестарта/ошибки связи исход commit определяется по receipt под тем же advisory lock, а не по существованию campaigns. Неопределённое состояние БД сохраняет медиа. Счётчик game_events повышается под краткой блокировкой в конце транзакции; допустимы пропуски sequence после rollback, понижение счётчика не выполняется.

Native PostgreSQL18: новая отдельная целевая БД, отдельная ограниченная роль без superuser/DB ownership/schema CREATE. Для импортёра требуется UPDATE на game_events_sequence_seq дополнительно к обычным USAGE/SELECT sequences и DML public tables; этот grant нужно включить в поставку локального runtime. Подтверждены перенос57строк, новые медиа, местный владелец, bigint9007199254742000→9007199254742001, поздний unique-конфликт с полным rollback и сохранением существующей кампании, повтор и recovery.

Следующий шаг — HTTP upload и интерфейс локального аккаунта с повторной авторизацией и session/password-generation proof внутри импортной транзакции; затем реальный запуск кампании через интерфейс. Текущий importer — внутренний, публичный upload ещё отдельный этап. Crash/torn-intent/power-loss/fsync-directory, повторный импорт после удаления, shared-library collisions, полный media-consumer/sprite-receipt lineage, применение полного runtime после больших sequence и вся исходная финальная матрица остаются в объёме.

## Загрузка через локальный кабинет — пул129

Локальный владелец выбирает файл через русскоязычную кнопку, вводит пароль местного аккаунта и пароль файла, получает подтверждение импорта и открывает перенесённую кампанию. Файл передаётся как browser File/FormData, не превращается в целиком прочитанный JavaScript Buffer/Blob. Сервер принимает ровно два поля до одного archive file, проверяет весь multipart до начала DB import, повторяет проверку аккаунта после чтения и держит session/password-generation proof в транзакциях импортёра. Другие поля, пути и имена файлов не являются инструкцией записи. Неопределённый результат в UI требует обновления списка перед повтором.

Флаг CAMPAIGN_TRANSFER_IMPORT_ENABLED по умолчанию false; допустим только LOCAL_HOST/account auth, отдельная capability управляет видимостью формы. Нужен актуальный пакет с104миграциями и sequence UPDATE grant изпула128. Приватная upload stage очищается до отправки успешного/ошибочного результата. Одновременно принимается один импорт; rate limit ограничивает попытки.

Проверены реальные AccountAuthWorkspace/CampaignRouter/App, полные Fastify routes/realtime и native PostgreSQL18 под отдельной DML-ролью: выбор файла → HTTP import → новый local owner binding → открытие обычного игрового стола и авторизованное чтение PNG. Desktop1365, mobile390 (форма/список), исторический baseline9007199254742999; screenshots просмотрены, uncaught browser errors0. Это dev-web/native-handler scenario, не запуск уже собранного Windows EXE и не физическое мобильное устройство. Движение/PLAYER/restart и весь исходный scope остаются следующими применимыми этапами.

## Восстановление прерванного переноса — пул130

Файловое копирование и SQL-публикация теперь держат один advisory fence: startup recovery не удаляет активный импорт другого процесса. Маркеры intent/complete публикуются атомарно через fsynced temporary file и no-overwrite link/замену собственного metadata entry. Исход COMMIT проверяется по durable receipt; потерянное подтверждение успешно завершённого COMMIT восстанавливается без ложного отказа.

При запуске локального upload-модуля выполняется восстановление импортных namespace и очистка загрузок с доказанно завершившимся процессом-владельцем. Проверка PID использует только signal0; живые/недоступные/неизвестные процессы и чужие данные сохраняются. Подтверждённый незавершённый перенос получает complete marker после hash-проверки нужных медиа. Завершённые переносы проверяют наличие/размер текущих необходимых файлов; удалённые пользователем неиспользуемые asset-файлы не считаются потерей. Пропавшие namespace/нужные файлы и повреждение неполного переноса явно учитываются как NEEDS_REPAIR, не как успешное восстановление. Чужие receipt/непонятные metadata сохраняются для разбора.

На native PostgreSQL18 реально остановлены три собственных Node importer process: после копирования до SQL-публикации, после receipt INSERT до COMMIT и после COMMIT до complete marker. Первые два полностью откатились; третий восстановился при новом запуске реального upload-модуля. Во время живого импорта recovery получал lock timeout и сохранял его файлы. Подтверждены очистка dead-process upload stage, сохранность прежней кампании/файла, восстановление torn complete, обнаружение пропавших файлов/namespace и equal-size corruption при полном повторном hash. Повреждённые данные не удаляются; восстановление самих байтов из исходного архива остаётся следующим этапом (в тесте bytes возвращены вручную только для продолжения).

Это процессные аварии и metadata/media fault simulation, не физическое отключение питания. Полный hash выполняется для неподтверждённого завершения; обычный готовый перенос получает быструю size/existence проверку. Managed scans ограничены10000 namespaces; PID reuse консервативно сохраняет stage. Повторная UI→import→настоящий игровой стол квалифицирована на свежих bytes после этих изменений.


## Восстановление медиа из исходного файла — пул131

Операция REPAIR в локальном кабинете принимает тот же зашифрованный архив с matching manifestSHA committed receipt и повторной авторизацией владельца. Поля multipart допускают дополнительный operation перед file; старые два credential поля сохраняют IMPORT по умолчанию. Ремонт проверяет актуальные DB media refs и исправляет только отсутствующие/повреждённые файлы собственного import namespace, не меняя текущие персонажи, события и права; новые и удалённые иллюстрации учитываются по текущим ссылкам. Namespace можно восстановить из receipt. Intent pending до копирования, hash всех нужных bytes, atomic replacement entries и complete после полной проверки. Повтор healthy repair восстанавливает0файлов.

Native actual account UI→import→порчаPNG→repair→открытие кампании подтвердил2восстановленных файла, сохранение более новых событий/персонажа и новый HTTPETag. 89 связанных проверок, server/web tsc; desktop1365 полный сценарий, mobile390 форма. Внутренние peer caches ещё используют storageKey-only version и требуют следующего этапа. Новая repair process-crash матрица и полный media/platform consumer coverage остаются в плане.
