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
