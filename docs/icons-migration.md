# UIX-645 — migration checklist

Состояние: локальная реализация, до hosted gate. База `db68636` (интегрированный
main `22e0583` плюс сохранённый foundation). Source inventory 2026-09-12 выявил
38 сгруппированных кандидатов в оставшихся областях; это не число готовых задач
и не доказательство отсутствия иных мест. Обычный текст, формулы, хоткеи,
пользовательские emoji/стикеры и игровые данные сохраняются.

## Подготовлено, но не принято

| Контрол | Прежнее представление | Named Lucide | Проверка |
| --- | --- | --- | --- |
| Workspace close / reset | × / сброс | X / RotateCcw | existing ArkenDialog.icons + AppIcon DOM |
| Карта: pan / reveal / cover | CSS glyphs | Hand / Eye / EyeOff | MapToolbar DOM, доступные имена |
| Кисть reveal / cover | CSS круги | Brush / Eraser | состав SVG, прежние handlers |
| Полигон reveal / cover | CSS pentagon / hexagon | Pentagon / Hexagon | разные формы в collapsed DOM |
| Draw / ruler / ping | CSS glyphs | Pencil / Ruler / MapPin | data-tool и SVG |
| Cursor PLAYER / GM | CSS arrow | MousePointer2 | разные права, имена и действия |
| Grid / resize | CSS # / стрелки | Grid3x3 / Maximize2 | scoped CSS + SVG |
| History undo / redo | CSS + HTML entities | Undo2 / Redo2 | отсутствие двойных glyphs |
| Toolbar expand / collapse / more | « / » / bullets | ChevronsLeft / ChevronsRight / Ellipsis | collapsed state и имена |
| Sidebar collapse | HTML entity | PanelRightClose | scoped source gate; browser ещё не выполнен |
| Music play / pause / volume / menu | glyphs и entities | Play / Pause / Volume2 / Ellipsis | реальные SVG и разные формы play/pause |
| Game pause action | Ⅱ | Pause | прежнее доступное действие + SVG |
| Shell: сцены / публикация / create / session / sidebar / toast | glyphs и entities | ChevronDown / Cast, ScreenShare / Plus / Menu / PanelRightOpen / X | source guard и negative source fixture; browser не выполнен |

Ни одна строка не означает PASS нового runtime. Старые foundation-результаты
отделены в [checkpoint](./plans/uix-645-lucide-foundation.md).

## Оставшиеся области по source inventory

- [ ] `App.tsx`: scene disclosure, publication state/action, create scene,
      account menu, expand Sidebar, notification close. Source подготовлен;
      исходные publication branch и обработчики сохранены, runtime QA остаётся.
- [ ] `MusicBar.tsx`, `GamePauseOverlay.tsx`: play/pause, volume, overflow,
      pause action. Исходник подготовлен, ожидаются QA и приёмка.
- [ ] `RollModeControl.tsx`: normal/advantage/disadvantage.
- [ ] `sidebar/ChatPanels.tsx`: фильтры и send; миграцию совместить с
      интегрированным UIX-624, не затереть его pending-draft repair.
- [ ] `sidebar/CharacterWorkspace.tsx`: rail, close, add/archive controls.
- [ ] `sidebar/StatLayoutCard.tsx`: reorder, rename, delete, add.
- [ ] `sidebar/QuickRollPanel.tsx`, `DiceTrayPanel.tsx`: disclosure / roll /
      GM-only marker. Выбирать форму по действию и доступному имени.
- [ ] `sidebar/ResourceCounters.tsx`: отдельные кнопки −/+; числовое значение,
      дробь и математический текст не заменять.
- [ ] `sidebar/SetupPanel.tsx`: status dots; сохранить нецветовое обозначение.
- [ ] `WorldMapsWorkspace.tsx`: location/group-position markers; игровую
      позицию/геометрию не менять вместе с декоративным SVG.
- [ ] `WorldContentWorkspace.tsx`, `sidebar/CharacterMediaGallery.tsx`:
      reorder и pagination.
- [ ] `renderers/TokenConditionMenu.tsx`, `Orthographic2DRenderer.tsx`:
      selected condition/layer и zoom. Выбранность остаётся семантической.
- [ ] `sidebar/InitiativePanel.tsx`: pin, reorder, roll, remove. Только
      сохранённый исходник; не возвращать скрытый боевой функционал в продукт.
- [ ] Остаточные потребители `@gravity-ui/icons`: `GravityFoundationPreview`,
      `ImageUploadField`, `SelectionActions`; официальный SVG другого пака —
      отдельная миграция, не Unicode. Не удалять пакет до последнего потребителя.
- [ ] Расширить scoped guard на завершённые области, затем полный повторный
      source inventory и bundle check на отсутствие полного каталога/CDN.
- [ ] Общий hosted quality + negative/restored + browser GM/PLAYER,
      desktop/compact, keyboard, темы/контраст. Не заменять это source review.

Примеры исключений: slash-команда `/`, loading ellipsis, буквальные клавиши
стрелок в справке, relation arrow в содержимом, initials/counts, CSS empty
content и counter(). Если значок совмещает статус и действие, сохранить
доступный текст и сверить с поведением; это не повод менять продуктовый flow.

Публикация ветки/PR и production — отдельные разрешения и gates. Текущее
состояние UIX-645 не даёт разрешения выкладывать весь дизайн на production.
