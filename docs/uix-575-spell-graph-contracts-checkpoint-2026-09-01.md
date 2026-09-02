# UIX-575 — checkpoint контрактов графа школ магии

Дата: 1 сентября 2026 года.

## Решение и ревизия

- Ветка: `codex/uix-575-spell-graph-contracts`.
- Основа и проверенный `origin/main`: `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`.
- Родительская UIX-262 декомпозирована на UIX-575–UIX-578; этот checkpoint
  закрывает только первый контрактный пул UIX-575.
- Точный SHA результата фиксируется в Linear после локального коммита; push,
  PR, merge и deploy в этом пуле не выполняются.

## Принятые решения

1. Spell progression хранится как плоский снимок одной immutable версии:
   pack lineage (`packId`), version (`versionId`), schools, nodes, requirement
   groups и directed edges.
2. Все дочерние сущности явно несут `packId` и `packVersionId`; смешение pack,
   version или school закрыто отвергается до persistence.
3. Все groups одного узла соединены AND; внутри group явно действует `ALL` или
   `ANY`. Непроверенный reference может хранить `UNRESOLVED`, но ACTIVE-версия
   с ним невалидна.
4. Passive, active и hybrid выражаются `passive` + `triggers`. Для `OTHER`
   обязательно нужны label либо исходная формулировка: пустая activation
   condition больше не проходит схему.
5. Narrative, mechanics, structured costs, activation, cadence, range,
   duration, target, area, effects и provenance разделены. Исходный текст не
   заменяется нормализованными полями.
6. Layout является presentation-only metadata и не участвует в prerequisite
   semantics.
7. Несколько корней, изолированные узлы и школа без связей допустимы. Cycle,
   dangling/self edge, duplicate IDs/edges, empty group и cross-pack/version/
   school corruption дают детерминированные ошибки.

## Изменённые файлы

- `packages/contracts/src/spell-schools.ts` — Zod-схемы, публичные типы и чистый
  `validateSpellProgressionGraph`.
- `packages/contracts/src/index.ts` — экспорт нового модуля.
- `tests/spell-school-graph.test.ts` — 28 доменных и reference-тестов.
- `docs/plans/uix-262-spell-progression-graphs.md` — декомпозиция и гейты.
- `docs/uix-575-spell-graph-contracts-checkpoint-2026-09-01.md` — этот
  checkpoint.

## Проверка

- Targeted: `tests/spell-school-graph.test.ts` — **28/28 PASS**.
- Реальная fixture: **13 школ / 145 узлов / 114 рёбер**; raw dangling,
  duplicate edge и cycle — 0; у Воды 11 узлов и 0 рёбер.
- Шесть реальных схождений оставлены шестью
  `UNRESOLVED_REQUIREMENT_GROUP` warnings, а не выдуманными ALL/ANY.
- Независимый review нашёл один P2: `OTHER` допускал активную способность без
  label/raw text. Схема и отрицательный тест исправлены; повторный targeted
  прогон зелёный.
- Диверсия: cycle detector временно отключён. Targeted-прогон дал ровно
  **1 failed / 27 skipped** на ожидании `CYCLE`; после возврата —
  **1 passed / 27 skipped**.
- Полный обязательный gate в точном порядке:
  - `pnpm format:check` — PASS;
  - `pnpm lint` — PASS с тремя существующими предупреждениями в `App.tsx` и
    `player-request-chat.tsx`, ошибок 0;
  - `pnpm typecheck` — PASS;
  - `pnpm build` — PASS;
  - `pnpm test` — **186 файлов / 1451 тест PASS**.
- Первый sandbox-прогон дошёл до build и остановился на Windows `spawn EPERM`
  / запрете создать `dist`; полный неизменённый gate повторён вне sandbox и
  прошёл. Это ограничение окружения, не дефект кода.
- `test:e2e` не требуется: UI и пользовательский поток не менялись.
- `test:multiplayer` не требуется: persistence, ACL, visibility, realtime и
  миграции не менялись.

## Блокеры и следующий шаг

- Блокеров UIX-575 нет. Подзадачу можно передать в review после локального
  коммита.
- Родительская UIX-262 остаётся In Progress.
- Следующий серверный пул — UIX-576: versioned persistence и GM API. Там
  обязательны migration/ACL/isolation проверки и `test:multiplayer`.
- Promotion reference pack 2024 в ACTIVE остаётся заблокированным до ручного
  подтверждения мастером рёбер, шести схождений и 31 неоднозначной записи.
