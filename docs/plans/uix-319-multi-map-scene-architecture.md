# UIX-319 — многокартная сцена и назначение игроков: архитектурный гейт

Статус: Discovery, рекомендация для review. Production schema, API и UI в этом
пуле не меняются. Baseline: `origin/main@d789d97`.

## 1. Граница задачи

Нужно позволить мастеру собрать несколько тактических карт в одном рабочем
пространстве и независимо назначить игроков на разные карты. При этом сервер,
а не клиент, определяет доступную игроку карту, а скрытые карты не попадают ни
в snapshot, ни в asset-запросы, ни в realtime payload.

В Discovery входят:

- сравнение трёх моделей из Linear;
- устойчивые термины и границы агрегатов;
- серверная модель назначения, ревизии и атомарного перехода;
- privacy-, migration-, performance- и regression-модель;
- декомпозиция будущей реализации.

Не входят:

- production-миграция и новые runtime routes;
- GM/player UI;
- параллельные encounter lifecycle для разных подгрупп;
- синхронизация камеры мастера и игроков;
- автоматический перенос токена перетаскиванием между картами.

## 2. Подтверждённое текущее состояние

- `campaigns.activeSceneId` задаёт общий fallback canvas кампании; сейчас это
  nullable UUID без DB foreign key (`packages/db/src/schema.ts:249-256`).
- Существующая `scene` уже является устойчивой границей координат и владения:
  map asset, world bounds, grid, token placements, fog и drawings ссылаются на
  неё прямо или через tenant-aware join
  (`packages/db/src/schema.ts:1034-1080,1266-1371`).
- PLAYER snapshot получает только активную сцену и разрешённые ей entities
  (`apps/server/src/snapshot.ts:315-390,484-510`);
  GM получает все scene metadata/tokens, но fog/drawings только активной и
  дополнительно рассматриваемой через GM-only `scene:view` сцены.
- `scene:view` меняет только GM socket projection и не переключает игроков.
- Realtime использует campaign/member/GM rooms. Snapshot строится отдельно для
  каждой роли/membership; canvas incremental events требуют отдельной проверки
  audience и не могут считать room доказательством авторизации.
- UIX-311 уже различает глобальную смену тактической сцены (`LINKED_SCENE`) и
  локальную подсказку камеры (`SCENE_REGION`). UIX-319 не должна переопределять
  этот encounter lifecycle (`packages/db/src/schema.ts:2377-2457`,
  `apps/server/src/encounters.ts:393-443`).
- UIX-243 держит мировую географию и party position отдельно от tactical
  scenes. Назначение тактической карты нельзя выводить из world-map location.
- Текущий renderer — один `react-konva` Stage на одну scene. Он загружает ровно
  `scene.mapAssetId`, держит собственные camera scale/position и клипует
  token/fog/drawing к scene world bounds
  (`apps/web/src/renderers/Orthographic2DRenderer.tsx:452-456,675-747,2328-2383`).

Следствие: добавлять второй пространственный уровень внутрь каждой scene
необязательно. Уже существующая scene даёт наиболее проверенную privacy- и
coordinate-boundary.

### 2.1 Подтверждённые gaps, которые нельзя переносить в новую модель

- Ruler сейчас рассылается всей campaign room, player cursor тоже выходит в
  campaign room, а ping/token delivery опираются на global active scene
  (`apps/server/src/realtime.ts:1413-1581,166-189,245-268`). Client-side
  фильтрация `sceneId` не является privacy boundary.
- Drawing create/update/copy/delete и canvas history проверяют campaign/author,
  но PLAYER с известным UUID не везде ограничен текущей сценой
  (`apps/server/src/routes.ts:3998-4247,4478-4583`). Assignment predicate должен
  находиться в той же транзакции, что mutation.
- Encounter projection сейчас отдаёт source/target scene IDs, focus geometry и
  location всем ролям (`apps/server/src/encounters.ts:139-170,655-659`,
  `apps/server/src/snapshot.ts:417-418,866-869`). Для split party нужен
  отдельный player-safe projector.
- World-map scene links PLAYER сейчас фильтруются по global active scene
  (`apps/server/src/world-maps.ts:55-88`); после UIX-319 требуется effective
  scene конкретного membership.
