# UIX-516 — checkpoint системных строк регена — 2026-08-30

## Решения

- `enduranceRegen` и `manaRegen` выводятся из единой карты
  `RESOURCE_REGEN_STAT` и считаются обязательными системными строками.
- Обе строки всегда проецируются в видимую группу `combat` с источником
  `STAT`. Мастер может менять подпись, порядок и значение, но не может удалить
  строку, сменить источник или перенести её в другую группу.
- Значение `0` остаётся явным и обратимым способом отключить восстановление.
  Удаление данных из `characters.stats` и отдельная destructive-команда не
  добавлялись.
- Старые partial-layout чинятся при чтении без записи в БД: сохраняются
  пользовательские строки, подписи, порядок и значения персонажей. Следующая
  разрешённая правка сохраняет уже исправленную раскладку под обычной revision.
- Контракт группы сохраняет предел 60 пользовательских строк. Физический
  `max(62)` дополняет semantic refinement: два дополнительных места считаются
  только для точных системных regen-ключей в `combat`. Это сохраняет валидность
  legacy-раскладки на старом пределе, но не разрешает 61–62 custom-строки.
- SQL-миграция не нужна: инвариант одинаково применяется в bootstrap и
  realtime snapshot, а серверный PATCH защищает crafted-клиенты до записи,
  event и broadcast.

## Ревизия и изменённые файлы

- База: `a48de5dc5781a00e4c88154909aa207975e1d027` (`origin/main`).
- Ветка: `codex/uix-516-regen-row-lifecycle`.
- Домен и контракт:
  - `packages/system/src/index.ts`;
  - `packages/contracts/src/index.ts`.
- Сервер:
  - `apps/server/src/stat-layout.ts`;
  - `apps/server/src/snapshot.ts`;
  - `apps/server/src/stat-layout.test.ts`;
  - `tests/stat-layout-route.test.ts`;
  - `tests/realtime.test.ts`.
- Web и browser:
  - `apps/web/src/sidebar/StatLayoutCard.tsx`;
  - `apps/web/src/sidebar/StatLayoutCard.test.tsx`;
  - `tests/e2e/concept.spec.ts`.
- Документация:
  - `docs/architecture.md`;
  - `docs/plans/uix-516-system-regen-row-lifecycle.md`;
  - этот checkpoint.
- Не затронуты `apps/web/src/styles.css`, `apps/web/src/App.tsx`,
  `apps/web/src/sidebar/ChatPanels.tsx`, assets, stickers и production.

## Проверка

- Промежуточный точечный пул до финальной P2-правки контракта: 4 файла,
  91 тест — PASS. После P2 итоговый код проверен полным основным гейтом ниже.
- Диверсия server guard: временное разрешение отсутствующей системной строки
  дало целевое падение route-теста (`200` вместо ожидаемого `409`); guard
  восстановлен.
- Диверсия UI: временный `disabled={false}` у системной кнопки дала целевое
  падение `toBeDisabled()`; защита восстановлена.
- Отдельный red→green для найденного на ревью P1: при старом `.max(60)` repair
  группы из 60 custom-строк дал 62 строки и целевой `false` вместо `true` на
  `statLayoutSchema.safeParse`; после резерва `.max(62)` — PASS и повторный
  repair равен первому.
- Отдельный red→green для финального P2-review: при одном `.max(62)` контракт
  ошибочно принимал 61 custom-строку (`true` вместо `false`). После условного
  резерва и `combat`, и `characteristics` сохраняют пользовательский предел 60;
  repaired `60 + 2 system` по-прежнему проходит контракт и HTTP round-trip.
- Обязательный основной гейт в точном порядке — PASS:
  - `pnpm format:check`;
  - `pnpm lint`: 0 ошибок, 3 прежних warning;
  - `pnpm typecheck`;
  - `pnpm build`;
  - `pnpm test`: 182 файла, 1366 тестов.
- Полный `pnpm test:e2e` на собранном локальном API и одноразовом PostgreSQL:
  212 passed, 4 skipped, 0 failed, exit code 0. Retry не потребовались; новый
  UIX-516 сценарий прошёл в Chromium и Firefox.
  Первый запуск без API был честно остановлен после быстрых environment-отказов
  на `/api/bootstrap`; повтор выполнен только после healthcheck сервера.
- Финальный `pnpm test:multiplayer` на Docker Desktop `desktop-linux` 29.7.2:
  2 passed, backend restart пройден, exit code 0. Запуск был изолирован через
  `ARKEN_ISOLATED_ONLY=true`; production health не вызывался. Cleanup и
  resource-leak check прошли, контейнеров и volumes проекта не осталось.
- `git diff --check` — PASS.

## Блокеры и следующий шаг

- Блокеров локальной реализации и гейтов нет.
- По решению владельца ничего не push, не merge и не deploy.
- Следующий шаг: создать один локальный commit
  `fix(stats): protect system regen rows (UIX-516)` и передать владельцу
  checkpoint. PR и CI — только по отдельному решению.
