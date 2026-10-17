# UIX-467 / UIX-492 UI hardening checkpoint — 2026-08-21

## Ревизия

- Ветка: `main`.
- Базовая ревизия пула: `3b7dd14cdc86f1765d767e4517fe9f20263b22c1`.
- UIX-467: `708009a` — `fix(activity): unify journal controls (UIX-467)`.
- UIX-492: `a8f8dcf` — `fix(audio): preserve playback while changing volume (UIX-492)`.
- Состояние: изменения зафиксированы только локально; push и deployment не выполнялись.

## Решения

### UIX-467 — Activity

- Фильтр потоков расположен рядом с заголовком «Журнал» и открывается из
  компактного меню.
- Дублирующая кнопка «Заявка мастеру» удалена из Activity. Ролевая точка входа
  остаётся в общей навигации: «Открытые заявки» для GM и «Мои заявки» для
  игрока.
- Раскрытие истории вынесено в отдельную строку нормального потока над
  прокручиваемой лентой. Кнопка явно говорит «Показать больше/меньше», сообщает
  состояние через `aria-expanded` и связана с лентой через `aria-controls`.
- Состояние представления истории вычисляется одной pure-функцией, чтобы число
  записей, пояснение и подпись действия не расходились.
- Раскладка проверяется при ширине боковой панели 280, 360 и 600 px.

### UIX-492 — Music

- Личная громкость отделена от playback reconciliation: изменение slider не
  вызывает повторный `play()`, seek или socket-команду общего аудиосостояния.
- Gain применяется до первого `play()`, поэтому при загрузке нет краткого
  скачка до полной громкости.
- Slider использует quadratic curve (`value²`) для управляемых тихих значений.
- При отсутствии сохранённой настройки используется ожидаемое значение `0.5`,
  а повреждённые значения ограничиваются безопасным диапазоном.
- Popover громкости больше не обрезается контейнером верхней панели.

## Изменённые файлы

UIX-467:

- `apps/web/src/activity-roll-controls.ts`
- `apps/web/src/activity-roll-controls.test.ts`
- `apps/web/src/sidebar/ChatPanels.tsx`
- `apps/web/src/styles.css`
- `tests/e2e/activity-feed-layout.spec.ts`
- `tests/e2e/concept.spec.ts`

UIX-492:

- `apps/web/src/MusicBar.tsx`
- `apps/web/src/MusicBar.test.ts`
- `apps/web/src/audio-volume.ts`
- `apps/web/src/styles.css`
- `tests/e2e/concept.spec.ts`

## Проверка

- Focused Vitest: **4 files / 30 tests PASS**.
- Full Vitest: **167 files / 1201 tests PASS**.
- `pnpm typecheck`: PASS, включая `tests/e2e/tsconfig.json`.
- `pnpm lint`: PASS.
- Production build: PASS; остаётся известное предупреждение о крупном web
  chunk.
- Targeted fixture QA Chromium: **3/3 PASS**.
- Targeted fixture QA Firefox: **3/3 PASS**.
- Scoped Prettier: PASS.
- `git diff --check`: PASS.
- Все технические файлы проверены как UTF-8 без BOM и без placeholder-строк.

## Блокеры и границы

- Live `tests/e2e/activity-feed-layout.spec.ts` на финальном содержимом не
  запускался: локальный `GM_ACCESS_TOKEN` не подтверждён. Fixture-based QA
  покрывает раскладку и роль игрока, но не заменяет этот environment gate.
- Docker multiplayer не запускался: пул client-only и не меняет server,
  realtime или схему. Docker остаётся release gate проекта.
- Human rehearsal GM + 6, production backup/restore/smoke и deployment не
  выполнялись.
- `docs/stickers/prompts/ST-*.md` остаются приватным творческим scope и не
  включены в технические коммиты.
- `apps/web/src/assets/game-pause-rest.webp` остаётся отдельным untracked asset
  без подтверждённых provenance, task mapping и ownership; в коммиты не включён.
- UIX-382 (multitrack mixer) — отдельная незавершённая задача и не закрывается
  исправлением UIX-492.

## Следующий шаг

1. Перевести UIX-467 и UIX-492 в review с точными SHA и evidence этого gate.
2. Перейти к следующему срочному подтверждённому пулу: UIX-426 с проверкой
   пересечения с UIX-399 (частичное скрытие объектов туманом).