- Asset allowlist использует persisted `tokens.assetId`, а Token DTO —
  `tokenDefinitions.defaultAssetId` (`snapshot.ts:576-592,795-805`). После
  обновления definition старый placement asset способен остаться разрешённым.
  Это самостоятельный существующий дефект: future projector обязан строить
  asset closure только из финального DTO graph, а исправление оформить отдельной
  Linear-задачей, не прятать в UIX-319.

## 3. Устойчивые термины

| Термин                                          | Значение                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tactical scene / тактическая сцена**          | Существующий серверный агрегат с одной локальной системой координат, map asset, grid, tokens, fog и drawings.                                                                                                               |
| **Scene workspace / рабочее пространство сцен** | Новый campaign-scoped GM aggregate, который композиционно размещает ссылки на несколько существующих tactical scenes. Это не новая система координат для игровых entities.                                                  |
| **Workspace item / плитка карты**               | Ссылка workspace → tactical scene плюс GM-only transform в координатах рабочего пространства.                                                                                                                               |
| **Effective scene / назначенная сцена игрока**  | Единственная разрешённая сервером tactical scene: legacy `campaign.activeSceneId` только при отсутствии READY workspace текущего anchor; иначе — valid explicit assignment либо пустая `WAITING_FOR_ASSIGNMENT` projection. |
| **Player assignment / назначение игрока**       | Server-authoritative, revisioned связь membership → workspace item. Несколько membership можно назначить одной атомарной командой; отдельная сущность «группа» для MVP не нужна.                                            |
| **Workspace camera**                            | Локальная камера GM над композицией плиток. Не попадает игрокам и не влияет на scene entities.                                                                                                                              |
| **Scene camera**                                | Локальная камера конкретного клиента внутри tactical scene. Не хранится как общие экранные пиксели.                                                                                                                         |

Слово **submap** допустимо в продуктовой копии, но не как отдельный persistence
aggregate: в выбранной модели submap — это workspace item, указывающий на scene.

## 4. Сравнение моделей

Оценка: 1 — высокий риск/стоимость, 5 — лучший результат.

| Модель                                      | Миграция | Privacy | Renderer | Payload | Floors / portals / split party | Итог             |
| ------------------------------------------- | -------: | ------: | -------: | ------: | -----------------------------: | ---------------- |
| 1. Один world-coordinate canvas с регионами |        2 |       1 |        3 |       1 |                              3 | Не выбирать      |
| 2. Scene с изолированными submaps           |        3 |       4 |        3 |       4 |                              5 | Запасной вариант |
| 3. Linked tactical scenes в GM workspace    |        5 |       5 |        3 |       4 |                              4 | **Рекомендация** |

### 4.1 Один world-coordinate canvas

Плюсы:

- мастер действительно работает в одной системе координат;
- перенос карты в workspace визуально прост.

Минусы:

- все tokens/fog/drawings/assets оказываются в одном агрегате, а скрытие
  прямоугольником становится security boundary;
- transform карты способен неявно изменить смысл координат entities;
- player snapshot и asset access должны сначала загрузить/понять общий граф,
  что повышает вероятность утечки ID, размеров и соседних карт;
- renderer и payload растут вместе с суммой всех карт.

Модель отвергнута: туман является визуальным эффектом, а не границей
конфиденциальности; security нельзя строить на clipping.

### 4.2 Scene с изолированными submaps

Плюсы:

- хорошая локальная изоляция и естественные floors/portals;
- одна логическая scene остаётся единым верхним агрегатом.

Минусы:

- `submapId` придётся добавить и backfill-ить во все canvas entities,
  action journal, encounters, realtime events и asset authorization;
- потребуется длительный dual-read/dual-write или массовая миграция;
- renderer всё равно должен композиционно собирать несколько независимых
  координатных пространств.

Модель остаётся запасной, если продукт позже потребует общей scene-level
семантики, которую нельзя выразить workspace над существующими scenes.

Renderer-аудит предпочёл эту модель из-за чистого термина «одна логическая
scene» и возможности оставить PLAYER renderer почти без изменений. Решение
зафиксировано как осознанное расхождение: семантическая чистота не компенсирует
обязательный rekey всех canvas/history/realtime данных и риск dual ownership.
PLAYER renderer так же остаётся одно-сценовым в модели 3, а сложный GM
compositor требуется в обоих вариантах.

