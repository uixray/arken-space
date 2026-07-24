# UIX-224 — карта стилей и ручное редактирование интерфейса

**Статус:** справочник для ручных правок в VS Code. Это не план миграции и не
замена API-документации Gravity UI.

## Быстрый выбор места правки

| Если меняется…                                                    | Править здесь                                       | Не править здесь                     |
| ----------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Цвет, отступ, граница или раскладка обычного интерфейса           | `apps/web/src/styles.css`                           | `Orthographic2DRenderer.tsx`         |
| Общий токен, слой порталов Gravity или shared primitive           | `apps/web/src/ui/gravity-foundation.css`            | CSS внутри `node_modules`            |
| Состав/поведение формы, диалога, уведомления                      | соответствующий файл в `apps/web/src/ui/`           | сгенерированную DOM-разметку Gravity |
| Фигура, изображение, сетка, fog или токен на карте                | `apps/web/src/renderers/Orthographic2DRenderer.tsx` | CSS-класс ожидая изменить Konva-узел |
| Рамка карты, HTML-оверлей, контекстное меню или кнопка над картой | `styles.css` и JSX renderer-а                       | Konva fill/stroke                    |

## Карта интерфейса

### Точки входа и ответственность файлов

| Область             | Исходники                                           | Что содержит                                                                                            |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runtime и тема      | `apps/web/src/main.tsx`                             | Gravity `configure({ lang: "ru" })`, `ThemeProvider` с dark theme, toaster и порядок глобальных стилей. |
| Прикладная оболочка | `apps/web/src/App.tsx`                              | Состояние игры, topbar, workbench, DOM-оверлеи, ленивая загрузка renderer-а.                            |
| Основные DOM-стили  | `apps/web/src/styles.css`                           | Legacy/прикладные токены и классы экранов; около 2700 строк.                                            |
| Foundation          | `apps/web/src/ui/gravity-foundation.css`            | Небольшой слой токенов `--arken-ui-*`, шкала z-index, стили общих UI-примитивов и preview.              |
| Reusable UI         | `apps/web/src/ui/*.tsx`                             | Адаптеры Gravity и собственные составные компоненты.                                                    |
| Тактическая карта   | `apps/web/src/renderers/Orthographic2DRenderer.tsx` | React-Konva `Stage`/`Layer`/`Group`; канвасная отрисовка и pointer-взаимодействия.                      |

### Доменные зоны `styles.css`

| Зона                            | Главные селекторы                                                                                 | Владелец JSX                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Токены и базовые HTML-элементы  | `:root`, `button`, `input`, `.primary`                                                            | весь DOM UI                                                       |
| Оболочка                        | `.app-shell`, `.topbar`, `.brand`, `.status-line`, `.workbench`                                   | `App.tsx`                                                         |
| Карта и инструменты             | `.map-shell`, `.map-toolbar`, `.map-viewport`, `.map-scale`, `.token-context-menu`, `.token-tray` | `App.tsx`, `Orthographic2DRenderer.tsx`                           |
| Sidebar и чат                   | `.sidebar`, `.tabs`, `.panel-section`, `.message*`, `.chat-*`, `.roll-*`                          | `Sidebar.tsx`, `StoryChannel.tsx`                                 |
| Персонажи и каталог             | `.character-*`, `.stats-grid`, `.palette-*`, `.asset-*`                                           | `Sidebar.tsx`, `CatalogEntryForm.tsx`                             |
| Окна и формы                    | `.arken-workspace-window*`, `.field`, `.inline-fields`, `.copy-field`                             | `ui/ArkenDialog.tsx` и формы                                      |
| Медиа и обратная связь          | `.music-*`, `.feedback-*`, `.upload-*`                                                            | `MusicBar.tsx`, `FeedbackReporter.tsx`                            |
| Изолированные новые поверхности | блоки с комментариями `Sticker picker`, `World-map workspace`, `UIX-246`                          | `StickerPicker.tsx`, `WorldMapsWorkspace.tsx`, `StoryChannel.tsx` |

