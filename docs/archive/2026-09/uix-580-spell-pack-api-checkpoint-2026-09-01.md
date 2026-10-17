# UIX-580 — checkpoint GM API версий spell pack, 2026-09-01

## Решения

- GM API разделён на read-only validation и четыре явные mutation-команды: создание pack, новая полная draft-версия, lifecycle-переход и отдельная архивация.
- Каждая успешная mutation создаёт новую неизменяемую `spell_pack_versions`; изменение существующей версии запрещено контрактом хранения UIX-579.
- `expectedVersion` проверяется после campaign-scoped блокировки parent pack. Устаревшая команда получает `409` без частичной версии или audit event.
- `actionId` резервируется в `game_events` внутри той же транзакции. Точный retry возвращает уже созданную версию, а повторное использование action с другим actor или command hash получает `409`.
- Audit payload хранит только hash команды и metadata версии/lifecycle, без graph, mechanics и текстового содержимого spell pack.
- Чужой campaign pack скрывается как `404`; все mutation-маршруты включены в fail-closed registry и исполняемые двухкампанийные probes.
- Lifecycle остаётся явным: создание допускает только `DRAFT`/`REFERENCE`, публикация `ACTIVE` требует отдельного перехода, архивирование терминально в рамках этой задачи.

## Ревизия

- Ветка: `codex/uix-580-spell-pack-api`.
- База: `origin/main@23683ae`.
- Stacked-зависимости: UIX-575 `1d3a966`, UIX-579 `9ad3456` и `662f440`.
- Локальный commit UIX-580 создаётся после checkpoint; SHA фиксируется в Linear.

## Изменённые поверхности

- Contracts: command schemas, lifecycle/archive envelopes, validation response и GM version DTO в `packages/contracts/src/spell-schools.ts`.
- Server: новый `apps/server/src/spell-pack-routes.ts`, регистрация subrouter и транзакционные storage-примитивы с CAS.
- Проверки: PGlite HTTP integration, contract/storage assertions, route registry, двухкампанийные ACL probes и PostgreSQL 17 HTTP probe внутри multiplayer runner.
- Документация: архитектура, план и этот checkpoint.
- Web hot-файлы `apps/web/src/styles.css`, `apps/web/src/App.tsx` и `apps/web/src/sidebar/ChatPanels.tsx` не затронуты.

## Проверка текущего пула

- Targeted API integration: 5/5 PASS.
- Связанный набор contracts/storage/routes: 6 файлов, 48/48 PASS.
- Registry/isolation/runner: 3 файла, 31/31 PASS.
- Диверсия: campaign predicate временно удалён из lookup; точный foreign-pack тест дал 1 failed / 4 skipped (`500` вместо ожидаемого fail-closed `404`). После восстановления predicate тот же тест дал 1 passed / 4 skipped.
- Полный гейт строго последовательно: format PASS; lint PASS с 3 существующими warning в `App.tsx` и `player-request-chat.tsx`; typecheck PASS; build PASS; test 189 файлов / 1472 теста PASS.
- Первый build внутри sandbox остановился на Windows `EPERM` при очистке `dist`; повтор той же команды вне sandbox прошёл. Ошибка не относилась к исходному коду.
- Isolated multiplayer (`DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true`) на PostgreSQL 17: spell-pack storage/API probe PASS; Playwright 2/2 PASS; backend restart PASS; compose cleanup PASS; resource-leak-check PASS; контейнеров и томов не осталось; production health намеренно SKIPPED. `runner.json` завершён без error, все exit codes равны `0`.

## Блокеры

- Нет.
- Production данные не читались; публикация, push, PR, merge и deploy не выполнялись.

## Следующее действие

Создать локальный commit UIX-580, зафиксировать SHA и доказательства в Linear и перевести задачу в `In Review`. Затем начать следующий приоритетный независимый magic-пул отдельной веткой.