### 4.3 Linked tactical scenes в GM workspace

Плюсы:

- переиспользуются проверенные scene FK, snapshot filtering, fog/drawing bounds,
  canvas revisions и UIX-311 transforms;
- существующие single-map campaigns работают без backfill;
- PLAYER загружает одну scene, а не весь workspace;
- перемещение плитки меняет только GM layout и не меняет локальные coordinates;
- floor/portal — явная ссылка между scenes; split party — разные assignments.

Минусы:

- GM workspace — новый projection/rendering shell;
- canvas events нужно адресовать по effective scene, а campaign room нельзя
  использовать как авторизацию;
- campaign-global encounter/initiative не превращаются автоматически в
  независимые бои по картам.

**Решение Discovery:** выбрать модель 3.

## 5. Предлагаемая доменная модель

Будущая реализация добавляет только additive tables:

### `scene_workspaces`

- `id`, `campaignId`, `anchorSceneId`, `name`;
- lifecycle `DRAFT | READY | ARCHIVED`;
- `revision`, `createdByMembershipId`, timestamps;
- unique `(campaignId, anchorSceneId)` и composite FK на scene той же campaign.

У workspace нет второго campaign-wide active pointer. Текущий workspace
выводится из `campaign.activeSceneId`: READY workspace с этой anchor scene либо
неявный singleton. Так индивидуальное назначение не меняет global active scene,
а UIX-311 продолжает явно менять общий anchor для всей группы.

### `scene_workspace_items`

- `id`, `campaignId`, `workspaceId`, `sceneId`;
- GM-only composition transform: `x`, `y`, `scale`, `rotation`, `zIndex`;
- `revision`, timestamps;
- composite FK на campaign/workspace и campaign/scene;
- unique `(workspaceId, sceneId)` в MVP.

Transform никогда не пересчитывает scene-local tokens/fog/drawings.

### `scene_workspace_assignments`

- `campaignId`, `anchorSceneId`, `membershipId`, `workspaceId`,
  `workspaceItemId`;
- `revision`, `updatedByMembershipId`, timestamps;
- одна текущая строка на membership;
- composite FK гарантируют одну campaign и item из указанного workspace.

Effective scene вычисляется сервером:

1. если READY workspace для текущей anchor scene нет — legacy
   `campaign.activeSceneId`;
2. если READY workspace есть — только валидное explicit assignment;
3. отсутствующая/повреждённая assignment в READY workspace даёт пустую
   `WAITING_FOR_ASSIGNMENT` projection, а не fail-open fallback.

Переход workspace в READY одной транзакцией материализует root assignment для
всех текущих PLAYER membership. Late join получает root assignment в
membership transaction; при ошибке остаётся в safe waiting state.

Нельзя принимать effective `sceneId` из player request/query/local storage.

## 6. Команды, блокировки и ревизии

Все GM mutations имеют strict bounded schema, `actionId`, canonical command
hash, optimistic revision и запись metadata в `game_events` без скрытых
названий/геометрии в player-visible audit.

Минимальные use cases:

1. создать/переименовать/архивировать workspace;
2. добавить, переместить или убрать item;
3. перевести workspace между `DRAFT`, `READY` и `ARCHIVED`;
4. атомарно назначить bounded список membership на items;
5. очистить assignment;
6. явно перенести token placement между scenes.

Player не получает route «посмотреть другую карту». Его token/cursor/ruler/ping
commands выводят scene из target entity либо из server-side effective scene и
отклоняются при несовпадении.

Единый lock order будущих транзакций:

1. campaign;
2. workspace текущей anchor scene;
3. assignment rows в стабильном порядке membership ID;
4. workspace items/scenes;
5. target entities/journal.

Это сериализует reassignment с player canvas mutations. После принятого
assignment поздняя команда старой scene не может закоммититься.

Exact retry возвращает сохранённый receipt. Та же `actionId` с другим command
hash — `409`. Частичная запись assignments запрещена: весь bounded набор
фиксируется или откатывается одной транзакцией.

## 7. Snapshot, assets и privacy boundary

### PLAYER

Snapshot строится allowlist-проектором от effective scene и содержит:

