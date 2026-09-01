# UIX-578 — безопасные проекции графа и review-only импорт

## Исходное состояние и замер

- Ветка `codex/uix-578-safe-projections` снята с проверенного magic-стека на `0d05a71`; свежий `origin/main` остаётся `23683ae`.
- Server имеет только пять GM-команд spell pack и две GM-команды assignment. Read API для progress graph и import endpoint отсутствуют.
- `docs/content/magic-schools.json` подтверждён targeted-тестом: 13 школ, 145 узлов, 114 рёбер и 31 запись `требуетУточнения`; адаптер сейчас существует только внутри теста.
- Валидатор дополнительно находит шесть `UNRESOLVED_REQUIREMENT_GROUP`. Только они сейчас блокируют `ACTIVE`; 31 source ambiguity после ответа импортёра была бы потеряна.
- Immutable assignment snapshots уже содержат закреплённые mechanics/provenance. `spell_pack_versions.graph` JSONB способен хранить review markers; новая таблица и миграция не нужны.
- Fixture не является seed: после migrations и `ensureSeed` spell tables пусты, а production Docker image не копирует `docs/`.

## Границы пула

Входят:

1. Строгие player/GM DTO и общий чистый расчёт `DISCOVERED | AVAILABLE | LOCKED | HIDDEN`.
2. Два раздельных read route с явным `packId`/`packVersionId`:
   - `GET /api/characters/:characterId/spell-progression` всегда возвращает только player-safe DTO, даже мастеру;
   - `GET /api/gm/characters/:characterId/spell-progression` возвращает полный GM DTO и требует роль GM.
3. Stateless GM-only preview `POST /api/spell-packs/imports/reference/preview`, который принимает bounded source payload и возвращает `REFERENCE` candidate graph.
4. Persistable structured import warnings и validation gate: `OPEN` — warning у `DRAFT/REFERENCE`, но error у `ACTIVE`; `RESOLVED` требует явной причины в новой immutable версии.
5. Pure adapter референса 2024 с детерминированными IDs, сохранением исходного текста/provenance и без чтения fixture runtime-кодом.
6. Campaign/role isolation, PostgreSQL probe и документация.

Не входят UI, realtime snapshot, runtime расход/recharge заклинаний, автоматическая миграция legacy catalog, node-level visibility, production import и deploy.

## Решения

### Версия и доступ

- Оба read route требуют query `packId` и `packVersionId`; сервер не подменяет явно выбранную immutable версию «последней» draft/reference.
- GM может проецировать любую campaign-scoped версию для review.
- PLAYER получает только `ACTIVE` version и только если одна из его текущих assignment snapshots закреплена за этой парой pack/version.
- PLAYER имеет доступ только к owner/controller character; недоступный, отсутствующий или foreign character/version одинаково скрывается как `404`.
- Ответы получают `Cache-Control: private, no-store` и не добавляются в общий realtime snapshot.

### Состояния узлов

- Current `SCHOOL` assignment даёт `branchGranted` соответствующей школе.
- Current `NODE` assignment делает узел `DISCOVERED`; его mechanics берутся из immutable assignment snapshot, а не из новой версии graph.
- `PUBLIC` школа видима без grant, но её неизученные узлы остаются `LOCKED`, пока branch не назначен.
- `DISCOVERED` школа появляется после любого актуального SCHOOL/NODE assignment.
- `GM_ONLY` полностью отсутствует у игрока даже при assignment; GM видит её как `HIDDEN`.
- `AVAILABLE` требует branch grant и успешный общий prerequisite evaluator; иначе узел `LOCKED`.
- Назначенный узел, исчезнувший из выбранной версии, остаётся `DISCOVERED` из snapshot без выдуманных рёбер.
- Layout не читается при вычислении и не входит в player DTO.

### Privacy DTO

- Player serializer строится allowlist-ом и парсится строгой Zod-схемой; spread полного node/graph запрещён.
- `LOCKED` содержит только identity, display name и state.
- `AVAILABLE`/`DISCOVERED` получают только разрешённые gameplay mechanics без `sourceName`, raw source, provenance, revision data и GM notes.
- Player edges содержат только `sourceNodeId/targetNodeId` и только между уже выданными узлами.
- Hidden IDs отсутствуют также в schools, edges, counts, warnings и layout; prerequisite failures, thresholds, GM conditions, override reason и actor metadata игроку не выдаются.
- GM DTO содержит полный graph, все четыре состояния и prerequisite failures.

### Review-only import

