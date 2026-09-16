# UIX-645 — migration checklist

Миграция ниже уже интегрирована в main. Таблица сохраняет исходную карту
замены и границы проверок, а не список повторных изменений. Полная визуальная
приёмка UIX-645 остаётся открытой: hosted/component PASS не заменяет проверку
тем, контраста, фокуса, состояний и hit-area на реальных экранах.

Историческая база inventory: `db68636` (интегрированный main `22e0583` плюс
сохранённый foundation). Source inventory 2026-09-12 выявил
38 сгруппированных кандидатов в оставшихся областях; это не число готовых задач
и не доказательство отсутствия иных мест. Обычный текст, формулы, хоткеи,
пользовательские emoji/стикеры и игровые данные сохраняются.

## Карта интегрированной миграции

| Контрол                                                        | Прежнее представление       | Named Lucide                                                       | Проверка                                                                          |
| -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Workspace close / reset                                        | × / сброс                   | X / RotateCcw                                                      | existing ArkenDialog.icons + AppIcon DOM                                          |
| Карта: pan / reveal / cover                                    | CSS glyphs                  | Hand / Eye / EyeOff                                                | MapToolbar DOM, доступные имена                                                   |
| Кисть reveal / cover                                           | CSS круги                   | Brush / Eraser                                                     | состав SVG, прежние handlers                                                      |
| Полигон reveal / cover                                         | CSS pentagon / hexagon      | Pentagon / Hexagon                                                 | разные формы в collapsed DOM                                                      |
| Draw / ruler / ping                                            | CSS glyphs                  | Pencil / Ruler / MapPin                                            | data-tool и SVG                                                                   |
| Cursor PLAYER / GM                                             | CSS arrow                   | MousePointer2                                                      | разные права, имена и действия                                                    |
| Grid / resize                                                  | CSS # / стрелки             | Grid3x3 / Maximize2                                                | scoped CSS + SVG                                                                  |
| History undo / redo                                            | CSS + HTML entities         | Undo2 / Redo2                                                      | отсутствие двойных glyphs                                                         |
| Toolbar expand / collapse / more                               | « / » / bullets             | ChevronsLeft / ChevronsRight / Ellipsis                            | collapsed state и имена                                                           |
| Sidebar collapse                                               | HTML entity                 | PanelRightClose                                                    | scoped source gate; browser ещё не выполнен                                       |
| Music play / pause / volume / menu                             | glyphs и entities           | Play / Pause / Volume2 / Ellipsis                                  | реальные SVG и разные формы play/pause                                            |
| Game pause action                                              | Ⅱ                           | Pause                                                              | прежнее доступное действие + SVG                                                  |
| Shell: сцены / публикация / create / session / sidebar / toast | glyphs и entities           | ChevronDown / Cast, ScreenShare / Plus / Menu / PanelRightOpen / X | source guard и negative source fixture; browser не выполнен                       |
| Персонажи: rail / close / add / archive                        | glyphs и emoji              | PanelLeftClose / PanelLeftOpen / X / Plus / Archive                | scoped source guard; browser не выполнен                                          |
| Характеристики: reorder / rename / delete / add                | glyphs                      | ArrowUp / ArrowDown / Pencil / Trash / Plus                        | существующий StatLayoutCard DOM дополнен; negative source fixture                 |
| Режимы бросков / приватность / disclosure                      | стрелки, круг, diamond      | ArrowUp / ArrowDown / Circle / EyeOff / ChevronRight / ChevronDown | новые DiceTray DOM-кейсы; shared secret icon; source guard                        |
| Ресурсы / статус участников                                    | отдельные −/+ и ●/○         | Minus / Plus / CircleDot / Circle                                  | ResourceCounters DOM дополнен; hidden online/offline text; source guard           |
| World/character media                                          | reorder / pagination arrows | ArrowUp / ArrowDown / ArrowLeft / ArrowRight                       | source guard; явные доступные имена; runtime gate остаётся                        |
| World map / token selection / zoom                             | markers / checkmark / −/+   | MapPin / UsersRound / Check / Minus / Plus                         | WorldMaps GM/PLAYER marker и TokenCondition DOM дополнены; layer/zoom source-only |
| Upload / selection / foundation preview                        | Gravity SVG                 | Trash / ArrowRight / X / Plus / Settings                           | upload/selection DOM дополнены; прямой импорт прежнего пака запрещён scoped guard |
| StickerPicker compact trigger                                  | escaped Unicode smile       | Sticker                                                            | named/disabled trigger DOM подготовлен; escaped literal guard fixture             |
| Chat filter / Activity and legacy chat send                    | ⋯ / ➤                       | Ellipsis / Send                                                    | scoped source guard; runtime pending after integration with draft repair          |

Ни одна строка не означает PASS нового runtime. Старые foundation-результаты
отделены в [checkpoint](./plans/uix-645-lucide-foundation.md).

## Исторические границы приёмки по областям

Записи «подготовлено» ниже относятся к исходному inventory. Реализация
интегрирована; открытые пункты обозначают оставшуюся визуальную приёмку,
а не разрешение заново выполнять миграцию.

- [ ] `App.tsx`: scene disclosure, publication state/action, create scene,
      account menu, expand Sidebar, notification close. Source подготовлен;
      исходные publication branch и обработчики сохранены, runtime QA остаётся.