- только effective scene;
- только её разрешённые tokens/definitions/fog/drawings и player-safe encounter
  projection; encounter другой scene отсутствует целиком;
- только assets, достижимые из этой scene и прочих уже разрешённых player
  domains;
- безопасный assignment envelope: `revision`, `workspaceRevision` и
  `effectiveSceneId`, без списка workspace items;
- projected `campaign.activeSceneId`, равный effective scene, либо новый
  явный `canvasSceneId`; raw global fallback ID нельзя оставлять как oracle.

PLAYER не получает workspace layout, transforms, названия/ID других items,
counts, bounds, asset IDs, portal targets и GM notes.

### GM

Обычный `GameSnapshot` не следует раздувать canvas данными всех workspace
items. Нужны:

- GM-only workspace projection с layout и лёгкими scene summaries;
- отдельная GM-only загрузка canvas projection для видимых items;
- on-demand подписка только на items в viewport/authoring focus.

### Asset content

Content route проверяет asset прямым campaign + effective-scene predicate, а
не доверием URL/ID от клиента. Скрытые asset URLs не возвращаются и не
prefetch-ятся. После reassignment новый запрос старого map asset отклоняется;
уже увиденное браузером нельзя считать криптографически «забытым».

DOM, поиск и accessibility representation строятся только из safe player DTO.
Client-side `display:none`, clipping, CSS, фильтр списка или room membership не
являются privacy control.

## 8. Realtime и атомарное переназначение

Socket.IO room — оптимизация доставки, не авторизация. Для каждого canvas
relay сервер получает coherent assignment read set и адресует событие только
socket-ам, чья effective scene совпадает с `sceneId`.

Для ephemeral events применяется короткая shared lock на workspace/assignment
до завершения audience resolution и emit. Assignment берёт exclusive lock:
либо старый relay завершается до перехода, либо переход фиксируется первым и
relay старой scene не отправляется.

Переход игрока:

1. GM command валидируется полностью до изменений.
2. Server фиксирует весь assignment batch и новые revisions одной транзакцией.
3. Затронутым member rooms отправляется безопасный `assignment:pending` с
   revision; клиент очищает canvas и показывает loading state.
4. Server строит новый filtered snapshot и отправляет его адресно.
5. Клиент принимает только монотонную assignment revision, заменяет старую
   проекцию целиком и затем снимает loading state.
6. При post-commit delivery failure клиент остаётся fail-closed на loading и
   делает `game:resync`; он не возвращает уже неавторизованную старую карту.

Если validation/DB transaction падает до commit, assignment и player view не
меняются — это и есть rollback. После commit откат на старую карту возможен
только новой явной GM-командой, а не клиентским fallback.

Reconnect, late join и backend restart не зависят от socket cache: effective
scene заново вычисляется из БД.

## 9. Координаты и canvas domains

- Workspace transform — только композиция GM.
- Scene world coordinates остаются каноническими для tokens, fog, drawings,
  ruler, ping и cursor.
- Camera scale/position остаются client-local. Encounter `focusRegion` хранит
  world rect и локально fit-ится под viewport, как в UIX-311.
- Fog/drawing geometry не может пересечь карту, потому что каждая операция
  принадлежит ровно одной scene и клипуется её bounds.
- Drag через пустое место workspace не переносит token в другую scene.
- Cross-scene transfer — отдельная GM-команда с явными source/destination,
  placement transform/spawn и preflight. Она инвалидирует затронутые redo
  branches и пишет один auditable action.

### 9.1 Undo/restore композиции workspace

Это контракт будущей реализации, не описание уже работающего undo. История
GM layout отделена от scene-local Canvas history и не отменяет назначения
игроков, игровые ходы или изменения token/fog/drawing.

- Undo/redo и restore — явные GM-only компенсирующие команды с новым
  `actionId`, текущими workspace/item revisions и общим lock order из §6.
  Ревизии возрастают, а не возвращаются к историческим значениям. Exact retry
  повторяет один receipt; stale revision или нарушенный preflight дают `409`
  без частичной записи. Новая правка инвалидирует затронутую redo-ветку.