**Правило именования:** сохранять существующий BEM-подобный стиль
`block__element` и модификатор `.is-*`/`--variant`. Новый класс должен быть
привязан к компоненту-владельцу, а не описывать визуальный эффект
(`.story-card`, не `.orange-card`).

## Компоненты: что переиспользовать

| Нужда                                               | Компонент                                                                          | Основа                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Подтверждение, редактор, обычный modal              | `ui/ArkenDialog.tsx`                                                               | Gravity `Dialog`; `variant="workspace"` — отдельное перетаскиваемое DOM-окно. |
| Опасное действие                                    | `ui/ConfirmDialog.tsx`                                                             | композиция `ArkenDialog`.                                                     |
| Текстовые поля и select в существующей native-форме | `ui/GravityFormControls.tsx`                                                       | адаптеры `TextInput`, `TextArea`, `Select`; сохраняют привычные `onChange`.   |
| Loading / empty / error                             | `ui/EntityState.tsx`                                                               | `Loader`/`Button` Gravity и класс `.arken-state`.                             |
| Загрузка изображений                                | `ui/ImageUploadField.tsx`                                                          | `Button` Gravity + нативный file input.                                       |
| Числовое поле                                       | `ui/NumberStepper.tsx`                                                             | составной Gravity control.                                                    |
| Групповые действия                                  | `ui/SelectionActions.tsx`                                                          | `Button` Gravity.                                                             |
| Новое form/dialog решение                           | `ui/FuturePoolDialogs.tsx`, `ui/SceneManagerDialog.tsx`, `ui/TextPromptDialog.tsx` | готовые ориентиры по композиции.                                              |

`ui/GravityFoundationPreview.tsx` — изолированная витрина доступных паттернов;
она не является частью игрового маршрута. Используйте её для визуальной
проверки нового shared pattern до подключения API.

## Gravity UI: безопасная кастомизация

1. **Сначала API компонента.** Выбирайте `view`, `size`, `disabled`,
   `loading`, `validationState`, `popup`/`dialog` props, если они решают задачу.
   Это сохраняет keyboard/focus semantics библиотеки.
2. **Свой контейнер вместо внутренних селекторов.** Когда нужны layout или
   брендовые отступы, оберните Gravity-компонент своим классом и стилизуйте
   контейнер. Не закрепляйте код за внутренними `.g-*` классами: это деталь
   реализации зависимости.
3. **Foundation — только для действительно общих правил.** Добавляйте в
   `gravity-foundation.css` shared custom properties, portal/z-index policy или
   class, используемый несколькими UI primitives. Экранные стили остаются в
   `styles.css` рядом с доменной зоной.
4. **Не меняйте порядок импортов.** В `main.tsx` сначала подключаются Gravity
   fonts/styles, затем `gravity-foundation.css`, затем `styles.css`. Поздние
   локальные правила могут осознанно перекрывать библиотеку.
5. **Порталы и слои.** Использовать текущую шкалу: canvas `10`, panel `100`,
   popup `1000`, dialog `2000`, toast `3000`. `.g-modal` уже выведен на слой
   dialog, чтобы подтверждение было выше workspace-window. Не вводить
   произвольный `z-index: 99999`.
6. **Тёмная тема.** `ThemeProvider theme="dark"` установлен в `main.tsx`.
   При добавлении native DOM-поверхности использовать `--bg`, `--surface*`,
   `--line`, `--text`, `--muted`, `--accent` из `styles.css`; для foundation
   — `--arken-ui-*`. Не копировать hex-значения без причины.

### Минимальный шаблон

```tsx
<section className="story-card">
  <TextInput label="Заголовок" value={title} onUpdate={setTitle} />
  <div className="story-card__actions">
    <Button view="action" onClick={save}>
      Сохранить
    </Button>
  </div>
</section>
```

