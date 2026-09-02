# UIX-319 — checkpoint архитектуры многокартных сцен — 2026-09-02

## Решения

- Выбрана модель 3: несколько существующих изолированных tactical scenes
  композиционно объединяются в GM scene workspace.
- `campaign.activeSceneId` остаётся anchor и legacy fallback. Workspace не
  получает второй campaign-wide active pointer.
- READY workspace требует explicit revisioned assignment для каждого PLAYER.
  Отсутствующая assignment даёт пустую `WAITING_FOR_ASSIGNMENT` projection, а
  не доступ к anchor scene.
- Workspace transform является GM-only layout и не меняет scene-local
  coordinates token/fog/drawing.
- PLAYER snapshot, asset ACL и realtime audience строятся только от
  server-side effective scene. Socket room и client filtering не считаются
  авторизацией.
- Existing single-map scenes работают без backfill; будущая миграция additive.
- Cross-scene token transfer — отдельная GM-команда. Обычный drag не меняет
  scene ownership.
- Chat, audio, clock/pause и один encounter lifecycle остаются campaign-wide;
  UIX-243 world geography и UIX-311 group transitions остаются отдельными
  доменами.

## Ревизия

- Baseline: `origin/main@d789d97`.
- Ветка: `codex/uix-319-multi-map-architecture`.
- Discovery revision: pending commit.

## Изменённые файлы

- `docs/plans/uix-319-multi-map-scene-architecture.md` — сравнение моделей,
  термины, доменная/ACL/realtime/migration/performance модель, regression matrix
  и семь будущих implementation pools.
- Этот checkpoint.
- Production code, schema, UI и конфликтные `App.tsx`, `styles.css`,
  `ChatPanels.tsx` не менялись.

## Проверка

- Прочитаны UIX-319, связи, проект и комментарии в Linear; UIX-243 и UIX-311
  сверены как завершённые соседние домены.
- Три независимых read-only аудита покрыли DB/ownership/migration,
  snapshot/assets/realtime/privacy и renderer/performance/scope.
- Два server/data аудита независимо рекомендовали linked-scenes workspace.
  Renderer-аудит предпочёл isolated submaps внутри scene; расхождение явно
  разобрано, вариант submaps оставлен запасным из-за обязательного rekey всех
  canvas/history/realtime данных.
- Тяжёлые тесты не запускались: Discovery меняет только Markdown. Перед
  коммитом обязательны Prettier и `git diff --check`.

## Отдельная находка

- Snapshot asset closure использует `tokens.assetId`, тогда как Token DTO
  публикует `tokenDefinitions.defaultAssetId`. После смены default asset старый
  placement asset может остаться авторизованным. Это существующий дефект вне
  UIX-319; он требует отдельной Linear-задачи и focused privacy-теста.

## Блокеры и следующее действие

- Блокеров для завершения Discovery нет.
- Перед production implementation требуется product review трёх вопросов:
  видимость campaign encounter/initiative для игроков на другой карте,
  persistence GM workspace camera и семантика detach/archive scene.
- После review создать отдельные Linear subtasks на domain/schema, player
  projection + asset ACL, realtime assignment, GM workspace projection, GM UI,
  player transition UX и release gate.
- Push, PR, merge и production в этом пуле не выполняются.