- Одна завершённая transform-операция записывает bounded before/after layout:
  item ID, scene reference, x/y/scale/rotation/zIndex. Undo восстанавливает
  предыдущий transform только для того же существующего item, redo — следующий.
  Scene-local entities, scene revisions и камеры клиентов не меняются. Если
  item уже отсоединён, workspace архивирован либо item изменён после ожидаемой ревизии,
  автоматического overwrite нет: `409` и refresh текущего layout.
- Detach удаляет только workspace-связь, не scene и не её содержимое; при
  assignments на item возвращает `409`. Для отмены сохраняется GM-only
  before-image связи с исходным item ID и transform. Restore восстанавливает
  эту связь с тем же ID и новой ревизией, но **не восстанавливает assignments**.
  Перед записью проверяются существование scene в той же campaign, доступный
  lifecycle workspace (`DRAFT` или `READY`), уникальность ссылки и лимит items. Если scene удалена,
  workspace архивирован или ссылка уже занята, restore даёт `409`: нельзя
  создавать новую scene, дублировать item или молча менять его destination.
- Archive workspace сохраняет layout/items для восстановления и не удаляет
  scenes. В MVP он отклоняется, пока workspace является READY для текущего
  anchor либо содержит действующие assignments: сначала нужна отдельная явная
  команда перехода/переназначения, а не скрытый переход игроков на legacy
  fallback. Restore архивированного workspace проверяет все scene references,
  campaign ownership, уникальность anchor и лимиты, затем атомарно возвращает
  его только в `DRAFT`. Старые assignments и состояние `READY` не оживают.
  Повторная активация — отдельная revisioned команда с preflight и созданием
  assignments по §5; неуспех любого restore оставляет архив неизменным.
- Before-images и история layout доступны только GM. В player-visible audit
  не попадают hidden scene/item IDs, названия, transforms или payload undo;
  content ACL по-прежнему выводится из текущей effective scene. Restore не
  является обходом assignment authority и не возвращает старые asset grants.
- Архивация самой tactical scene остаётся отдельным продуктовым решением из
  §16. Undo detach/archive workspace никогда не выполняет её cascade restore.

## 10. Scope общих функций

| Функция                  | Scope после UIX-319                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat и story             | Campaign-wide; assignment не разделяет историю.                                                                                                              |
| Music/audio              | Campaign-wide; переход карты не перезапускает трек.                                                                                                          |
| Campaign clock/pause     | Campaign-wide. Pause блокирует canvas всех assignments.                                                                                                      |
| Initiative/encounter     | Один campaign-global lifecycle, как сейчас. Encounter указывает tactical scene/focus; параллельные бои подгрупп — отдельная будущая задача.                  |
| Public player identities | Campaign-wide: участники партии и их публичные portrait/token identity остаются известны друг другу; скрытые NPC/map assets этим исключением не открываются. |
| UIX-311 `LINKED_SCENE`   | Явный групповой переход и смена global active scene, следовательно — нового workspace anchor. Не заменяется per-player assignment.                           |
| UIX-243 party position   | Глобальная география группы. Не вычисляется из workspace assignment.                                                                                         |

Если GM назначает часть игроков вне encounter scene, они сохраняют свою canvas
projection; видимость campaign-global факта боя и initiative требует отдельного
продуктового решения вместе с UIX-505, но не должна расширять map projection.

## 11. Сценарии

| Сценарий                                 | Ожидаемое поведение                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Один игрок / READY workspace отсутствует | Полностью старое поведение через `activeSceneId`.                                                               |
| Несколько игроков на одной карте         | Несколько assignment rows указывают на один item; snapshot строится персонально, canvas audience совпадает.     |
| Split party                              | У membership разные effective scenes; ни один snapshot/asset/event не содержит соседнюю карту.                  |
| Нет assignment в READY workspace         | Нейтральный waiting screen без scene/entity/asset IDs; GM получает диагностику.                                 |
| Reassignment                             | Старый canvas очищается, показывается loading, затем атомарно заменяется новой projection.                      |
| Reconnect / late join                    | Assignment восстанавливается из БД; клиент не выбирает scene.                                                   |
| GM reload                                | READY workspace/layout/assignments восстанавливаются; workspace camera может сброситься локально.               |
| Удаление item                            | `409`, пока есть assignments; сначала переназначить/очистить. Scene не удаляется cascade.                       |
| Удаление populated scene                 | Отказ при workspace/world-map/encounter/assignment references; отдельный archive/remediation flow.              |
| Перемещение item                         | Меняется только GM transform; scene entities не двигаются.                                                      |
| Перекрывающиеся items                    | Разрешены только как GM layout, но UI предупреждает и даёт z-order; privacy не меняется.                        |
| Undo transform / restore detach          | Явная revisioned GM-команда; прежний layout/связь восстанавливаются без отката scene entities или assignments.  |
| Archive / restore workspace              | Активный или назначенный workspace защищён от archive; restore возвращает проверенный layout в DRAFT, не READY. |