```css
.story-card {
  display: grid;
  gap: var(--space-md);
}
.story-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
```

Не заменяйте этот подход селектором вида `.g-text-input__control { … }`.

## DOM и Konva — это два разных слоя

`Orthographic2DRenderer.tsx` возвращает одновременно обычные React DOM-узлы
и React-Konva-узлы. Они визуально находятся в одном viewport, но браузер
стилизует только DOM.

| Слой         | Примеры                                                                         | Как менять вид                                                                                  | Как обрабатываются события                                                         |
| ------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| DOM          | `.map-viewport`, object-list button, `.token-context-menu`, HTML forms/toolbars | CSS-класс и обычные DOM props                                                                   | React synthetic events, focus, keyboard, drag/drop; доступно CSS `:focus-visible`. |
| Konva canvas | `Stage`, `Layer`, `Group`, `Rect`, `Image`, `Text`, `Line`                      | props Konva: `fill`, `stroke`, `opacity`, `fontSize`, `width`, `height`, `visible`, `listening` | Konva pointer events и координаты canvas; hit-test не использует CSS.              |

Практические последствия:

- CSS `.map-viewport { background: … }` изменит рамку/контейнер, но не
  `Rect fill="#282824"` внутри `Stage`.
- Для сетки, тумана, токена или ruler меняйте Konva props/renderer state,
  сохраняя role/fog/visibility условия и transform `position` + `scale`.
- Для tooltip, menu или доступной альтернативы используйте DOM-оверлей. Не
  пытайтесь поместить `<button>` внутрь `Layer`.
- `Stage` получает размеры viewport; canvas-координаты пересчитываются с
  `position` и `scale`. Изменение DOM padding/размера `.map-viewport` требует
  ручной проверки zoom, pan, drag/drop и контекстного меню.
- `listening={false}` делает Konva слой визуальным, но не кликабельным. Не
  включать/выключать его как «CSS pointer-events» без проверки interaction
  flow.

## Ручной workflow в VS Code

1. Найдите JSX-владельца через class name (`Ctrl+Shift+F`). Сначала решите:
   это shared UI, доменный DOM-экран или canvas?
2. Для DOM: добавьте/измените локальный класс в компоненте и правило в
   подходящем блоке `styles.css`. Для shared primitive — `ui/` + foundation.
3. Для canvas: правьте только renderer/его props; не добавляйте CSS как
   замену Konva-стилю. Проверьте GM и PLAYER видимость.
4. Не объединяйте визуальную правку с изменением API, snapshot или realtime
   логики. Для такого изменения нужен отдельный implementation scope.
5. Запустите узкую проверку: `pnpm --filter @arken/web typecheck`. Для
   затронутого игрового flow откройте UI и проверьте keyboard focus, dialogs,
   popup layering, desktop min-width и canvas zoom/pan.
6. Перед передачей выполните минимум `pnpm format:check` и проверку typecheck;
   более широкий gate определяет `docs/development-guide.md`.

## Короткий checklist визуальной правки

- [ ] Компонент использует существующий primitive, если он уже есть.
- [ ] Новое правило ограничено классом-владельцем и не ломает глобальный
      `button/input/select/textarea` baseline.
- [ ] Контраст, disabled и `:focus-visible` остаются различимыми.
- [ ] Popup/dialog/toast остаются в правильном слое.
- [ ] Изменение карты проверено для GM, игрока, zoom/pan и keyboard fallback.
- [ ] Нет стилизации внутренних `.g-*` классов и нет правки файлов зависимости.

## Связанные файлы

- `apps/web/src/main.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/ui/gravity-foundation.css`
- `apps/web/src/ui/GravityFoundationPreview.tsx`
- `apps/web/src/ui/GravityFormControls.tsx`
- `apps/web/src/ui/ArkenDialog.tsx`
- `apps/web/src/renderers/Orthographic2DRenderer.tsx`
