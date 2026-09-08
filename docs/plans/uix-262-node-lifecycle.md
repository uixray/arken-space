# UIX-262 — индивидуальный архив и player projection, source candidate

## Решение и ревизия

- Только существующая UIX-262, исходный AC7: мастер может архивировать отдельное
  заклинание. Новые задачи, Backlog и новый UI-редактор не входят в этот срез.
- База: `6f093f0b6f87bfe34afeeed6c23bdb7974096188`.
- Подготовлен тест настоящих Fastify spell-pack и assignment routes поверх
  существующего Drizzle/PGlite с полным набором миграций.
- На неизменённом runtime базы получены два адресных remote FAIL: clone/
  assignment и actual player projection. Подробности ниже. После этого root
  разрешил минимальный source fix. Связанный remote gate после исправления
  прошёл: 13 файлов / 86 тестов; обе реальные source-диверсии обнаружены,
  после байт-точного восстановления снова 13 файлов / 86 PASS.
  Это проверенный source-срез, не готовый релиз и не закрытая UIX-262.

## Publish/assignment baseline: сценарий и oracle

1. GM создаёт DRAFT pack с независимыми узлами A и B и публикует ACTIVE v2.
2. Через реальный assignment route первый персонаж получает A; сохраняется
   точный неизменяемый snapshot правил и provenance.
3. GM отправляет DRAFT v3: A имеет `ARCHIVED`, B — `DRAFT`; тексты и provenance
   намеренно отличаются от версии первого назначения.
4. GM публикует ACTIVE v4. Ответ и сохранённый graph сравниваются с БД.
5. Второму персонажу пытаются назначить A и B. B должен назначиться; A должен
   остаться `ARCHIVED` и получить `422 SPELL_NODE_NOT_ACTIVE` без event/строки.
6. Первое назначение A остаётся в единственной исходной версии с точным старым
   snapshot. Разные персонажи исключают маскировку дефекта duplicate-target
   отказом; между A/B нет prerequisite, который дал бы посторонний отказ.

На исходной базе `cloneGraphVersion()` присваивал lifecycle пакета каждому узлу.
Remote baseline получил адресное падение oracle: `ACTIVE / 201 / undefined` вместо
`ARCHIVED / 422 / SPELL_NODE_NOT_ACTIVE`. До этого oracle проверяются успешное
назначение B, сохранение истории A и неизменность записанного DRAFT v3.

## Изменённые файлы и команда

- `apps/server/src/spell-pack-routes.integration.test.ts`: одно новое связанное
  поведение; подключён существующий production assignment route. Старые тесты
  и их ожидания сохранены. После FAIL добавлен отдельный control для DRAFT →
  REFERENCE → ACTIVE → whole-pack archive; исходный baseline body не изменён.
- `apps/server/src/spell-projection-routes.integration.test.ts`: отдельный
  projection baseline с реальными auth/owner/controller/version-anchor guards.
  Три прежних теста и их fixtures не изменены.
- `apps/server/src/spell-pack-routes.ts`: сохранение `ARCHIVED` при clone.
- `apps/server/src/spell-projection.ts`: lifecycle argument и guard после
  privacy/individual-assignment guards; существующий caller передаёт lifecycle.
- `apps/server/src/spell-projection.test.ts`: три controls для DRAFT/REFERENCE/
  ARCHIVED; existing discovery, GM_ONLY privacy, active branch, rank и orphan.
- Этот план. Конфигурация, schema, storage, migrations и UI не менялись.

Только на согласованном off-laptop runner, после одного frozen install и
сборки `@arken/contracts`, `@arken/system`, `@arken/db`, root запускает gates.
На ноутбуке install/build/test запрещены; недоступный runner не даёт исключения.

Команда исходного baseline до source fix и дополнительных controls:

```powershell
pnpm exec vitest run apps/server/src/spell-pack-routes.integration.test.ts apps/server/src/spell-projection-routes.integration.test.ts -t "UIX-262" --maxWorkers=1 --reporter=verbose
```

Оба адресных FAIL получены. Далее — связанный regression pool, source-diversion
и общий gate. Подготовленные изменения не выдают PostgreSQL/Docker, browser,
runtime cadence, production или полную UIX-262 за проверенные.

## Projection baseline: независимый сценарий и oracle

Тест `UIX-262 hides unassigned archived nodes but preserves assigned snapshots`
пишет fixture в настоящую PGlite БД с миграциями, затем вызывает production GET
через Fastify. Resolver, auth, загрузчик assignments и graph validator не
подменяются. Это не чистый formatter/unit и не отказ доступа вместо проверки.

1. Отдельный pack содержит старый ACTIVE v1 и текущий ACTIVE v2. В v2 A имеет
   `ARCHIVED` с новыми mechanics/revision; независимый B остаётся `ACTIVE`.
   Третий ACTIVE C имеет действительный prerequisite A → C. Он делает проверку
   удаления рёбер содержательной, не мешая B быть `AVAILABLE`.
