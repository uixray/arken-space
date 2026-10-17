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

- Исходная база реализации:
  `a48de5dc5781a00e4c88154909aa207975e1d027`.
- Актуальный `origin/main` при повторной сверке 2026-08-31:
  `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`.
- Commit реализации: `9be034d4144e18ae91160e642560f8a1f81575d2`.
- Merge актуального `origin/main`:
  `1807ec0929c673e07db242b7f28573a172b469d3`.
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

- После merge актуального `origin/main` адресный пул заново прошёл: 4 файла,
  92 теста — PASS.
- Повторная диверсия server guard: временное разрешение отсутствующей системной
  строки адресно уронило route-тест (`200` вместо ожидаемого `409`); guard
  восстановлен.
- Повторная диверсия UI: временный `disabled={false}` у системной кнопки
  адресно уронил `toBeDisabled()`; защита восстановлена.
- Повторная диверсия положительной границы контракта: при старом `.max(60)`
  repair группы из 60 custom-строк дал 62 строки и целевой `false` вместо
  `true` на `statLayoutSchema.safeParse`; `.max(62)` восстановлен.
- Повторная диверсия отрицательной границы контракта: временный пользовательский
  лимит `62` ошибочно принял 61 custom-строку (`true` вместо `false`);
  семантический предел `60` восстановлен.
- Обязательный основной гейт в точном порядке — PASS:
  - `pnpm format:check`;
  - `pnpm lint`: 0 ошибок, 3 прежних warning;
  - `pnpm typecheck`;
  - `pnpm build`;
  - `pnpm test`: 185 файлов, 1434 теста.
- Полный `pnpm test:e2e` на собранном локальном API и одноразовом PostgreSQL:
  212 passed, 4 skipped, 0 failed, exit code 0; новый UIX-516 сценарий прошёл
  в Chromium и Firefox. Первый свежий запуск признан инфраструктурно
  невалидным и остановлен после исчезновения дочернего Vite: первый trace
  зафиксировал `server connection lost`, а следующие отказы были
  `ERR_CONNECTION_REFUSED`. Повтор выполнен на отдельно запущенных Vite и API
  проверяемой ревизии; оба были остановлены, одноразовая БД удалена.
- Финальный `pnpm test:multiplayer` на Docker Desktop `desktop-linux` 29.7.2:
  2 passed, backend restart пройден, exit code 0. Запуск был изолирован через
  `ARKEN_ISOLATED_ONLY=true`; production health не вызывался. Все обязательные
  шаги runner прошли, cleanup и resource-leak check зелёные, контейнеров и
  volumes проекта не осталось.
- `git diff --check` — PASS.

## Блокеры и следующий шаг

- Блокеров локальной реализации и гейтов нет.
- Локальная реализация и повторные гейты готовы к handoff. Push, PR, merge и
  deploy не выполнялись и ждут отдельного решения владельца.
