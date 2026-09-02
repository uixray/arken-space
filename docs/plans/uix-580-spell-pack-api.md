# UIX-580 — GM API версий spell pack

## Контекст и замер

- Ветка `codex/uix-580-spell-pack-api` создана после обновления неизменившегося `origin/main@23683ae` и stacked на локальные проверенные зависимости UIX-575 `1d3a966` и UIX-579 `9ad3456` + `662f440`.
- `spell_packs` уже хранит устойчивую campaign-scoped identity, а `spell_pack_versions` — неизменяемые snapshot-ы. Любое изменение содержимого или lifecycle обязано добавлять следующую версию.
- `spell-pack-storage.ts` валидирует Zod/семантику и сериализует append блокировкой parent `FOR UPDATE`, но пока сам открывает транзакцию и не принимает CAS ожидание внешней команды.
- `game_events` уже имеет уникальность `(campaign_id, action_id)` и используется как campaign-scoped idempotency/audit ledger. Player snapshot не отдаёт строки или payload `game_events`, но новый audit payload всё равно не должен содержать graph или mechanics.
- Все ID-маршруты закрыты fail-closed registry в `tests/helpers/campaign-isolation-routes.ts`; subrouter-маршруты обязаны иметь исполняемый двухкампанийный probe.

## Границы

В задачу входят contracts, GM-only Fastify subrouter, actionId/CAS, атомарный audit через `game_events`, route registry, PGlite HTTP integration и PostgreSQL multiplayer probe. Новая схема или seed не требуются.

Не входят player projection/read API, UI, назначение заклинаний, override, импорт референса и автоматическая публикация fixture. Hot-файлы `apps/web/src/styles.css`, `apps/web/src/App.tsx` и `apps/web/src/sidebar/ChatPanels.tsx` не затрагиваются.

## Решение

### 1. Контракты и маршруты

Добавить строгие command schemas и GM DTO в `packages/contracts/src/spell-schools.ts`:

- `POST /api/spell-packs/validate` — read-only проверка candidate graph; возвращает schema/semantic errors и warnings, ничего не пишет;
- `POST /api/spell-packs` — создание pack при `expectedVersion: 0`, только с version 1 в `DRAFT` или `REFERENCE`;
- `POST /api/spell-packs/:id/versions` — новая полная `DRAFT`-версия; path pack id, graph identity и `expectedVersion + 1` обязаны совпадать;
- `POST /api/spell-packs/:id/lifecycle` — новая версия, клонирующая текущий graph и меняющая lifecycle на `REFERENCE` или `ACTIVE`;
- `POST /api/spell-packs/:id/archive` — отдельная новая `ARCHIVED`-версия.

Lifecycle-модель:

- create не принимает `ACTIVE`/`ARCHIVED`, поэтому reference никогда не становится каноном автоматически;
- append draft разрешён для неархивированного pack;
- `DRAFT -> REFERENCE | ACTIVE`, `REFERENCE -> ACTIVE`;
- переход в `DRAFT` выполняется только через полный draft append, переход в `ARCHIVED` — только отдельной archive-командой;
- `ACTIVE` и `ARCHIVED` не переводятся lifecycle-командой назад; для изменения `ACTIVE` сначала создаётся явная новая `DRAFT`-версия;
- архивный pack терминален в рамках UIX-580.

Response возвращает полный graph только аутентифицированному GM вместе с version metadata и warnings. Player route отсутствует.

### 2. Атомарность, idempotency и CAS

- Вынести из storage транзакционные примитивы, сохранив существующие public wrappers UIX-579.
- Mutation route сначала пытается занять `(campaignId, actionId)` вставкой `game_events ... ON CONFLICT DO NOTHING` внутри той же транзакции. Если action уже существует, совпадение проверяется по actor, type, entity, target version и SHA-256 canonical command hash; точный retry читает сохранённую immutable version, повторное использование actionId с другим command возвращает 409.
- Новый event и новая graph version коммитятся одной транзакцией; при validation/CAS/storage отказе event откатывается.
- `expectedVersion` сверяется после campaign-scoped parent lock. Устаревшее ожидание возвращает 409 и не создаёт version/event.
- Audit event types: `spell_pack.created`, `spell_pack.version_created`, `spell_pack.lifecycle_changed`, `spell_pack.archived`. Payload содержит только command hash и version/lifecycle metadata, без schools, nodes, edges, текстов и mechanics.
- Cross-campaign pack lookup возвращает тот же 404, что отсутствующий pack; чужая история не меняется.

### 3. Проверки

1. Contract/storage tests:
   - строгие envelopes и `expectedVersion`;
   - create только version 1 `DRAFT|REFERENCE`;
   - transactional storage CAS и последовательность;
   - `ACTIVE` promotion отклоняет structural errors и `UNRESOLVED` group.
2. HTTP integration:
   - GM create/draft/lifecycle/archive создают четыре immutable versions и четыре metadata-only events;
   - точный action retry идемпотентен, reuse с другим payload/actor конфликтует;
   - stale CAS и invalid transition не оставляют partial version/event;
   - PLAYER получает 403 на каждый маршрут;
   - validation route пишет ноль строк.
3. Route registry + двухкампанийные ACL probes для всех трёх `:id` mutation routes; собственный control проходит, чужой pack скрыт как 404 и неизменён.
4. PostgreSQL 17 probe до Playwright повторяет критический HTTP путь, action replay/CAS, tenant isolation и проверяет отсутствие graph/mechanics в event payload.
5. Обязательная диверсия: временно убрать campaign predicate из spell-pack lookup и убедиться, что падает именно целевой foreign-pack probe; восстановить predicate и повторить тест.
6. Полный гейт строго последовательно: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`. Затем напрямую без pipeline: `DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true`, `pnpm test:multiplayer`, с немедленным сохранением `$LASTEXITCODE`.

## Стоп-условия

- Не добавлять player projection, realtime snapshot/event, UI, import, assignment или override.
- Не писать graph/mechanics в `game_events.payload` и не добавлять production seed.
- Не использовать production-данные, не запускать deploy, не пушить ветку и не создавать/мержить PR без решения пользователя.
