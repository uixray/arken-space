# UIX-579 — checkpoint хранения spell graph, 2026-09-01

## Решения

- Стабильная identity хранится в `spell_packs`; весь изменяемый контент и lifecycle — только в неизменяемых `spell_pack_versions`.
- Версия campaign-scoped через составной FK `(campaign_id, pack_id)`; номер уникален внутри pack.
- JSONB CHECK fail-closed сверяет `packId`, `versionId`, `version`, `lifecycle` и наличие `provenance`; полноценная Zod- и семантическая валидация выполняется до транзакции.
- UPDATE pack/version и прямой DELETE version запрещены trigger. Архивация добавляет новую версию; gameplay reset удаляет parent pack, а история уходит только допустимым cascade.
- Append сериализуется блокировкой parent `FOR UPDATE` и допускает ровно следующий номер.
- Multiplayer runner до браузерного сценария запускает отдельную PostgreSQL 17-пробу: конкурирующий append, tenant FK, immutable trigger и оба cascade-пути.

## Ревизия

- Ветка: `codex/uix-579-spell-graph-persistence`.
- База: `origin/main@23683ae`.
- Stacked-зависимость UIX-575: `1d3a966`.
- Реализация и этот checkpoint входят в один локальный commit UIX-579; его SHA фиксируется в Linear после создания.

## Изменённые поверхности

- Схема/миграция: `packages/db/src/schema.ts`, `packages/db/drizzle/0041_polite_titania.sql`, snapshot/journal, package dependency/lockfile.
- Domain storage: `apps/server/src/spell-pack-storage.ts`.
- Backup/restore/reset: database counts, restore rehearsal, gameplay reset и safe runner.
- Проверки: persistence/constraint tests, migration/reset tests, PostgreSQL probe и runner-order test.
- Документация: архитектура, план и этот checkpoint.

## Проверка текущего пула

- Targeted persistence: 9/9 PASS.
- Связанный набор migration/backup/reset: 5 файлов, 55/55 PASS.
- Multiplayer runner-order: 3/3 PASS.
- Server typecheck: PASS.
- E2E/probe TypeScript config: PASS.
- Диверсия: trigger временно перестал защищать UPDATE; целевой прогон дал ровно 1 failed / 8 skipped, потому что согласованный UPDATE успешно записал историю. После восстановления trigger — 1 passed / 8 skipped.
- Полный гейт после всех правок: format PASS; lint PASS с 3 существующими warning в `App.tsx` и `player-request-chat.tsx`; typecheck PASS; build PASS; test 187 файлов / 1461 тест PASS.

## Блокеры

- `test:multiplayer` остановился на первом read-only preflight с exit 1: context `desktop-linux` указывает на `npipe:////./pipe/dockerDesktopLinuxEngine`, но pipe отсутствует — Docker daemon не запущен.
- Compose не поднимался, контейнеры и PostgreSQL probe не стартовали; production health был пропущен благодаря `ARKEN_ISOLATED_ONLY=true`.
- Самостоятельно запускать другой Docker запрещено предыдущим инцидентом; до появления корректного `desktop-linux` daemon multiplayer-гейт не пройден, задача остаётся `In Progress`.

## Следующее действие

После запуска владельцем корректного Docker Desktop повторить isolated `test:multiplayer` через `desktop-linux` без pipeline. Только после зелёной PostgreSQL probe + Playwright обновить checkpoint и перевести UIX-579 в `In Review`.