- Preview не пишет БД, не скачивает данные и не читает `docs/content` в runtime. Fixture передаётся явно в request body.
- Adapter жёстко создаёт graph и nodes с lifecycle `REFERENCE`; `ACTIVE` отсутствует во входном контракте.
- Детские UUID детерминированы из `packId/versionId` и source identity, чтобы повторный preview не создавал шумный diff.
- Raw node descriptions сохраняются без замены, provenance содержит bounded canonical source payload, варианты названий и source notes не теряются.
- Все 31 `требуетУточнения` становятся структурированными `OPEN` source ambiguity markers внутри graph. Шесть схождений остаются `UNRESOLVED`, без угадывания `ALL/ANY`.
- Candidate сохраняется существующим `POST /api/spell-packs`, который допускает только `DRAFT/REFERENCE`. Promotion остаётся отдельным `POST /api/spell-packs/:id/lifecycle` и не проходит, пока есть `OPEN` warnings или unresolved groups.
- Закрытие warning выполняется только новой immutable draft-версией с `RESOLVED` marker и причиной; lifecycle transition затем создаёт ещё одну версию и синхронно меняет lifecycle nodes.
- `game_events` остаётся metadata-only: raw source, graph, mechanics и warning texts в audit payload не копируются.

## Реализация по пулам

### Пул A — contracts и доменная логика

- `packages/contracts/src/spell-schools.ts`: warning lifecycle, validation issue, preview contracts, strict player/GM projection schemas.
- `apps/server/src/spell-assignment-storage.ts`: общий prerequisite evaluator для mutation и projection.
- Новый `apps/server/src/spell-projection.ts`: deterministic state calculation и два serializers.
- Новый `apps/server/src/spell-reference-import.ts`: strict bounded adapter и deterministic IDs.
- Pure tests contracts/projection/import, включая fixture 13/145/114 и 31+6 warnings.

### Пул B — HTTP и access

- Новый `apps/server/src/spell-projection-routes.ts`: campaign-scoped character/version load, owner/controller ACL, separate safe/GM routes.
- `apps/server/src/spell-pack-routes.ts`: GM-only stateless reference preview и lifecycle node synchronization.
- `apps/server/src/routes.ts`: регистрация projection routes.
- PGlite integration: owner/controller/GM/other player/foreign campaign, inactive/unassigned version, hidden/locked leakage, preview/create/promotion gate.
- Route inventory в `tests/helpers/campaign-isolation-routes.ts`; literal `:id` не добавляется, поэтому новый `uix413-subrouters` probe не требуется.

### Пул C — PostgreSQL, документация и гейты

- Новый PostgreSQL probe для role/access/privacy и review-only promotion gate; запуск после assignment probe и до Playwright.
- `scripts/run-multiplayer-e2e.mjs` и `tests/multiplayer-runner-report.test.ts`: отдельный exit code/step/report assertions.
- `docs/architecture.md`: три новых route, всего 154; таблиц остаётся 55.
- Обновить parent plan/content README и усилить доказательство отсутствия auto-seed fixture.
- Итоговый checkpoint, локальный commit и Linear stage gate.

## Проверки

1. Pure: четыре состояния, branch grant, ALL/ANY/rank/threshold/GM condition, snapshot mechanics и layout invariance.
2. Privacy: serialized player payload не содержит hidden IDs, secret strings, source/provenance, failure details, layout и hidden counts; locked union не имеет mechanics.
3. HTTP: owner/controller и GM safe-preview проходят; other/foreign получают `404`; PLAYER не входит в GM route и import preview.
4. Import: fixture даёт 13/145/114, 31 persisted source warnings и шесть convergence warnings; preview всегда `REFERENCE`, не пишет БД и не принимает `ACTIVE`.
5. Promotion: reference с хотя бы одним `OPEN` warning не становится `ACTIVE`; после явной resolution применяется только отдельная lifecycle-команда.
6. Production boundary: migrations + повторный `ensureSeed` оставляют spell tables пустыми; runtime не содержит ссылки на fixture path.
7. Full gate строго: `format:check`, `lint`, `typecheck`, `build`, `test`.
8. Access/visibility меняются, поэтому обязателен isolated `test:multiplayer` с `DOCKER_CONTEXT=desktop-linux` и `ARKEN_ISOLATED_ONLY=true`. UI не меняется, отдельный `test:e2e` не требуется.

## Диверсия

Временно добавить `mechanicsText` в allowlist `LOCKED` player node и запустить только privacy-тест. Ожидается падение ровно этого теста; после восстановления строгого union тот же target обязан пройти.

## Блокеры и release

- Блокеров на локальную реализацию нет.
- Production fixture не импортируется и production данные не читаются.
- Push, PR, merge и deploy выполняются только по отдельной просьбе владельца.
