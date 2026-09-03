# UIX-589 — быстрый token flow с crop/zoom

## Замер текущего пути

Генератор уже встроен в `TokenDefinitionEditor`; диагноз задачи частично
устарел. `TokenImageGenerator` уже даёт center-cover preview, pan, keyboard
nudge, zoom и server-side 512×512 derivative.

Подтверждённый дефект находится в orchestration:

- upload создаёт исходный `IMAGE` и сразу записывает его ID в `assetId`;
- `AssetPicker` также разрешает выбрать `IMAGE` как итоговое изображение;
- submit принимает этот IMAGE без обязательного шага генерации TOKEN;
- renderer затем показывает прямоугольный IMAGE внутри формы токена, поэтому
  пользователь видит не тот crop, который ожидал.

То есть второй crop engine не нужен. Нужно сделать существующий generator
обязательным переходом для IMAGE и объединить источники ввода вокруг него.

## Подзадачи

1. **Vertical safety slice:** IMAGE становится только source; submit требует
   производный TOKEN, upload автоматически выбирается в generator, но не в
   definition. Покрыть portrait/landscape и cancel/failure.
2. **Unified intake:** picker, paste и drop проходят общую file validation и
   открывают тот же editor.
3. **Create-and-place:** после успешного derivative атомарно создать definition
   и только затем placement; показать success state.
4. **Replace:** переиспользовать editor и серверную атомарную замену UIX-609,
   сохраняя старое изображение до commit.
5. **Responsive/accessibility:** touch targets, narrow layout и browser checks.

## Первый пул

Начать с vertical safety slice: это устраняет подтверждённое молчаливое
растягивание без изменения API и без правок `App.tsx`, `styles.css` или
`ChatPanels.tsx`. Остальные подзадачи не смешивать с этим коммитом.

## Checkpoint — 2026-09-03

- **Решения:** `IMAGE` остаётся только исходником crop/zoom; готовым изображением
  definition может быть только `TOKEN`. Picker, paste и drop объединены в один
  opt-in intake. «Создать и поставить» переиспользует транзакционный
  `POST /api/tokens`. При смене изображения definition его размещения получают
  новый `assetId` в той же транзакции; общий asset не перезаписывается.
- **Ревизии:** `051a7d4` (UIX-611), `077f539` (UIX-612), `348bf9d`
  (UIX-613), `bfc74fa` (UIX-614).
- **Изменено:** token editor и actions, `ImageUploadField`, PATCH определения,
  component/action/HTTP integration tests.
- **Проверка:** focused-наборы 8/8, 15/15, 14/14 и HTTP 1/1; scoped lint и
  package typecheck прошли; общий format/lint/typecheck/build прошёл (три
  существующих lint warning). Диверсия выполнена для каждого нового набора.
- **Блокеры:** общий Vitest дважды не завершился без результата: обычный запуск
  держал два процесса примерно по 1 ГБ, однопоточный — один процесс примерно
  1 ГБ более восьми минут; оба остановлены, чтобы не перегружать компьютер.
  Responsive-часть требует `apps/web/src/styles.css`, который исключён из
  полосы параллельной работы.
- **Дальше:** после освобождения hot-file выполнить narrow/touch CSS и browser
  QA; отдельно диагностировать зависание полного Vitest без повторного
  неограниченного запуска.

## Checkpoint — 2026-09-03 (Slice 5 — Responsive, touch targets, browser QA)

- **Решения:** `apps/web/src/styles.css` и `gravity-foundation.css` обновлены:
  - `.entity-form > .dialog-actions` получил flex wrap и мобильную раскладку с минимальной высотой тач-таргетов 44px;
  - `.token-dimensions .inline-fields` на экранах <= 520px перестраивается в двухколоночную сетку с сохранением пропорций на отдельной строке;
  - `.token-image-generator` слайдер масштаба увеличен до 40px touch-height, кнопки действий и пресеты рамок получили 44px touch targets для coarse pointers;
  - `.arken-upload-field__empty` получил интерактивный курсор, состояния `:hover`/`:focus-visible`, visual drag-over (`data-dragover="true"`) и доступность с клавиатуры (Enter / Space) и клика;
  - в `tests/e2e/token-generator.spec.ts` добавлен браузерный тест UIX-613 на быстрое создание и размещение токена на сцене в одно действие.
- **Проверка:**
  - `ImageUploadField.intake.test.tsx`: 9/9 PASS (добавлены тесты клика, клавиатуры и drag-over, диверсия проверена);
  - `token-generator.spec.ts`: 4/4 PASS (диверсия проверена, падает целево);
  - `pnpm --filter @arken/web typecheck` PASS;
  - `pnpm prettier --check` PASS.
