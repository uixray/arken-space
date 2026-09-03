# UIX-579 — хранение версионируемых spell graph и миграция

## Контекст и замер

- Ветка: `codex/uix-579-spell-graph-persistence` от `origin/main@23683ae`.
- Контракт spell graph из UIX-575 подключён локальным stacked-коммитом `1d3a966`; до отдельного решения пользователя ветка не публикуется и не сливается.
- На старте схема содержит 51 прикладную таблицу, последняя миграция — `0040_curly_firebrand`.
- В текущей схеме нет устойчивой identity spell pack, неизменяемой истории версий и campaign-scoped ограничений для неё.

## Границы задачи

В UIX-579 входят только схема БД, миграция, внутренний серверный слой записи, эксплуатационные allowlist-ы и доказательства хранения. HTTP-маршруты, ACL, `actionId`, аудит действий и CAS относятся к UIX-580. Назначение персонажам, override, проекции и импорт остаются в UIX-577/UIX-578.

Автоматическое продвижение версии в `ACTIVE` запрещено. Любая смена lifecycle представляется новой неизменяемой версией; исторические строки не переписываются.

## Решение

### 1. Схема и миграция

Добавить enum `spell_pack_lifecycle` со значениями `DRAFT`, `REFERENCE`, `ACTIVE`, `ARCHIVED` и две campaign-scoped таблицы:

1. `spell_packs` — минимальная устойчивая identity: `id`, `campaign_id`, `created_at`; уникальность `(campaign_id, id)`. Названия и прочие изменяемые метаданные остаются только в version snapshot.
2. `spell_pack_versions` — неизменяемый snapshot: `id`/`versionId`, `campaign_id`, `pack_id`, положительный `version`, `lifecycle`, полный `graph jsonb`, `created_at`; уникальность `(campaign_id, id)` и `(campaign_id, pack_id, version)`.

Связь версии с pack — составной FK `(campaign_id, pack_id) → spell_packs(campaign_id, id)` с cascade при удалении pack. Отдельный FK версии к campaign не нужен: составная связь одновременно доказывает принадлежность кампании и не создаёт второй cascade-путь.

Fail-closed CHECK сверяет тип JSON и его обязательные поля с колонками: `packId`, `versionId`, `version`, `lifecycle`, а также наличие объекта `provenance`. Предикат обязан вернуть именно `TRUE`, чтобы отсутствующий JSON-ключ не прошёл PostgreSQL `CHECK` как `NULL`. SQL-trigger запрещает UPDATE identity и version. Прямой DELETE исторической версии запрещён, пока существует parent pack; cascade удаления pack разрешён для campaign deletion и безопасного gameplay reset.

Миграция генерируется Drizzle как `0041` вместе со snapshot и `_journal.json`; trigger добавляется в сгенерированный SQL после проверки diff.

### 2. Внутренний storage

Создать серверный модуль без HTTP-поверхности:

- сначала `spellProgressionGraphSchema.safeParse`, затем `validateSpellProgressionGraph`;
- ошибки схемы и семантики возвращаются как структурированная ошибка хранения;
- создание identity и версии 1 выполняется одной транзакцией;
- append блокирует campaign-scoped parent через `FOR UPDATE`, читает последнюю версию и допускает только следующий номер без пропусков;
- `packId` и `versionId` берутся из валидированного graph; дубли и чужая campaign отклоняются ограничениями/проверками;
- предупреждения разрешены для `DRAFT`, `REFERENCE`, `ARCHIVED`; для `ACTIVE` контракт уже превращает unresolved-зависимости в ошибки.

### 3. Backup, restore и reset

- Добавить обе таблицы в `infra/backup/database-counts.sql` и `applicationCountTableNames` restore rehearsal.
- Gameplay reset удаляет только `spell_packs` целевой кампании: версии уходят по составному `ON DELETE CASCADE`, не обходя защиту прямого удаления истории. Проверка явно доказывает очистку pack и versions цели и сохранность обеих строк чужой кампании.
- Обновить CLI fixture/счётчики и архитектурную документацию с 51 до 53 таблиц и с диапазона `0000–0040` до `0000–0041`.
- Production seed не добавлять; после полной миграции обе таблицы должны быть пустыми.

## Проверка

1. Целевые schema/migration/storage/backup/reset тесты:
   - создание версии 1 и append 2;
   - отказ для пропуска номера, duplicate version/versionId, cross-campaign pack;
   - fail-closed JSON CHECK, включая отсутствие `packId` или `provenance`, а не только несовпадающее значение;
   - запрет UPDATE identity/version и прямого удаления истории;
   - cascade через pack/campaign и сохранность чужой кампании (настоящий PostgreSQL в multiplayer-гейте обязателен, одной PGlite-недостаточно);
   - свежая миграция создаёт обе пустые таблицы без seed.
2. Обязательная диверсия: временно убрать trigger неизменяемости версии и убедиться, что падает именно тест UPDATE истории; восстановить trigger и повторить тест.
3. Полный гейт строго по порядку:
   `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
4. Так как меняются миграция и campaign-scoped сохранение, запустить `pnpm test:multiplayer` напрямую без pipeline, с `DOCKER_CONTEXT=desktop-linux` и `ARKEN_ISOLATED_ONLY=true`; сразу сохранить `$LASTEXITCODE`. Если Docker недоступен, гейт считается не пройденным, а не успешным.

## Стоп-условия

- Не трогать `apps/web/src/styles.css`, `apps/web/src/App.tsx`, `apps/web/src/sidebar/ChatPanels.tsx`.
- Не добавлять HTTP/API, UI, import, assignment или projection.
- Не использовать production-данные и не запускать production deploy.
- Не пушить, не создавать/мержить PR и не обновлять Linear между stage gates.