- [ ] `MusicBar.tsx`, `GamePauseOverlay.tsx`: play/pause, volume, overflow,
      pause action. Исходник подготовлен, ожидаются QA и приёмка.
- [ ] `RollModeControl.tsx`: normal/advantage/disadvantage. Source подготовлен;
      клавиатурная логика и radio semantics сохранены, QA ожидается.
- [ ] `sidebar/ChatPanels.tsx`: фильтры и send; миграцию совместить с
      интегрированным UIX-624, не затереть его pending-draft repair. Source теперь
      подготовлен после интеграции проверенного main9393593. Буквальная `/`
      команда не заменяется; Direct send остаётся текстовой кнопкой.
- [ ] `StickerPicker.tsx`: escaped `\u263A` найден дополнительным аудитом;
      trigger мигрирован на Sticker, текстовый режим сохранён. Lifecycle и
      browser matrix — отдельные оставшиеся критерии UIX-644, не решены иконкой.
- [ ] `sidebar/CharacterWorkspace.tsx`: rail, close, add/archive controls.
      Source подготовлен; compact alignment и browser QA ожидаются.
- [ ] `sidebar/StatLayoutCard.tsx`: reorder, rename, delete, add. Source и
      узкие регрессионные тесты подготовлены, не запускались.
- [ ] `sidebar/QuickRollPanel.tsx`, `DiceTrayPanel.tsx`: disclosure / roll /
      GM-only marker. Source подготовлен: EyeOff означает приватность, не
      сам бросок; прежние названия d2–d20 и формулы оставлены. Runtime QA ожидается.
- [ ] `sidebar/ResourceCounters.tsx`: отдельные кнопки −/+; числовое значение,
      дробь и математический текст не заменять. Source и focused test подготовлены.
- [ ] `sidebar/SetupPanel.tsx`: status dots; добавлено нецветовое доступное
      обозначение. Source подготовлен, browser/DOM QA остаётся.
- [ ] `WorldMapsWorkspace.tsx`: location/group-position markers; игровую
      позицию/геометрию не менять вместе с декоративным SVG. Source и marker
      DOM-кейсы подготовлены, currentColor/размеры/тени требуют visual gate.
- [ ] `WorldContentWorkspace.tsx`, `sidebar/CharacterMediaGallery.tsx`:
      reorder и pagination. Source подготовлен, actual browser QA ожидается.
- [ ] `renderers/TokenConditionMenu.tsx`, `Orthographic2DRenderer.tsx`:
      selected condition/layer и zoom. Source подготовлен, выбранность остаётся
      семантической; TokenCondition DOM дополнен, canvas runtime не проверен.
- `sidebar/InitiativePanel.tsx` не подключён к продукту. Это сохранённый legacy,
  а не оставшаяся видимая миграция; не возвращать скрытый боевой функционал.
- `GravityFoundationPreview`, `ImageUploadField`, `SelectionActions` уже
  переведены на Lucide. Внутренние иконки UIKit остаются отдельной границей;
  не удалять зависимость без проверки её реальных потребителей.
- [ ] Проверить итоговый bundle на отсутствие полного каталога/CDN.
- [ ] Общий hosted quality + negative/restored + browser GM/PLAYER,
      desktop/compact, keyboard, темы/контраст. Не заменять это source review.

Примеры исключений: slash-команда `/`, loading ellipsis, буквальные клавиши
стрелок в справке, relation arrow в содержимом, initials/counts, CSS empty
content и counter(). Если значок совмещает статус и действие, сохранить
доступный текст и сверить с поведением; это не повод менять продуктовый flow.

## Автоматический охват исходников

`scripts/ui-source-closure.mjs` строит детерминированный граф от
`apps/web/src/main.tsx`: относительные import/export, literal dynamic import
и CSS `@import`. `scanProtectedSources` проверяет TS/JS и все CSS-селекторы
этого графа плюс прежние явно защищённые migration previews. Новый подключённый
экран автоматически попадает под проверку без правки списка файлов.

Неразрешённый относительный импорт, ошибка синтаксиса и выход за границы
проекта (в том числе через symlink) блокируют проверку. Пакеты/node_modules,
неподключённый legacy, игровые данные и изображения не сканируются как UI-код.
Это статический относительный import graph, не доказательство полноты
runtime-кода внешних компонентов или визуальной приёмки.

Стрелка между `card.uses.before` и `card.uses.after` в неинтерактивном абзаце
результата `SkillCards` — текст, не иконка. Исключение проверяет точные
семантические соседние поля, файл и абзац; оно не разрешает стрелку в кнопке,
интерактивной роли/обработчике или произвольном новом контроле.
Обработчик Escape у внешнего контейнера сам по себе не превращает текст
результата в кнопку. Буквальные стрелки/минус в `keys` справочника
`landing-guide-content.ts` допустимы как подписи клавиш, только с непустым
описанием действия. Другие config-поля и произвольные emoji не исключаются.

Адресный gate: `tests/ui-icon-policy.test.ts` и
`tests/ui-source-closure.test.ts`; он дополняет, но не заменяет общий
интеграционный CI и отдельную GM/PLAYER visual-state проверку.

Публикация ветки/PR и production — отдельные разрешения и gates. Текущее
состояние UIX-645 не даёт разрешения выкладывать весь дизайн на production.
