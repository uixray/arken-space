# UIX-405 — перемещение токена с клавиатуры и Ctrl-пинг

## Замер

- Ctrl+клик уже ставит пинг в PR #58, но конфликтует с Ctrl-waypoint активной линейки.
- Стрелки уже двигают выбранные объекты через `MapMoveQueue`; WASD отсутствует, а `D` занят инструментом рисования.
- `MapMoveQueue` сериализует и объединяет запросы только пока предыдущий запрос в полёте. При быстрых ответах auto-repeat способен создать поток мутаций.

## Решение

1. WASD получают приоритет только в PAN и только при наличии выбранного управляемого токена; иначе `D` сохраняет существующий shortcut DRAW.
2. Шаг — размер клетки включённой сетки или 8 координат без сетки; Shift умножает шаг на 5.
3. Повторный `keydown` физически удерживаемой клавиши игнорируется. Одно физическое нажатие даёт не более одной мутации и не создаёт сетевой шторм.
4. Поля ввода, composition и комбинации с Alt/Ctrl/Meta не перехватываются.
5. Ctrl, реально добавивший waypoint линейки, подавляет только следующий синтетический Ctrl-click ping; обычный Ctrl+click продолжает ставить пинг.

## Проверка

- Pure tests для раскладки, шага, приоритета `D` и suppression линейки.
- Browser regression для WASD, auto-repeat, DRAW fallback и поля ввода.
- Realtime/browser проверка Ctrl+click ping и отсутствия лишнего ping у линейки, если сценарий надёжно встраивается в существующий multiplayer fixture.
- Обязательная диверсия адресно ломает новую ветку WASD или repeat guard и доказывает падение нового теста.

## Зависимость

Ветка stacked на PR #58 (`codex/uix-621-core-gameplay`), потому что именно там находится пользовательский Ctrl+click ping и актуальный слой массового выбора. Merge и production publication выполняются позже отдельным scope.

## Чекпоинт

- Решение: WASD имеет приоритет только для выбранного управляемого токена в PAN; auto-repeat поглощается, а `D` без такой выборки остаётся shortcut рисования.
- Изменённые файлы: `Orthographic2DRenderer.tsx`, `map-interaction.ts`, `map-interaction.test.ts`, `canvas-token-regressions.spec.ts`, этот план.
- Проверка: pure unit 30/30 PASS; web typecheck и адресный ESLint PASS; UIX-405 browser regression Chromium + Firefox 2/2 PASS.
- Существующее доказательство Ctrl+click: multiplayer GM browser input получает server-authoritative `map:ping` на втором клиенте. Новый pure test закрепляет подавление лишнего ping после Ctrl-waypoint линейки.
- Диверсия: отключение repeat guard дало адресное падение browser regression — ожидалось 5 запросов, получено 10; файл восстановлен.
- Блокеры: отсутствуют для review. Полный связанный CI выполняется в PR; production-сервер не используется.
- Следующее действие: commit, push, stacked PR в PR #58, Linear In Review.
