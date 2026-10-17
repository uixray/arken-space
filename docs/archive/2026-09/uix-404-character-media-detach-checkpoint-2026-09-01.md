# UIX-404 — checkpoint открепления изображений — 2026-09-01

## Решения

- «Убрать из галереи» и мастерское удаление записи требуют явного
  подтверждения. В обоих диалогах прямо сказано, что исходный файл остаётся в
  медиатеке.
- `actionId` создаётся при открытии подтверждения и сохраняется на весь intent:
  повтор после неоднозначного ответа не создаёт новую операцию.
- Смена персонажа, обратный порядок GET-ответов и завершение старой mutation не
  могут вернуть или изменить чужую галерею. Неуспешный refresh работает
  fail-closed: старые строки и разрушающие действия скрываются.
- При CAS-конфликте галерея обновляется. Успех просит повторить действие, ошибка
  refresh сохраняет собственное сообщение и не открывает stale intent.
- Серверный detach остаётся мягким: запись исчезает из галереи, asset остаётся,
  повтор того же `actionId` идемпотентен, аудит создаётся один раз.
- Удаление самого asset и дедупликация загрузок остаются вне UIX-404.

## Ревизия и файлы

- Baseline: `23683aeb1e3e0d50ca98e82b29b2c07682c9dde6`.
- Ветка: `codex/uix-404-character-media-detach`.
- Изменены:
  - `apps/web/src/sidebar/CharacterMediaGallery.tsx`;
  - `apps/web/src/sidebar/CharacterMediaGallery.removal.test.tsx`;
  - `apps/server/src/character-media.integration.test.ts`;
  - `tests/e2e/character-media-detach.spec.ts`;
  - этот checkpoint.
- Не затронуты `apps/web/src/styles.css`, `apps/web/src/App.tsx` и
  `apps/web/src/sidebar/ChatPanels.tsx`.

## Проверка

- Focused Vitest: 3 файла, 31 тест — passed.
- Полный основной gate в обязательном порядке (`format:check`, `lint`,
  `typecheck`, `build`, `test`) — passed; Vitest: 186 файлов, 1432 теста.
  Существующие предупреждения lint: два `exhaustive-deps` в `App.tsx` и одно
  `react-refresh` в `player-request-chat.tsx`; ошибок нет.
- Полный Playwright на одноразовом локальном PostgreSQL и собранном API:
  Chromium/Chrome + Firefox — 212 passed, 4 штатно skipped, 23 минуты. Первый
  старт на `55173` не дошёл до тестов из-за зарезервированного Windows порта;
  неизменённый повтор на `54405` прошёл. Локальные API, БД и temp-каталог после
  прогона остановлены и удалены.
- Диверсия подтверждения: временный прямой detach дал ровно 1 целевое падение и
  2 skipped; код возвращён.
- Диверсия race-guard: временное принятие устаревшего GET дало ровно 1 целевое
  падение и 6 skipped; после возврата guard тест прошёл.
- Независимый финальный review: actionable findings отсутствуют.
- `pnpm test:multiplayer` не требуется: realtime, доступ, реконнект, миграции и
  сохранение канваса не менялись.

## Блокеры и следующее действие

- Блокеров реализации и локальных гейтов нет.
- Следующее действие: commit и перевод UIX-404 в `In Review`. Push, PR, merge и
  production-публикация в этом пуле не выполняются.
