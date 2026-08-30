# UIX-503 — checkpoint handoff и исправления истории

## Решения

- Claude-сессия восстановлена по PR #50; коммит `1917328` перенесён в новую
  Codex-ветку без изменения `claude/*`.
- PR #50 не мержится: зелёный CI не поймал расхождение исходного `sequence` и
  серверного `transitionSequence` после двух Undo.
- `/api/canvas/history` сохраняет свежую страницу, но маркирует точных
  кандидатов `nextDirection` и при необходимости добавляет кандидата из-за
  границы 100 строк.
- Realtime-ключ истории включает id/revision сцены и каждого видимого объекта,
  а не только длину и максимум.
- История хранится вместе с ключом сцены/версии и поколением запроса: при смене
  сцены она сразу скрывается, а поздний GET не перезаписывает свежий ответ.
- Fallback по `status` применяется только к legacy-ответу, где поле
  `nextDirection` отсутствует целиком; `null` нового сервера не воскрешает уже
  недоступный Undo/Redo.
- Поддержанные bulk-команды получили отдельные подписи без имён объектов.
- PLAYER/GM overflow проверяется реальной авторизацией на узком viewport;
  структурный тест остаётся страховкой единого guard.

## Ревизия

- Основа: `origin/main` `a48de5d`.
- Перенесённый коммит Claude: локальный `a85d295` (исходный `1917328`).
- Текущая ветка: `codex/uix-503-history-target-order`.
- Исправления Codex пока не закоммичены.

## Изменённые файлы

- `apps/server/src/routes.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/canvas-history-label.ts`
- `apps/web/src/canvas-history-label.test.ts`
- `apps/web/src/toolbar-overflow.test.ts`
- `tests/pool-b-http.test.ts`
- `tests/e2e/toolbar-overflow-history.spec.ts`
- `docs/plans/uix-503-toolbar-history-handoff.md`
- этот checkpoint

## Проверка

- Baseline-регрессия до server-правки: targeted integration красный,
  объявлен `sequence=2`, фактический Redo вернул `sequence=1`.
- После исправления: focused Vitest — 3 файла, 16 тестов зелёные;
  полный `pnpm typecheck` зелёный.
- Диверсия server candidate: сортировка кандидата по `sequence` уронила ровно
  LIFO integration (`expected 2`, `received 1`).
- Диверсия realtime fingerprint: возврат `length + max(revision)` уронил ровно
  тест изменения немаксимальной ревизии.
- Диверсия bulk label: удаление `CANVAS_BULK_MOVE` уронило ровно таблицу типов с
  сообщением `тип CANVAS_BULK_MOVE не описан`.
- Диверсия PLAYER overflow: удаление общего render guard уронило ровно новый
  Chromium-тест — Tab вошёл в `.toolbar-overflow`; после возврата guard целевой
  прогон прошёл в Chromium и Firefox (10/10).
- Диверсия metadata fallback: возврат fallback для каждой строки уронил ровно
  новый unit-кейс — вместо `undefined` выбрана `UNDONE` с
  `nextDirection: null`; после возврата helper прошёл 14/14.
- Диверсия scene key: чтение entries без проверки ключа уронило ровно browser-
  регрессию — после A → B кнопка осталась включённой с подписью A.
- Диверсия request generation: удаление generation guard уронило тот же тест в
  поздней точке — старый A заменил «токен перемещён» на «размер токена изменён».
  После возврата guard целевой прогон прошёл в Chromium и Firefox (12/12).
- Финальные `format:check`, `lint` (три существующих warning, без ошибок),
  `typecheck` и `build` зелёные.
- Полный `test:e2e` до последних review-guard прошёл: 220 passed, 4 skipped,
  Chromium + Firefox, exit code 0; после guard целевой затронутый spec — 12/12.
- Финальный полный `pnpm test` локально не получил зелёный статус: 182/184
  файлов и 1367/1372 тестов прошли, пять тестов упёрлись в случайные 20-секундные
  PGlite `beforeEach` timeout. Два затронутых файла отдельно прошли 99/99;
  следующий повтор дал такие же инфраструктурные timeout уже в других файлах.
  Поэтому штатный полный test-гейт должен подтвердить GitHub CI.

## Блокеры

- Подтверждённых продуктовых блокеров нет.
- Локальный `test:multiplayer` не пройден: Docker Desktop не стартует из-за
  локального stale socket. Это не зелёный гейт; multiplayer должен пройти в CI
  replacement PR.
- Финальные полные `test` и `e2e` также остаются CI-гейтами по причинам выше;
  PR нельзя считать готовым до их зелёного результата.

## Следующее действие

Закоммитить изменения, открыть replacement PR и дождаться зелёных GitHub CI,
включая `e2e` и `multiplayer`; после этого перевести UIX-503 в In Review. PR не
мержить без решения пользователя.