2. Два новых персонажа имеют настоящие owner и controller. Для каждого
   production snapshot builder создаёт SCHOOL grant с точным anchor v2.
   Только исторический персонаж дополнительно имеет NODE A snapshot из v1.
   Snapshot не редактируется вручную, его полная строка в БД сохраняется.
3. Все четыре player GET (оба персонажа × owner/controller) обязаны вернуть
   `200`, `private, no-store`, верные character/pack/version IDs и B с
   `AVAILABLE`/настоящими mechanics. Owner/controller payloads равны.
4. До адресного privacy oracle старый A обязан быть `DISCOVERED` с mechanics
   v1 без новых архивных mechanics/revision; прежнее ребро A → C сохранено.
   После GET вся единственная строка истории A сравнивается с исходной.
5. GM GET обязан вернуть `200` и полный graph v2 с архивным A и ребром A → C.
   Это исключает пустую fixture или глобальное удаление узла как решение.
6. Для нового персонажа C остаётся `LOCKED`: архивирование не засчитывает
   prerequisite автоматически. Payload не содержит ID A, его mechanics или
   рёбер с endpoint A; остаются только B/C, список рёбер пуст.

Полученный адресный FAIL — `containsArchivedId / containsArchivedMechanics /
containsArchivedEdge = true / true / true` вместо трёх `false`. Все успешные
HTTP/anchor/B/GM/immutable-history controls выполняются до этого oracle.
Повторно доказывать owner/controller privacy разными synthetic responses не
нужно: оба настоящих payload сначала сравниваются на полное равенство.

**Граница:** mixed-lifecycle graph и assignments намеренно сохранены через
fixture DB insert; настоящую GM-публикацию проверяет отдельный неизменённый
publish/assignment baseline. Этот тест не заявляет proof публикации, POST
assignment, concurrency, browser или PostgreSQL. Отдельно каждый дефект должен
падать именно на своём oracle; setup/validation/404 ошибка baseline не заменяет.

## Блокеры и следующий шаг

- Remote baseline на базе: **2 failed, 9 skipped**, 16.74 s. Падения именно
  на clone oracle (`417:8`) и projection oracle (`854:10`), не setup/import/
  runtime error; предшествующие положительные controls достигнуты.
- Wrapper вернул 42 из-за формата classifier. Это не PASS: основание для fix —
  два фактических assertion failures, а не exit classifier.
- Локально после resource constraint — только small read/edit/static checks.
  `git diff --check` PASS. Formatter/install/build/Vitest/Playwright/services
  не запускались; `node_modules` отсутствует, Git/Linear writes не выполнялись.
- Независимый read-only source/test review: actionable findings нет; это
  статический review, не post-fix runtime gate. Оба исходных oracle сохранены.
- Открытый gate: один off-laptop connected regression pool и обе
  production-source диверсии с восстановлением. До результатов
  source candidate не считается runtime-исправлением или готовым релизом.

## Реализованный минимальный source diff после remote FAIL

Изменены только две функции и один caller; новых маршрутов/переходов нет.

1. `apps/server/src/spell-pack-routes.ts`, `cloneGraphVersion()`:
   при клонировании узла сохранить `ARCHIVED`, иначе использовать lifecycle
   целевого pack. Это одна условная ветка вместо безусловного присваивания.
   Не менять маршруты, CAS/actionId, audit, schema, provenance или миграции.
   Обычные узлы по-прежнему проходят DRAFT → REFERENCE/ACTIVE; архивирование
   всего pack по-прежнему архивирует все узлы. Матрица переходов pack остаётся
   прежней; ACTIVE/ARCHIVED не получают нового перехода через `/lifecycle`.
2. `apps/server/src/spell-projection.ts`, `nodeState()`:
   перед изменением получен отдельный remote FAIL на mixed-lifecycle graph
   в настоящем projection, без подмены resolver или обхода owner/anchor guards.
   Передать lifecycle текущего узла. Сначала сохранить school privacy guard,
   затем существующий индивидуальный assignment → DISCOVERED, затем
   не-ACTIVE узел без такого assignment → HIDDEN; остальные правила неизменны.
   School grant сам по себе не раскрывает архивные mechanics. Не удалять
   архивный узел из GM graph и не отбрасывать старые assignment snapshots.
   Текущий player allowlist и фильтр рёбер по видимым endpoints сохраняются.
3. `buildSpellAssignmentSnapshot()` уже отвергает не-ACTIVE узлы кодом
   `SPELL_NODE_NOT_ACTIVE`; его ослаблять или дублировать новый guard не нужно.

