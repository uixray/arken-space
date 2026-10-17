# UIX-583 — checkpoint Canvas guards паузы — 2026-09-02

## Решения

- Все durable Canvas writers берут campaign row `FOR UPDATE` до scene,
  definition, journal и target locks. Уже принятая пауза возвращает bounded
  `CAMPAIGN_PAUSED` без target/event/journal записи.
- Эфемерные preview, ruler, ping и cursor держат `FOR SHARE` до emit. Пауза
  либо ждёт relay и затем очищает его, либо фиксируется первой и блокирует emit.
- Cleanup ruler/cursor выполняется внутри pause-транзакции под campaign lock.
  Exact replay receipt повторяет snapshot recovery, но не transition cleanup.
- Snapshot receipt сверяет актуальные `paused + revision` под эксклюзивным
  campaign lock; историческая pause-команда после resume ничего не рассылает.
- Disconnect очищает уже видимые ruler/cursor. Async relay после последнего
  await проверяет `socket.connected`, поэтому не создаёт потерянную эфемеру.
- LINKED_SCENE и SCENE_REGION берут campaign lock до уникального ACTIVE
  encounter slot, чтобы не образовать PostgreSQL deadlock.
- Chat, dice и audio остаются разрешёнными. Offscreen scene и token definition
  без placement остаются подготовкой, а не Canvas-мутацией.

## Ревизия

- Baseline: `origin/main@d789d97`.
- Ветка: `codex/uix-583-pause-canvas-guards`.
- Plan revision: `981a1dc`.
- Implementation revision: `53a47d21daa724bdabcc5d5dbca7b0efc0908a41`.

## Изменённые файлы

- Guard и pause lifecycle:
  - `apps/server/src/campaign-pause-guard.ts`;
  - `apps/server/src/campaign-pause.ts`;
  - `apps/server/src/index.ts`.
- Durable/ephemeral integration:
  - `apps/server/src/routes.ts`;
  - `apps/server/src/realtime.ts`;
  - `apps/server/src/encounters.ts`.
- Проверки:
  - `apps/server/src/campaign-pause-guard.integration.test.ts`;
  - `apps/server/src/campaign-pause.integration.test.ts`;
  - `apps/server/src/encounters.integration.test.ts`;
  - `tests/campaign-pause-guard-inventory.test.ts`;
  - `tests/pool-b-http.test.ts`;
  - `tests/realtime.test.ts`.
- PostgreSQL multiplayer proof:
  - `apps/server/src/campaign-pause-guard.pg-probe.ts`;
  - `scripts/run-multiplayer-e2e.mjs`;
  - `tests/multiplayer-runner-report.test.ts`.
- Документация:
  - `docs/plans/uix-583-pause-canvas-guards.md`;
  - этот checkpoint.
- Запрещённые `App.tsx`, `styles.css`, `ChatPanels.tsx`, assets и stickers не
  затронуты.

## Проверка

- Диверсия: guard временно убран только из `POST /api/drawings`. Целевой тест
  упал один: ожидал `409`, получил созданный drawing с `201`; после
  восстановления guard тот же тест прошёл.
- Первый focused pool: 7 файлов, 174 теста — passed, `--maxWorkers=1`.
- После adversarial fixes: server typecheck — passed; 6 файлов, 124 теста —
  passed, `--maxWorkers=1`.
- Structural runner test закрепляет отдельный PostgreSQL probe до Playwright.
- Probe доказывает mutation → pause, pause → mutation, relay → pause,
  pause → relay и удержание lock на время transition cleanup через
  `pg_blocking_pids`.
- Полный локальный gate на финальном дереве:
  - `format:check` — passed;
  - `lint` — passed, 0 errors и 3 существующих warning;
  - `typecheck` — passed;
  - `build` — passed;
  - `test --maxWorkers=1` — 209 файлов, 1714 тестов passed.
- `git diff --check` — passed.
- Isolated `test:multiplayer` на точной implementation revision — passed:
  - `campaign-pause-guard-postgresql-probe` — passed, exit code `0`;
  - остальные PostgreSQL probes — passed;
  - backend restart — passed с первой попытки;
  - Playwright — 2 сценария passed одним worker;
  - compose cleanup и resource leak check — passed, оставшихся контейнеров и
    томов нет;
  - production health до/после намеренно skipped через
    `ARKEN_ISOLATED_ONLY=true`.

## Блокеры и следующее действие

- Блокеров реализации и локальных гейтов нет.
- Следующее действие: зафиксировать этот gate-checkpoint, перевести UIX-583 в
  review stage и оставить push/PR/merge/production отдельными решениями.