## 12. Совместимость и миграция

- Миграция additive: новые tables/enums/indexes, без backfill существующих
  scenes/tokens/fog/drawings.
- При отсутствии READY workspace для текущей anchor scene и assignment
  snapshot/API остаются побайтно совместимы по поведению.
- Workspace создаётся поверх существующих scenes; single-map scene не требует
  ручной конвертации.
- Feature rollout: schema first → server readers with fallback → commands →
  player projection → GM UI → player transition UI.
- Downgrade до старого server разрешён только пока READY workspace нет; после
  активации rollout требует явного compatibility gate.
- Будущая schema-реализация обязана обновить Drizzle journal/snapshot,
  `infra/backup/database-counts.sql`, restore rehearsal, gameplay reset,
  migration/backup/reset tests и документацию таблиц.

## 13. Performance assessment и бюджеты

### Почему не расширять обычный snapshot

Текущий GM snapshot уже специально ограничивает fog/drawings активной и одной
рассматриваемой сценой. Возврат canvas всех items отменит это ограничение и
снова сделает payload линейным по числу карт.

Текущий renderer не имеет полноценного viewport culling: grid создаёт линии на
весь world, fog cache размером со scene, а mounted scene держит все drawings,
rulers, pings и cursors (`Orthographic2DRenderer.tsx:104-145,604-673,
1718-1746,2639-2939`). Несколько постоянно смонтированных Stage умножат эти
расходы, поэтому compositor обязан управлять lifecycle tiles.

### Предварительные ограничения MVP

- contract hard cap: 8 items на workspace;
- product default до замера: не больше 4 карт;
- PLAYER: ровно 1 full-resolution map asset/canvas projection;
- GM: layout summaries всех items, но full canvas только у видимых/активно
  редактируемых tiles;
- одновременно mounted full `react-konva` Stage: сначала 2, затем увеличить
  только после замера памяти/FPS;
- runtime derivative одного map asset: не больше 4096×4096; исходник может
  храниться отдельно, но не декодироваться в каждом tile;
- ориентир decoded raster budget вкладки: 256 MiB;
- offscreen tiles unmount canvas и освобождают decoded images/listeners;
- никакого скрытого asset preload у PLAYER.

Числа — не обещание производительности, а безопасные стартовые limits. Перед
увеличением измерить матрицу 1/2/4/8 карт:

- snapshot bytes и DB query count отдельно для GM и каждого PLAYER;
- число asset requests и decoded image memory;
- JS heap, canvas memory, FPS/pointer latency и время первого usable frame;
- reconnect burst GM + 6;
- culling/unmount и повторное открытие tile.

Gate: player payload не растёт с количеством скрытых workspace items; GM
metadata растёт линейно, canvas payload — только с числом видимых tiles.
Предварительные interaction targets: p95 frame не хуже 33 ms и отсутствие long
task больше 100 ms при reassignment. Эти thresholds валидируются замером, а не
объявляются уже достигнутыми.

## 14. Regression matrix

### Contracts / unit

- strict bounds, UUID, finite transforms, max batch/items;
- effective-scene projector не принимает player-provided scene ID;
- layout transform не меняет local token/fog/drawing coordinates;
- undo/redo transform сохраняет scene-local coordinates и camera state;
- READY без valid assignment всегда даёт waiting, legacy fallback допустим
  только без READY workspace текущего anchor;
- monotonic assignment revision и stale snapshot rejection.

### PostgreSQL / integration

- composite campaign FKs и cross-campaign rejection;
- один workspace на campaign/anchor scene и корректный lifecycle;
- exact retry / changed-payload conflict / concurrent assignment CAS;
- lock races assignment ↔ player token mutation и assignment ↔ ephemeral relay;
- batch assignment all-or-nothing;
- remove item / archive workspace / delete scene safeguards;
- transform undo/redo: revision CAS, exact retry, stale overwrite rejection и
  invalidation redo после новой правки;
