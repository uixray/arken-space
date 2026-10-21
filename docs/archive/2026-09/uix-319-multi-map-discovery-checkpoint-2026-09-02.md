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
- Discovery revision: `2a8f61c31804595e4493c0e6e7e97487c6dc716d`.

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
- Тяжёлые тесты не запускались: Discovery меняет только Markdown.
- Prettier двух документов и staged `git diff --check` — passed.

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

## Контрольная точка AC — 2026-09-08

- Revision: рабочие изменения поверх `bd54c64`; новый commit не создавался.
- Changed files: только архитектурный план и этот checkpoint.
- Decisions: термин effective scene согласован с §5 — fallback только без
  READY workspace текущего anchor, иначе assignment либо fail-closed waiting.
  В §9.1 описаны будущие revisioned GM undo/redo transform, restore detach и
  restore workspace в DRAFT без оживления assignments или удаления scenes.
  Сценарии и regression matrix дополнены соответствующими negative cases.
- Verification: вручную сопоставлены термины, алгоритм authority, lifecycle,
  rollback и privacy-ограничения; это проверка документационной согласованности,
  не runtime proof. Schema, API, UI и тесты реализации не менялись/не запускались.
  Scoped Prettier check двух Markdown и `git diff --check` — PASS; зависимости
  не устанавливались, использован имеющийся formatter соседнего worktree.
- Blockers: два обнаруженных документационных пробела закрыты. Три продуктовых
  решения §16 остаются отдельным gate перед будущей production implementation;
  в этом пуле они не приняты и реализация не разрешена.
- Next action: root review документационного AC; новые карточки, публикация,
  merge и production в этом пуле не выполнялись.
