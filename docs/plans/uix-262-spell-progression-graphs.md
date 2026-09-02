# UIX-262 — версионируемые графы школ магии

## Исходное состояние

- Baseline: `origin/main` `23683ae`.
- Универсальной модели spell pack / school / node / requirement group нет.
- Существующий каталог `SKILL | ABILITY` умеет выдавать персонажу независимый
  снимок записи, но его cadence ограничен `DAY | BATTLE | WEEK`, а связей между
  способностями нет.
- Review-only фикстура `docs/content/magic-schools.json` уже содержит 13 школ,
  145 узлов и 114 прочитанных вручную связей. В ней нет висячих ссылок,
  дубликатов рёбер и циклов; есть развилки, схождения и изолированные узлы.
- Связи фикстуры и шесть схождений не подтверждены мастером. `ALL` либо `ANY`
  для них неизвестно, поэтому фикстура не является production seed.

## Декомпозиция в Linear

Родительская UIX-262 разбита на независимые этапы:

1. **UIX-575** — контракты, чистый валидатор и проверка review-only фикстуры.
2. **UIX-576** — umbrella хранения и GM API, разделённый на
   **UIX-579** (persistence/migration) и **UIX-580** (GM-команды).
3. **UIX-577** — снимки назначений и аудируемый prerequisite override.
4. **UIX-578** — безопасные player/GM projections и review-only импорт.

UIX-575, UIX-579, UIX-580 и UIX-577 имеют отдельные локальные коммиты и
переведены в `In Review`. Текущий пул выполняет только UIX-578; umbrella
UIX-576 остаётся отдельной задачей Linear и не закрывается этим коммитом.

## Решения доменной модели

1. Хранить граф плоским нормализованным снимком одной версии pack: отдельно
   pack version, schools, nodes, requirement groups и edges. Каждая дочерняя
   сущность несёт `packId` и `packVersionId`, чтобы валидатор мог закрыто
   обнаружить смешение пакетов и версий до БД.
2. Разделить стабильную lineage pack (`packId`) и неизменяемую версию
   (`versionId`, положительный номер версии). Layout остаётся presentation-only
   metadata и не участвует в вычислении prerequisites.
3. Описывать способность раздельными полями: исходное/отображаемое имя,
   narrative, mechanics, activation, structured costs, usage limit,
   duration/range/target/area, roll actions и effects. Исходная формулировка
   сохраняется вместе с provenance.
4. Activation задаётся парой `passive` + `triggers`. Так без специального
   исключения выражаются passive-only, active-only и hybrid записи.
5. Cadence поддерживает `TURN`, `COMBAT`, `SHORT_REST`, `LONG_REST`, `DAY`,
   `WEEK`, `SESSION`, `CAMPAIGN`, `MONTH` и `CUSTOM` с обязательным raw text.
   Формулировка «1 в час» из референса пока остаётся `CUSTOM`: этот пул не
   обещает runtime reset без решения campaign clock.
6. У каждого зависимого узла может быть несколько requirement groups. Все
   группы соединены логическим AND; внутри группы явно действует `ALL` либо
   `ANY`. Для непубликуемых `DRAFT`, `REFERENCE` и `ARCHIVED` разрешено
   значение `UNRESOLVED` с warning, а для `ACTIVE` — только ошибка.
7. Изолированный узел, несколько корней и школа без рёбер допустимы. Координаты
   никогда не создают скрытую зависимость.
8. Валидатор возвращает отсортированные `errors` и `warnings`, а не бросает
   исключение на первой проблеме. Структурными ошибками во всех lifecycle
   являются duplicate IDs/edges, dangling reference, self edge, cross-school,
   cross-pack/cross-version corruption и cycle.

## UIX-575 — контракты и валидатор

### Файлы

- `packages/contracts/src/spell-schools.ts` — Zod-контракты, типы и чистый
  валидатор.
- `packages/contracts/src/index.ts` — публичный export.
- `tests/spell-school-graph.test.ts` — synthetic graph и проверка реальной
  reference fixture.
- `docs/uix-575-spell-graph-contracts-checkpoint-2026-09-01.md` — checkpoint
  после гейтов.

### Проверки поведения

1. Ветвление и схождение с `ALL` и `ANY` принимаются.
2. Passive-only, active-only и hybrid узлы принимаются.
3. Все обязательные cadence и custom raw cadence принимаются.
4. Cycle, dangling/self edge, duplicate IDs/edges и смешение школы,
   pack/version отвергаются отдельными кодами ошибок.
5. Изолированные узлы и zero-edge school принимаются.
6. `UNRESOLVED` остаётся предупреждением в reference pack и блокирует ACTIVE.
7. Изменение layout не меняет семантический результат.
8. Реальная фикстура даёт ровно 13 / 145 / 114, сохраняет исходный текст,
   остаётся `REFERENCE` и не содержит структурных ошибок.
9. Порядок результатов детерминирован.

### Диверсия

Временно отключить cycle detection и запустить только тест cycle rejection.
Ожидается падение ровно этого теста; затем вернуть проверку и повторить target.

### Гейты

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

UI и пользовательский поток не меняются, поэтому `test:e2e` не требуется.
Persistence, ACL, realtime и миграции не меняются, поэтому
`test:multiplayer` не является гейтом UIX-575.

## UIX-578 — текущий пул

- Player-safe и полный GM payload разнесены по разным маршрутам. Безопасный
  payload строится allowlist-ом: `GM_ONLY` отсутствует во всех структурах,
  locked node не содержит mechanics, provenance или условий рёбер.
- Состояния `DISCOVERED | AVAILABLE | LOCKED | HIDDEN` вычисляются общим
  prerequisite evaluator по текущим immutable assignment snapshot-ам. Layout
  не участвует в доменной логике.
- Review import является stateless preview без runtime-доступа к
  `docs/content`: adapter жёстко строит `REFERENCE`, после чего GM при желании
  сохраняет candidate существующей командой create.
- 31 неоднозначность сохраняется внутри graph как `OPEN` import warning, а
  шесть неизвестных схождений — как `UNRESOLVED` requirement group. Все 37
  предупреждений разрешены для review и становятся ошибками при promotion в
  `ACTIVE`.
- Изменение visibility/access требует PostgreSQL probe и полного
  `test:multiplayer`; UI-поток и hot frontend-файлы в пул не входят.

## Следующие пулы и блокеры

- Runtime reset для часовых/месячных/session cadence зависит от отдельного
  решения campaign clock; хранение raw cadence этим не блокируется.
- Promotion референса 2024 в ACTIVE заблокирован до подтверждения мастером
  рёбер, шести схождений и 31 неоднозначной записи.
- Визуальный player graph, GM-редактор и spell cards остаются отдельными
  продуктово-интерфейсными задачами и не входят в серверный UIX-578.