- detach/restore: тот же item ID, scene reference и transform, без изменения
  scene entities и восстановления assignments; populated scene не удаляется;
- restore с missing/foreign scene, занятым item/anchor или превышением лимита
  отклоняется атомарно, без частичных rows, нового receipt или asset grants;
- archive текущего READY workspace или workspace с assignments отклоняется;
  restore допустимого архива даёт DRAFT, повторный READY требует отдельной
  команды, transaction failure сохраняет прежнее состояние архива;
- migration from populated single-map fixture without data rewrite.

### Projection / privacy

- два игрока на разных scenes видят только свои scene/entity/asset IDs;
- hidden IDs отсутствуют во всех nested collections, events и audit DTO;
- GM видит layout, PLAYER — нет;
- direct asset content denies old/foreign/unassigned scene;
- player search/a11y fixture не содержит hidden names/counts;
- GM undo before-images и archived/detached items не появляются в PLAYER
  snapshot/audit/asset ACL; restore не возрождает историческое назначение;
- world-map links и UIX-311 encounter не расширяют assignment projection.

### Realtime / multiplayer

- GM + 6: 3/3 split, несколько игроков на item и один в fail-closed waiting;
- reassignment при in-flight cursor/ruler/token preview;
- old scene event после commit не приходит;
- loading → one authoritative snapshot → interactive;
- pre-commit failure keeps old view; post-commit delivery failure resyncs from
  blank state;
- reconnect, late join, backend restart и exact command retry;
- campaign isolation и pause guards сохраняются.

### Browser QA

- GM composition с 1/2/4 картами, pan/zoom/culling и keyboard focus;
- player transition на разных viewport sizes;
- отсутствие скрытых DOM nodes, image requests и accessible labels;
- undo transform и restore detach не двигают entities; конфликт показывает
  refresh без overwrite, restore archive не переключает карту игрока;
- overlap warning, populated deletion block и explicit token transfer preflight.

Новый privacy-тест проходит обязательную диверсию: временно добавить hidden
workspace item или его map asset в PLAYER DTO и убедиться, что падает ровно
целевой тест, затем восстановить projector.

## 15. Будущие implementation pools

1. **Domain/schema** — contracts, additive migration, workspace/items/
   assignments repositories, CAS/idempotency, backup/reset coverage.
2. **Player projection + asset ACL** — effective scene, safe snapshot, content
   authorization, two-campaign integration tests.
3. **Realtime assignment** — atomic GM command, audience resolver, assignment
   guards, reconnect and PostgreSQL race probe.
4. **GM workspace projection** — layout API, on-demand visible-tile canvas,
   culling/performance instrumentation.
5. **GM authoring UI** — composition, assignment controls, safeguards. Этот пул
   отдаётся отдельной UI-полосе и может затронуть конфликтные web-файлы.
6. **Player transition UX** — loading/fail-closed/resync, browser QA. Также
   отдельная UI-полоса.
7. **Release gate** — full quality gate, E2E, isolated multiplayer, backup/
   restore rehearsal на test fixture и ручной GM + 6 сценарий.

Каждый implementation pool получает отдельную Linear subtask/branch. UIX-319
не должна превращаться в один смешанный schema + server + renderer + UI PR.

## 16. Gate decision и открытые продуктовые вопросы

Архитектурная рекомендация считается готовой к review при подтверждении:

- model 3: linked tactical scenes in a GM workspace;
- `activeSceneId` остаётся anchor/fallback, assignment — отдельная authority;
- один campaign-global encounter lifecycle сохраняется;
- hard cap 8 / default 4 до измерений;
- первая реализация не переносит token drag между scenes автоматически.

Перед production implementation владелец продукта должен отдельно решить:

1. Видят ли игроки вне encounter scene сам факт/очередь общего боя.
2. Нужна ли persistence workspace camera у GM или достаточно локального reset.
3. Должно ли удаление workspace item только отсоединять scene (рекомендация)
   или предлагать отдельный архив scene.

До review этих решений схема и UI не реализуются.