Это исправляет индивидуальное архивирование, а не запрещает явное последующее
решение GM восстановить узел в новой DRAFT версии. Если мастер сам изменил его
lifecycle, это новый intent; без такого изменения публикация архив не снимает.

## Независимые риски и обязательные controls

- **Архив исчезает при промежуточном REFERENCE:** проверить прямой DRAFT →
  ACTIVE и DRAFT → REFERENCE → ACTIVE; A архивен, обычный B опубликован.
- **Новая публикация уничтожает старую способность:** назначение A из старой
  ACTIVE версии остаётся DISCOVERED с точными старыми mechanics/provenance;
  новое назначение A запрещено. Контроль использует разные character IDs.
- **Клонирование исправлено, но данные раскрывает projection:** новый владелец
  school grant + anchor той же ACTIVE версии не получает A, его mechanics
  или рёбра с endpoint A; B доступен. GM получает полный graph с A. Для старого
  владельца A виден только его immutable snapshot, не новые архивные тексты.
- **Тест скрыл утечку через 404:** HTTP projection control должен сначала
  доказать действительные owner/controller и точный version anchor; успешный
  ответ 200 обязателен, denied/пустой запрос не заменяет проверку payload.
- **Privacy regression для прежнего назначения:** GM_ONLY school остаётся
  HIDDEN даже при существующем assignment; foreign campaign, moved-school
  composite identity и orphan snapshot controls сохраняются.
- **Архивирование меняет правила прогрессии:** не удалять prerequisite groups
  и не засчитывать недоступный узел автоматически. Сохранить ALL/ANY, rank,
  GM override, cycle/cross-pack checks и независимость layout.
- **История/повторы:** сохранить exact replay, stale CAS, metadata-only audit,
  отказ нового assignment без event/строки, полное pack archive и legacy
  catalog compatibility. DB-история не переписывается задним числом.

## Remote evidence и границы следующего gate

До fix: зафиксировать точный SHA, hash теста, command, exit и failure oracle.
Исторический SHA-256 файла publish/assignment baseline до добавления отдельного
REFERENCE control:
`15A0FDB3EC031C7EB63345F6E47DA8C14FB6A0B52FF4864DB3C20E584566F25B`.
Baseline body сохранён байт-в-байт после LF-нормализации; его SHA-256 до/после:
`1C25AE6B10819790923446A77619A36A344050BA96F14D5FE61963CB25A5F6AA`.
SHA-256 неизменённого файла actual projection baseline:
`058850CB770C1360E968C5CD79621536093E3DF446BF6004E7738407E9DB41CC`.
Оба hash относятся к локальным файлам до remote checkout/нормализации EOL.
Перед запуском runner фиксирует собственные hash и точный revision.

Source freeze после минимального fix (локальные SHA-256):

- `spell-pack-routes.ts`:
  `39569E0ACE58222F9B634A7E72C107474769100BC9E702B1F40215E43993B8F4`.
- `spell-projection.ts`:
  `FF15E9E8E233B0B2B7FF2836BCCB911C811F94455E99EE0B3FB2E6E6B5B33137`.
- `spell-pack-routes.integration.test.ts` с отдельным REFERENCE control:
  `821B7949DD2243F3F1F668BE33C94263D3873943961F97E4AFECFDE51A2A41D3`.
- `spell-projection.test.ts` с тремя lifecycle controls:
  `F4BA2F8D9E0672260536C6A846C0EBE09AF0E61489038673BE10268A59684C8D`.

После fix выполнен один связанный pack/assignment/projection/contracts набор
и новые projection controls: 13 файлов / 86 PASS, без skips/todo. Затем две
адресные production-source диверсии в одноразовом тестовом дереве: возвращён
безусловный clone lifecycle и отдельно удалён projection lifecycle guard.
Обе получили ожидаемый exit 1 именно на исходных oracle (417:8 и 854:10),
а не на инфраструктурной ошибке. Между диверсиями и при завершении проверено
байт-точное восстановление runtime и неизменность тестов/source/lockfile.
Повторный восстановленный набор: те же 13 файлов / 86 PASS без skips/todo.

Gate выполнен 8 сентября 2026 года удалённо с лимитом 1 CPU / 2 GiB RAM,
20 минут максимум; фактическое время 2 мин 49 с. Рабочее дерево, кэш и
зависимости удалены, отсутствие собственного cgroup и каталога проверено
снаружи. Production был недоступен тестовым процессам и остался на прежней
здоровой ревизии. Это не production visibility acceptance.

Итог: общие CI checks и isolated multiplayer с настоящим PostgreSQL, так как
меняется player visibility. Прежние 80 PASS не заменяют этот gate. Нет нового
UI, потому browser-поток сам по себе этим планом не добавляется. Не выдавать
этот срез за runtime cadence, production-проверку или закрытие всех UIX-262 AC.
