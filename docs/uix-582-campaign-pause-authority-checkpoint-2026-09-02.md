# UIX-582 — checkpoint серверной паузы — 2026-09-02

## Решения

- Пауза хранится как `campaigns.paused boolean NOT NULL DEFAULT false` и входит
  в общую campaign revision.
- GM-only `POST /api/campaign/pause` принимает только `actionId`, `revision` и
  желаемое `paused`; campaignId берётся из auth context.
- Транзакция блокирует строку кампании, проверяет revision и receipt, выполняет
  CAS и сохраняет только безопасные hash/response metadata в `game_events`.
- Exact replay проверяет actor/type/entity/hash. Прямой и обёрнутый Drizzle
  `23505` распознаётся только для `game_events_campaign_action_idx`.
- Snapshot одной рассылки использует общую строку кампании. Replay повторяет
  broadcast, чтобы восстановить клиентов после post-commit ошибки рассылки.
- Gameplay reset снимает паузу и fail-closed проверяет `campaignPaused=false`.
  Canvas guards остаются в UIX-583, клиентский overlay и artwork — в UIX-584.

## Ревизия и файлы

- Baseline: `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6` (`origin/main`).
- Ветка: `codex/uix-582-pause-authority`.
- Реализация:
  - `apps/server/src/campaign-pause.ts`, `routes.ts`, `snapshot.ts`;
  - `packages/contracts/src/index.ts`;
  - `packages/db/src/schema.ts`, migration и metadata `0041`.
- Проверки и эксплуатационная граница:
  - `apps/server/src/campaign-pause.integration.test.ts`;
  - `tests/campaign-pause-contract.test.ts`, migration/integrity/reset/backup;
  - `scripts/gameplay-reset-core.mjs`, `run-gameplay-reset-safe.mjs`;
  - `tests/multiplayer/game-session.spec.ts`;
  - snapshot fixtures, `docs/architecture.md` и план UIX-582.
- Не затронуты запрещённые `App.tsx`, `styles.css`, `ChatPanels.tsx`, assets и
  stickers.

## Проверка

- Красный baseline: отсутствовали contract-схемы и migration `0041`; новые
  целевые тесты падали до production-кода.
- Focused: 8 файлов, 97 тестов — passed.
- Независимый code/concurrency review и adversarial test review — блокирующих
  замечаний после исправлений нет.
- Диверсия: в изолированной PGlite-базе временно испорчен `commandHash`
  receipt; exact-retry тест дал exit 1, `1 failed / 12 skipped` и ожидаемые
  `409` вместо `200`. Мутация удалена, тот же тест — `1 passed / 12 skipped`.
- Основной gate в обязательном порядке:
  - `format:check` — passed;
  - `lint` — passed, 0 errors и 3 существующих warning;
  - `typecheck` — passed;
  - `build` — passed;
  - `test` — 187 файлов, 1443 теста — passed.
- Isolated multiplayer на exact commit — ещё не запускался.

## Блокеры и следующее действие

- Блокеров реализации нет.
- Следующее действие: зафиксировать implementation commit, запустить
  `DOCKER_CONTEXT=desktop-linux`, `ARKEN_ISOLATED_ONLY=true`,
  `pnpm test:multiplayer` без конвейера, записать exact revision и перевести
  UIX-582 в In Review. Push, PR, merge и production не входят в этот пул.
