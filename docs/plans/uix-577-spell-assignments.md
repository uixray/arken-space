# UIX-577 — снимки назначений заклинаний и аудируемый override

## Контекст и замер

- Ветка `codex/uix-577-spell-assignments` создана после проверки неизменившегося `origin/main@23683ae` и stacked на локально проверенные UIX-575 `1d3a966`, UIX-579 `9ad3456` + `662f440` и UIX-580 `f4dccc8`.
- Legacy `character_catalog_entries` уже копирует skill/ability template при назначении, поэтому последующее изменение каталога не меняет снимок персонажа. Но эту строку можно редактировать и удалять, она не фиксирует spell pack/version, а prerequisite graph в legacy-модели отсутствует.
- `spell_packs`/`spell_pack_versions` разделяют стабильную lineage и immutable graph snapshots. UIX-580 разрешает назначать только после явной GM-публикации версии в `ACTIVE`; reference import сам каноном не становится.
- Player snapshot сейчас не содержит spell pack, assignment или `game_events`. UIX-577 не добавляет player projection и не должен случайно раскрыть hidden mechanics; role-filtered projections остаются UIX-578.

## Границы

В задачу входят новые contracts, две append-only campaign-scoped таблицы, GM-only команды initial assignment и следующего состояния assignment, server-built snapshot, проверка prerequisites, обязательная причина override, actionId/CAS/audit, backup/reset coverage, route registry, PGlite integration и PostgreSQL multiplayer probe.

Не входят player/GM read projections, UI, runtime расход/recharge spell usage, import 2024 fixture и автоматическая миграция legacy skills/abilities. Legacy JSON-поля персонажа, `catalog_entries`, `character_catalog_entries` и их маршруты остаются без изменения.

## Решение

### 1. Append-only модель назначения

Добавить enum `spell_assignment_kind = SCHOOL | NODE` и две таблицы:

1. `character_spell_assignments` — стабильная identity: `id`, `campaign_id`, `character_id`, `pack_id`, `created_at`. Составные FK доказывают принадлежность character и pack той же кампании.
2. `character_spell_assignment_versions` — неизменяемое состояние: `id`, `campaign_id`, `assignment_id`, `character_id`, `pack_id`, `pack_version_id`, положительные `version` и node `rank`, `kind`, `school_id`, nullable `node_id`, server-built `snapshot`, nullable `override_reason`, `assigned_by_membership_id`, `created_at`.

Уникальности `(campaign_id, assignment_id, version)` и `(campaign_id, id)` сохраняют последовательную историю. Составной FK к `(campaign_id, pack_id, pack_version_id)` требует дополнительного уникального индекса у `spell_pack_versions` и исключает смешение pack/version на уровне PostgreSQL. SQL triggers запрещают UPDATE stable identity/version rows и прямой DELETE истории, пока существует parent assignment; cascade character/campaign reset остаётся допустимым.

Составной FK автора `(campaign_id, assigned_by_membership_id)` остаётся `NO ACTION`, но в SQL объявлен `DEFERRABLE INITIALLY DEFERRED`: удалить отдельный membership с существующим audit нельзя, зато удаление всей кампании успевает каскадно убрать и assignments, и actors до проверки ограничения. Drizzle не умеет выразить этот PostgreSQL clause в schema builder, поэтому ручная часть миграции закрепляется PGlite и PostgreSQL probe.

Snapshot schema v1 фиксирует assignment/version identity, номер и lifecycle pack version, graph provenance, target school, optional target node с rank и только requirement groups/edges этого node. Snapshot строит сервер из immutable graph; клиент никогда не присылает mechanics.

### 2. GM-команды

- `POST /api/characters/:characterId/spell-assignments` — создаёт stable assignment и immutable version 1 при `expectedVersion: 0`.
- `POST /api/characters/:characterId/spell-assignments/:assignmentId/versions` — под parent lock и CAS добавляет следующую version; так reassignment, переход на новую pack version и rank upgrade становятся явным новым состоянием, а не UPDATE истории.

