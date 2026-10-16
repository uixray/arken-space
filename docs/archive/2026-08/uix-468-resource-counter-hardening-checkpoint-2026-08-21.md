# UIX-468 resource counter hardening checkpoint — 2026-08-21

## Ревизия

- Ветка: `main`.
- Baseline перед пулом: `6715ade15d406b85ba098f7a9d388879a6e9744a`.
- Исходная реализация интерфейса ресурсов: `d105cf7`.
- Hardening implementation:
  `c9e33d6` — `fix(resources): preserve queued counter intents (UIX-468)`.
- Push и deployment не выполнялись.

## Решения

- Кнопки `−1`, `+1` и восстановление передают относительный `DELTA`, который
  применяется к актуальному состоянию в очереди персонажа. Ручной числовой
  ввод передаёт абсолютный `SET`.
- Серия нажатий `±1` собирается в одну мутацию за 600 мс. Уже принятое
  действие не теряется при закрытии панели: незавершённый batch отправляется в
  стабильную очередь приложения.
- Optimistic draft версионируется по generation и изолирован по character id и
  resource key. Завершение старого запроса не может удалить более новый draft
  или перенести его на другого персонажа.
- Payload строится от актуальной головы очереди, а не от устаревшего React
  snapshot. Относительные intent безопасно повторяются после CAS-конфликта;
  `SET` и структурные изменения не повторяются автоматически.
- Семантический no-op после rebase считается успешным и не отправляется на
  сервер, поэтому граница ресурса и уже выполненный `SET` не превращаются в
  ложную ошибку `NO_COUNTER_CHANGES`.
- Полная карта ресурсов из карточки персонажа преобразуется в трёхсторонний
  semantic patch. Она сохраняет свежие значения других ресурсов, корректно
  применяет добавление, удаление и изменённые поля и удерживает
  `current <= maximum`, не округляя дробные пользовательские ресурсы.
- Блок «Ресурсы» вынесен из accessibility-region «Быстрые броски», остаётся
  сворачиваемым и использует явную HTML-связь label/input для числовых полей.
- Regen-характеристики не возвращены в список бросков; восстановление не
  создаёт dice/chat-roll запросов.

## Изменённые файлы

- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `apps/web/src/character-counter-mutation.ts`
- `apps/web/src/character-counter-mutation.test.ts`
- `apps/web/src/resource-counter-intent.ts`
- `apps/web/src/sidebar/CharacterWorkspace.tsx`
- `apps/web/src/sidebar/ChatPanels.tsx`
- `apps/web/src/sidebar/ResourceCounters.tsx`
- `apps/web/src/sidebar/ResourceCounters.test.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`

## Проверка

- Focused final Vitest:
  `ResourceCounters.test.tsx` + `character-counter-mutation.test.ts` —
  **2 files / 34 tests PASS**.
- Полный Vitest — **168 files / 1222 tests PASS**.
- `pnpm typecheck`, включая E2E TypeScript — PASS.
- `pnpm lint` — PASS: **0 errors**, три существующих warnings.
- Production build — PASS; остаётся существующее предупреждение о крупном web
  chunk.
- Targeted Playwright Chromium + Firefox, `--retries=0` — **2/2 PASS**.
  Проверены отдельный collapsible block, доступные numeric inputs, batching,
  cross-resource rebase, regen без броска, Enter/blur dedupe и rollback после
  `CHARACTER_CONFLICT`.
- Scoped Prettier и `git diff --check` — PASS.
- Независимые read-only review нашли race/unmount/max-boundary сценарии; после
  исправлений повторное review не обнаружило P0/P1/P2-блокеров.

## Блокеры и границы

- Блокеров по acceptance criteria UIX-468 не осталось.
- Пул клиентский: server routes, schema, auth и realtime не менялись. Docker
  multiplayer не является issue-level gate этого изменения и не запускался.
- Live GM + player rehearsal, production backup/restore/smoke и deployment
  остаются общими release gates проекта.
- `apps/web/src/assets/game-pause-rest.webp` и приватные
  `docs/stickers/prompts/ST-*.md` не относятся к пулу и не включены в коммиты.
- Связанный долг вынесен из scope: системные строки `enduranceRegen` и
  `manaRegen` сейчас можно удалить из layout, оставив скрытое каноническое
  значение. Нужна отдельная задача и продуктовое решение — запрет удаления
  либо явное отключение/восстановление системной строки.

## Следующий шаг

1. Обновить UIX-468 в Linear с implementation SHA и verification evidence.
2. Завести связанный follow-up по жизненному циклу системных regen-строк без
   смешивания с закрытым пулом.
3. После свежего Linear triage перейти к следующему подтверждённому urgent/high
   дефекту.
