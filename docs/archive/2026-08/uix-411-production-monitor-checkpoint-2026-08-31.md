# UIX-411 — checkpoint внешнего мониторинга production

## Решения

- Production проверяется внешним GitHub-hosted runner раз в пять минут через
  публичный `/healthz`; расписание best effort и не объявляется SLA.
- Состояние и дедуплицированные события outage/recovery/смены версии хранятся в
  одном GitHub issue. Для частично доставленных событий используется
  транзакционный pending-маркер.
- Суточный RPO не принят от имени владельца: до отдельного решения обязателен
  предыгровой запуск штатного systemd backup с фиксацией snapshot ID.
- Live-проверка доставки уведомления выполняется только после merge, без
  остановки production: через временно неверный health URL в отдельной
  проверяемой ревизии и последующий возврат канонического URL.

## Ревизия

- Ветка: `codex/uix-411-production-monitor`.
- База: `origin/main@23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`.
- Production не опрашивался, не изменялся и не публиковался.

## Изменённые файлы

- `.github/workflows/production-monitor.yml`.
- `scripts/production-monitor-core.mjs`.
- `scripts/run-production-health-monitor.mjs`.
- `scripts/sync-production-monitor-issue.mjs`.
- `tests/production-monitor.test.ts`.
- `docs/plans/uix-411-production-monitor.md`.
- `docs/operations.md`.
- `docs/deployment.md`.
- Этот checkpoint.

## Проверка

- Полный обязательный гейт прошёл: `format:check`, `lint`, `typecheck`, `build`,
  `test`; Vitest — 186 файлов и 1441 тест.
- После восстановления диверсии сфокусированный набор прошёл: 18 из 18 тестов.
- `eslint`, `node --check` трёх скриптов, Prettier и `git diff --check` прошли.
- Известные предупреждения полного гейта не относятся к ветке: два
  `react-hooks/exhaustive-deps`, одно `react-refresh/only-export-components` и
  предупреждение Vite о размере чанка.
- E2E и multiplayer не запускались: UI, realtime, доступ, сохранение канваса,
  реконнект, миграции, nginx и Docker не менялись.

## Диверсия

Заголовок эксплуатационного контракта временно изменён с
`Предыгровой бэкап` на `Бэкап перед игрой`. Целевой тест
`requires a pre-game backup without inventing an accepted RPO` завершился
ожидаемо: один тест упал, 17 были пропущены. После возврата заголовка весь
сфокусированный набор снова прошёл 18 из 18.

## Блокеры и следующий шаг

- Локальных блокеров нет.
- После merge нужен live gate `workflow_dispatch`: доказать создание ровно
  одного outage-уведомления, повтор без шума, recovery-уведомление, разрешения
  issue и фактическую задержку доставки.
- Следующий шаг: коммит, перевод UIX-411 в `In Review` и подготовка PR. Push,
  merge и deploy выполняются только по отдельному решению владельца.