Обе команды принимают client-generated `actionId`, assignment/version IDs, точную `packId`/`packVersionId`, discriminated target `SCHOOL` либо `NODE`, и optional `overrideReason`. Назначение допускается только из валидной `ACTIVE` pack version; NODE дополнительно требует `node.lifecycle = ACTIVE`.

Точный retry `(campaignId, actionId)` возвращает сохранённую version. Повторное использование action с другим actor или canonical command hash возвращает `409`. Event и assignment version записываются одной транзакцией. Все assignment writes сериализуются блокировкой campaign-scoped character row, чтобы concurrent prerequisite/duplicate checks видели последовательное состояние.

### 3. Prerequisites и override

- Текущим состоянием каждой stable assignment считается версия с максимальным номером; предыдущие snapshots не участвуют в вычислении.
- Для NODE учитываются current node assignments того же character, pack и school; append исключает предыдущую версию собственной lineage.
- Все requirement groups target node соединяются AND; внутри `ALL` нужны все edges, внутри `ANY` хотя бы один.
- `minimumRank` проверяется по сохранённому rank source assignment. `threshold` и `gmGrantCondition` fail-closed считаются требующими ручного решения, пока для них нет отдельной структурированной runtime-модели.
- Если prerequisites не выполнены и непустого trimmed `overrideReason` нет, команда отклоняется без version/event. С причиной команда проходит и пишет event `character_spell_assignment.overridden` с reason и metadata unmet checks. Причина при полностью выполненных prerequisites отклоняется как ложный override.
- Обычные события: `character_spell_assignment.assigned` и `character_spell_assignment.reassigned`. Audit не содержит node mechanics или полного graph.

### 4. Legacy compatibility и lifecycle

- Старые `skills`, `spells`, `catalog_entries`, `character_catalog_entries`, roll/recharge endpoints и DTO не переопределяются и не мигрируются автоматически.
- Новая модель additive: legacy catalog snapshot и spell assignment могут существовать у одного character независимо. Это проверяется regression-тестом; lossy автоматическое преобразование rich spell node в legacy `ABILITY` запрещено.
- Gameplay reset удаляет stable assignments целевой кампании до spell packs; version history уходит только cascade. Backup/restore allowlists и schema-count tests включают обе таблицы.

## Проверки

1. Contract tests: strict envelopes, SCHOOL/NODE target, positive rank, mandatory trimmed override reason и server snapshot schema.
2. Persistence/migration tests: composite tenant FK, pack/version match, JSON identity CHECK, append sequence, immutable UPDATE/direct DELETE, character/campaign cascade и свежая миграция без seed.
3. HTTP integration:
   - root node → dependent node; pack v2 не меняет v1 assignment snapshot;
   - reassignment/rank upgrade создаёт version 2, version 1 остаётся byte-for-byte прежней;
   - missing prerequisite и empty reason ничего не пишут; непустая причина создаёт metadata-only audit;
   - exact retry, action conflict, stale CAS, duplicate current target, PLAYER 403 и foreign 404;
   - legacy catalog route и snapshot продолжают работать рядом с новой моделью.
4. Route registry и исполняемые two-campaign probes для обоих mutation routes.
5. Отдельная PostgreSQL 17 probe до Playwright: real HTTP assignment/override, concurrent CAS, immutable trigger, tenant FK, reset/cascade и audit payload.
6. Обязательная диверсия: временно ослабить `overrideReason` до допуска пустой строки; точный тест empty-reason обязан упасть, после восстановления — пройти.
7. Полный гейт строго последовательно: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`. Затем напрямую без pipeline: `DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true`, `pnpm test:multiplayer`, с немедленным сохранением `$LASTEXITCODE`.

## Стоп-условия

- Не добавлять player projection, realtime payload, UI, import fixture, automatic legacy conversion или production seed.
- Не принимать snapshot/mechanics от клиента и не помещать mechanics/full graph в `game_events.payload`.
- Не трогать `apps/web/src/styles.css`, `apps/web/src/App.tsx`, `apps/web/src/sidebar/ChatPanels.tsx`, assets или stickers.
- Не использовать production-данные, не запускать deploy, не пушить ветку и не создавать/мержить PR без решения пользователя.
