# UIX-585 — checkpoint интеграции release candidate, 2026-09-02

## Решения

- Release candidate собран от `origin/main@2fd8bede517333164f9100d22b62860d928c748c`.
- UIX-503 уже находилась в `main`; в integration branch merge-коммитами включены
  UIX-574, UIX-411, cumulative magic UIX-575/579/580/577/578, UIX-402,
  UIX-476, UIX-516, UIX-404 и UIX-582.
- История task-веток не переписывалась. Исходная pause-миграция UIX-582 `0041`
  не переименована: она удалена из integration merge и заново сгенерирована от
  объединённого snapshot `0042` как `0043_campaign_pause`.
- В конфликтах сохранены обе предметные стороны: campaign clock + pause routes,
  magic + pause reset boundary, foreign-campaign spell fixtures и оба правила
  architecture.

## Ревизия

- Интеграционный merge: `49f8dab`.
- Review-fix и checkpoint: `52f60be`.

## Изменённые файлы интеграционного слоя

- `apps/server/src/routes.ts`;
- `docs/architecture.md`;
- `packages/db/drizzle/0043_campaign_pause.sql`;
- `packages/db/drizzle/meta/0043_snapshot.json`;
- `packages/db/drizzle/meta/_journal.json`;
- `scripts/run-gameplay-reset-safe.mjs`;
- `tests/migration.test.ts`;
- `tests/reset-cli.test.ts`;
- `tests/e2e/character-media-detach.spec.ts`;
- `docs/uix-582-campaign-pause-authority-checkpoint-2026-09-02.md`.

## Проверка

- Drizzle generation: `0043_campaign_pause`, один `ADD campaigns.paused`,
  `prevId` равен ID snapshot `0042`, journal `idx=43`, schema содержит 55 таблиц.
- Targeted integration: 6 файлов / 50 тестов — passed.
- Review: исправлено отсутствие обязательного `campaign.paused` в
  `character-media-detach.spec.ts`; конфликтная поверхность отформатирована.
- Диверсия: из `0043_campaign_pause.sql` временно удалён `NOT NULL`; точный тест
  UIX-582 упал один (остальные 8 skipped) на разрешённом `paused=null`. После
  восстановления SQL тот же тест прошёл.
- Полный локальный core gate на `52f60be`:
  - `format:check` — passed;
  - `lint` — passed, 0 errors и 3 прежних warning;
  - `typecheck` — passed;
  - `build` — passed;
  - `test` — 207 файлов / 1672 теста passed.
- Full E2E был остановлен после `ECONNREFUSED /api/bootstrap`: API не был
  поднят, поэтому это инфраструктурно невалидный прогон, а не продуктовый fail.
- Проверен правильный Docker context `desktop-linux`; daemon сейчас не запущен.

## Блокеры

- Локальные full E2E и isolated multiplayer требуют недоступный сейчас Docker
  Desktop; обязательное доказательство переносится в GitHub workflows.
- Integration branch ещё не опубликована; GitHub CI отсутствует до создания PR.
- Production gate требует доступ к host, реальный non-live media smoke и ручной
  GM+6 прогон.

## Следующее действие

Опубликовать один integration PR и дождаться зелёных `checks`, `e2e` и
`multiplayer`; merge разрешён только после всех трёх workflow.
