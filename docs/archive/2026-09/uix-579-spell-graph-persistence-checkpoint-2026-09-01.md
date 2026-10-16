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
- Основная реализация UIX-579: локальный commit `9ad3456`.
- Исправление упаковки PostgreSQL-пробы и финальное доказательство входят во второй локальный commit; его SHA фиксируется в Linear после создания.

## Изменённые поверхности

- Схема/миграция: `packages/db/src/schema.ts`, `packages/db/drizzle/0041_polite_titania.sql`, snapshot/journal, package dependency/lockfile.
- Domain storage: `apps/server/src/spell-pack-storage.ts`.
- Backup/restore/reset: database counts, restore rehearsal, gameplay reset и safe runner.
- Проверки: persistence/constraint tests, migration/reset tests, PostgreSQL probe в server workspace и runner-order test.
- Документация: архитектура, план и этот checkpoint.

## Проверка текущего пула

- Targeted persistence: 9/9 PASS.
- Связанный набор migration/backup/reset: 5 файлов, 55/55 PASS.
- Multiplayer runner-order: 3/3 PASS.
- Server typecheck: PASS.
- E2E/probe TypeScript config: PASS.
- Диверсия: trigger временно перестал защищать UPDATE; целевой прогон дал ровно 1 failed / 8 skipped, потому что согласованный UPDATE успешно записал историю. После восстановления trigger — 1 passed / 8 skipped.
- Финальный полный гейт после переноса пробы: format PASS; lint PASS с 3 существующими warning в `App.tsx` и `player-request-chat.tsx`; typecheck PASS; build PASS; test 187 файлов / 1461 тест PASS. Первый прогон `test` завершился инфраструктурной ошибкой Vitest worker после 186/187 файлов без упавшего assertion; чистый повтор тем же `pnpm test` прошёл полностью.
- Isolated multiplayer на Docker Desktop 29.7.2 / PostgreSQL 17: spell-pack PostgreSQL probe PASS; Playwright 2/2 PASS; backend restart PASS; compose cleanup PASS; resource-leak-check PASS; production health намеренно SKIPPED; итоговый `MULTIPLAYER_GATE_EXIT=0`.

## Блокеры

- Нет. Предыдущая недоступность `desktop-linux` устранена владельцем среды.
- Первый успешный запуск compose выявил, что bind-mounted probe из `/app/tests` не видит workspace-пакет `@arken/db`. Проба перенесена в `apps/server/src`, который уже копируется в server image; повторный isolated-гейт прошёл полностью.

## Следующее действие

Создать второй локальный commit, зафиксировать обе ревизии и доказательства в Linear и перевести UIX-579 в `In Review`. Публикация ветки, PR, merge и deploy остаются решением пользователя.
