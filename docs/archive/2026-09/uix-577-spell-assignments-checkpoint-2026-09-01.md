# UIX-577 — checkpoint назначений заклинаний персонажам, 2026-09-01

## Решения

- Назначение хранит неизменяемый server-built snapshot активного spell pack и отдельную append-only историю версий. Legacy-магия персонажа остаётся рядом и автоматически не преобразуется.
- Создание назначения принимает явный target (`spell` или `pack`), а последующие добавления выполняются отдельной командой с `expectedVersion`. Конкурирующая устаревшая команда получает `409` без частичной записи.
- Сервер проверяет активную версию pack, существование target, отсутствие дубля и все условия prerequisite. Несколько одновременно нарушенных условий возвращаются вместе, а не теряются после первой ошибки.
- GM может явно обойти prerequisite только с непустой причиной. Audit event хранит факт override и причину, но не копирует spell snapshot или mechanics.
- UUID из path и payload канонизируются в lower-case до сравнения и хеширования, поэтому retry с допустимым upper-case UUID остаётся идемпотентным.
- Блокировка character выполняется до резервирования `actionId`, как в существующих mutation-маршрутах. Это сохраняет единый lock order и исключает цикл между двумя транзакциями.
- Campaign isolation закреплена составными внешними ключами. FK автора версии остаётся `DEFERRABLE INITIALLY DEFERRED`: отдельное удаление membership запрещено, но каскадное удаление всей campaign не блокируется порядком внутренних cascade.

## Ревизия

- Ветка: `codex/uix-577-spell-assignments`.
- База: `origin/main@23683ae`.
- Stacked-зависимости: UIX-575 `1d3a966`, UIX-579 `9ad3456` и `662f440`, UIX-580 `f4dccc8`.
- Локальный commit UIX-577 создаётся после checkpoint; SHA фиксируется в Linear.

## Изменённые поверхности

- Contracts: строгие command/response schemas, targets, override reason, immutable snapshot DTO и канонизация UUID в `packages/contracts/src/spell-schools.ts`.
- Database: таблицы assignments и assignment versions, составные campaign FK, immutability checks/triggers и миграция `0042_polite_magik.sql`.
- Server: storage для snapshot/prerequisites и GM-only create/append routes с CAS, replay/conflict и audit.
- Проверки: PGlite integration/persistence, structural lock-order assertion, route registry и двухкампанийные probes, PostgreSQL 17 assignment probe внутри multiplayer runner.
- Operational paths: backup counts, restore rehearsal и gameplay reset удаляют assignment parent до spell packs и не обходят append-only history.
- Документация: архитектура, план и этот checkpoint.
- Web hot-файлы `apps/web/src/styles.css`, `apps/web/src/App.tsx` и `apps/web/src/sidebar/ChatPanels.tsx` не затронуты.

## Проверка текущего пула

- Targeted contracts/storage/integration/lock-order: PASS, включая upper-case UUID replay, simultaneous prerequisite failures, CAS race, audit privacy и foreign campaign.
- Связанный расширенный набор: 9 файлов, 76/76 PASS; route registry/documentation: 18/18 PASS.
- `pnpm db:generate` с локальным фиктивным `DATABASE_URL`: PASS, schema и migration snapshot синхронизированы, новых изменений не найдено.
- Диверсия: минимальная длина `overrideReason` временно изменена с `1` на `0`; точный тест пустой причины дал 1 failed / 3 skipped. После восстановления ограничения тот же тест дал 1 passed / 3 skipped.
- Полный гейт строго последовательно: format PASS; lint PASS с 3 существующими warning в `App.tsx` и `player-request-chat.tsx`; typecheck PASS; build PASS; test 194 файла / 1490 тестов PASS.
- Isolated multiplayer (`DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true`) на PostgreSQL 17: spell-pack probe PASS; spell-assignment probe PASS; Playwright PASS; backend restart PASS; compose cleanup PASS; resource-leak-check PASS; контейнеров и томов не осталось; production health намеренно SKIPPED. `runner.json` завершён без error, все exit codes равны `0`.

## Блокеры

- Нет.
- Production данные не читались; публикация, push, PR, merge и deploy не выполнялись.

## Следующее действие

Создать локальный commit UIX-577, зафиксировать SHA и доказательства в Linear и перевести задачу в `In Review`. Затем начать UIX-578 отдельной веткой поверх проверенного magic-стека.
