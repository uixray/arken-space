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

## Текущая сводка приёмки — 2026-09-17

Исторические «browser не выполнен» ниже **не означают отсутствие новых
проверок**: они сохранены как исходная карта. Для продолжения сначала используйте
эту сводку и подробные receipts в датированных разделах, не повторяйте миграцию.
Итоговые отчёты прочитаны заново; исключения и составные receipts явно указаны ниже.
Это разные проверенные ревизии, **не единый прогон всего продукта на HEAD**.
Не складывайте количество случаев: connected gallery gate включает повтор
проверок листания. Ни один scoped PASS не закрывает всю строку исходных AC.

| Область             | Последняя адресная проверка                                            | Подтверждено                                                                                           | Не доказано этой проверкой                            |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Поля характеристик  | character-stat-controls/enabled-hit-results.json, 8                    | Имена полей/действий, размеры, отмена диалогов и возврат фокуса                                        | Сохранение на сервере, все темы                       |
| Ресурсы             | resource-counter-icons/final-results.json, 8                           | Граничные disabled, SVG, Tab, compact                                                                  | Изменение значений/сервер, read-only персонаж         |
| Список персонажей   | character-rail-icons/fixed-results.json, 8                             | Узкая колонка без переполнения, имена, переключение                                                    | Архивация/восстановление данных                       |
| Просмотр галереи    | character-gallery-navigation/fixed-results.json, 8                     | Повторное Enter/стрелки и возврат фокуса                                                               | Серверный ACL                                         |
| Ожидание галереи    | character-gallery-busy/fixed-results.json, 16                          | Все строки disabled, восстановление после отказа, регрессия просмотра                                  | Атомарная перестановка на сервере/между клиентами     |
| Размеры иллюстраций | character-gallery-fit/fixed-results.json, 8                            | Две пропорции, длинная подпись, доступность навигации                                                  | Все кодеки/высоты viewport                            |
| Приватные броски    | quick-roll-privacy-icons/baseline-results.json, 8                      | Общее состояние и предупреждение, keyboard disclosure                                                  | Доставка броска/права получателей                     |
| Галерея мира        | world-media-controls/fixed-results.json, 4                             | GM desktop/compact, 44px, SVG, подписи                                                                 | PLAYER editor не существует; мутации не проверены     |
| Статусы участников  | participant-status-icons/fixed-results.json, 4                         | Socket-fixture состояния, нецветовые различия, фокус                                                   | Реальная доставка presence с сервера                  |
| Метки мира          | world-marker-edges: fixed + remaining, 40 уникальных случаев (16 + 24) | Центр, четыре угла и рядом с ними; короткое/длинное имя, resize 1280↔360, SVG, выбор и описание группы | PLAYER/browser, все пропорции карт, полная AT-приёмка |

| Режимы панели карты | map-tool-icon-states/combined-evidence.json, 8 (5 + 3) | GM/PLAYER 1280/360, expanded/collapsed, точные имена/разные SVG, один активный режим, 44px compact, selected normal/hover ≥12.05:1, Tab, GM details/Escape | Рисование/туман на canvas, серверные мутации, все темы, физический touch |

| Чат: отправка/стикеры/фильтр | chat-icon-states/ordered-results.json, 8; client-settled, 2 дополнительных | GM/PLAYER1280/360, exact names/SVG/Tab, 44px, normal/hover, hidden-filter badge; сохранение нового черновика | Серверная доставка, reject/restore, другие ветки композера, все темы |

| Музыка и перерыв | music-pause-icons/reviewed-results.json, 4 | Desktop GM/PLAYER play/pause/volume/menu, visible SVG/normal-hover-focus, роли; compact44px pause/pending, закрытие скрытого music popup | Реальное аудио/server ACL, compact MusicBar намеренно скрыт P1, все темы |

Корень receipts:
`C:\Users\UIXRay\.codex\visualizations\2026\09\16\01a0a7d5-b072-7022-8e9d-4538c0a92b07`.
Точные SHA/runtime и changed-files находятся в checkpoint/manifest каждой папки.

**Исходные общие gates остаются открыты:** визуальные состояния всех остальных
контролов, все поддерживаемые темы и контраст, полная runtime-сверка inventory,
проверка итогового кандидата без CDN/полного каталога и интеграционный gate.
Shell contrast/keyboard/disabled имеют собственные более ранние receipts ниже,
не распространяющиеся автоматически на эти новые области. PLAYER/GM ограничения
не обходить ради одинаковой матрицы. Ручная/физическая приёмка не заменяется
синтетическими сессиями. UIX-645 остаётся In Progress; Linear не изменён.

На текущем source дополнительно прошли28 проверок icon-policy/source-closure,
включая отрицательные примеры. Они доказывают заявленный статический контракт,
но не отсутствие всех визуальных дефектов и не runtime-код внешних библиотек.

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

## 2026-09-16 — current bundle gate

Production-mode web build for `508167fed063242241a8a5e40a6169a9fb87c74d` passed (Vite 8.2.1, heap cap 768 MiB). Source maps contain 47 distinct Lucide icon modules (45 main + 2 renderer) and no dynamic icon registry; the retained full package is not shipped wholesale. HTML points to local asset files. This does not substitute for a complete runtime network audit.

The existing eight shell icon cases also passed against this built output in Chrome/Firefox × GM/PLAYER × 1280/390px, rather than just the development server. This is synthetic session data and default dark theme only. Source maps and payload hashes are retained in the local bundle-gate receipt. No deploy or CI rerun occurred. Typecheck evidence remains the prior current application-source check; no claim of a new full test-suite pass.

Personal-theme configuration exists separately; main.tsx currently mounts a fixed dark Gravity ThemeProvider and does not import the player-theme styles. Therefore this gate cannot prove personal-theme UI acceptance. Keep UIX-317 and the remaining UIX-645 focus/menu/contrast criteria open.

## 2026-09-17 — shell keyboard acceptance

Extended `tests/e2e/icon-shell-contract.spec.ts` against application source
`22d3af88bdb304a4887f094c3cf818fd515e3e33`: Chrome/Firefox × GM/PLAYER ×
1280/390px, eight cases passed. All initially visible enabled Lucide controls
are reached by real Tab navigation or ArrowRight in the three-option roll-mode
radio group. Each reached control has `:focus-visible` and a nontransparent
outline or box shadow; SVGs do not receive keyboard focus. Existing accessible
name, decorative SVG, currentColor, stroke and minimum 24px hit-area checks
remain in place. No HTTP writes or uncaught page errors occurred.

The first harness iteration incorrectly required a DOM focus target while Tab
crossed browser chrome; the second incorrectly required every radio option in
the Tab sequence. Both were corrected to test actual browser and radio-group
behavior, without changing product code. E2E typecheck and scoped lint passed.
The compact GM screenshot was inspected: the zoom-minus focus outline is
visible; the narrow map remains crowded by its tool panels. This is not compact
layout acceptance, quantitative contrast proof, physical-device testing, or
coverage of unopened menus/dialogs, every disabled state, or personal themes.
Those original criteria remain open; no deployment or full CI rerun occurred.

## 2026-09-17 — selected token-menu contrast repair

Extended the existing token-menu keyboard scenario rather than duplicating its
fixture. Chrome/Firefox at 1280/390px: four cases passed, including condition
toggle, selected layer, decorative SVG semantics, 24px control bounds and
computed foreground/background contrast in normal and hover states.

The original accent measured 4.446:1: enough for the mark alone, not the
normal-size label sharing its color. The lighter accent candidate still failed
on hover (4.207:1). Selected labels and marks now use the existing primary-text
token with semibold weight; checked semantics and the Lucide check remain.
Final contrast is 12.865:1 normally and 10.094:1 on hover for both controls in
both browsers. No new palette value or global token change was introduced.

Measurement composites transparent backgrounds to the nearest opaque backing,
ignoring obscured map imagery; it rejects unsupported colors, exposed background
images and ancestor group opacity rather than asserting a false pass. This is
computed-color evidence, not pixel/antialiasing or all-theme certification.
The compact Chromium menu screenshot was visually inspected. E2E typecheck,
scoped lint, formatting and diff checks passed. Original keyboard actions and
focus-return assertions remain; condition writes go to a synthetic mocked API,
not a live campaign. No production or Linear status change.

## 2026-09-17 — settled shell icon contrast

At runtime `fd64ef2` (retained world-consumer-live/dist, four served hashes
verified), the strengthened shell gate passes Chrome/Firefox × GM/PLAYER ×
1280/390: eight application cases plus two contrast-oracle cases, **10/10 PASS
in 88.11s**, one worker, retries0/skipped0/flaky0. It measures every visible SVG
in each sampled enabled button/summary, after pointer-leave/hover transitions
settle, and asserts the actual hover state. 168 per-case icon measurements:
minimum computed normal contrast **6.00:1**, hover **5.21:1** (required3:1).
Existing name/decorative SVG/stroke/min24px/keyboard focus checks remain.

The measurement composites plain RGBA ancestor surfaces and the verified Gravity
flat-button inset ::before backing, including its own transition. It rejects
unknown painted pseudos, overlapping media surfaces, image backgrounds,
filter/blend/mask/group-opacity and SVG descendant paint overrides. Gravity
support requires identity transform stacking context, inset0/z-1, no border or
effects and icon bounds fully in the unclipped central band. A synthetic browser
oracle verifies black/white21:1 and settled half-black backing5.2808:1, then
negative descendant stroke, group opacity, gradient and canvas cases.

The initial8/8 run used an incomplete oracle (unsettled transitions/pseudo
background omission) and is **not final acceptance evidence**. Independent review
found those false-positive paths; stricter single-case diagnostics exposed the
real Gravity pseudo backing and conservative geometry assumption. The final
measurement supports that actual paint contract rather than skipping controls.
All diagnostic reports are retained in shell-icon-contrast. No product palette,
components, runtime or dependency changed; no new build was needed.

GM390 screenshot visually inspected: sampled SVG/focus outline visible; compact
canvas remains crowded by tools. This is computed-color evidence, not sampled
antialiased pixel contrast or full compact-layout acceptance. Inactive controls
are explicitly recorded but not assigned a passing contrast score. Only current
dark shell, initially visible sampled controls, no whole menu/dialog/theme
matrix or all disabled/loading visual certification. Personal theme integration
and UIX-645 remain open. Types/lint/format/diff PASS; protected selection test
untouched, owned preview stopped. No full suite, CI rerun, push/deploy or Linear
mutation.

## 2026-09-17 — disabled shell icons and radio focus timing

Actual shell gate now covers native disabled SVG buttons as well as enabled
controls: GM/PLAYER ×1280/390 ×Chrome/Firefox, **8/8 PASS90.804s** on the new
local build. Across cases,20 disabled samples (play, undo, redo) retain their
normal button/SVG/pseudo-background paint on hover, remain disabled/unfocused
after a real center pointer click, and have unobscured hit areas. Recorded
opacity0.45 in every sample. No contrast minimum is invented for inactive UI.
Existing168 enabled normal/hover contrast samples, names/decorative SVG/stroke,
minimum24px and actual Tab/radio-arrow focus checks remain; no API/client-log
writes or page errors. DesktopGM screenshot inspected: inactive play/history
icons are visibly subdued relative to enabled tools. This is not all disabled,
loading, workspace/menu or personal-theme visual acceptance.

The initial mixed pointer/keyboard harness exposed a sequential-focus-start
assumption: disabled pointer clicks can move the browser's Tab starting point
without focusing the button. The independent keyboard phase now starts at the
page skip link, then traverses by actual Tab/arrow keys, never focusing each
sample. A second run exposed a real product race: RollModeControl queued focus
with requestAnimationFrame after an arrow selection. That callback could steal
focus after the next Tab. All three radio buttons already exist with stable
refs, so focus now moves synchronously in the key handler, without flushSync or
changes to roll values/permissions. Seven new DOM regressions fail on old code
and pass after the fix (plus two existing mapping tests:9/9PASS). They cover all
arrow/Home/End keys and an outside focus handoff before a queued frame.

Independent read-only review confirmed the ref/controlled-state assumptions.
Web/E2E types, scoped lint/format/diff pass. One build2.94s, four served payload
hashes verified. Evidence: disabled-shell-icons/{fixed-results.json,receipts.json,
red-unit.log,unit.log,manifest.json,checkpoint.md}. Earlier failures are retained,
not counted as acceptance. Local only; no full suite, CI rerun, publication or
Linear write. UIX-645 retains the remaining original cross-product/theme gates.

## 2026-09-17 — characteristic field labels and action controls

The actual character card exposed a label bug: a characteristic input inherited
the names of every adjacent roll/reorder/rename/delete button because the entire
row was a label. Each field now has a unique useId-based input id and a dedicated
caption label; actions remain outside that label. Layout, values, persistence and
permissions are unchanged. The browser assertion failed on the old runtime.

Targeted component tests:19/19 PASS, including exact input names, caption-click
focus and unique ids across two cards. Actual-App fixture browser checks:
8/8 PASS28.529s, Chrome/Firefox × GM/PLAYER ×1280/360. Named action buttons,
decorative SVG, currentColor and minimum24px desktop/44px compact checked;
center hit checks apply only to enabled buttons (Gravity disabled buttons do not
receive pointer events). GM rename/delete dialogs cancel with Escape and return
focus; PLAYER layout-edit actions absent. No unexpected API/client-log writes
or page errors. Desktop and compact screenshots inspected. No actual mutations,
server persistence, physical-device or all-theme acceptance claimed.

One build1.71s and four served payload hashes verified; web/E2E types and scoped
lint/format/diff pass. Evidence: character-stat-controls/{label-contract-results.json,
enabled-hit-results.json,unit.log,manifest.json,checkpoint.md}. Initial harness
failures are retained, not acceptance evidence. Protected selection test unchanged;
preview stopped. Local only, no full suite, CI rerun, publication or Linear write.

## 2026-09-17 — resource counter controls

Existing built application38e859c, no rebuild/product changes: actual-App
fixture gate8/8 PASS26.4s, Chrome/Firefox × GM/PLAYER ×1280/360. Empty mana
disables spending while full endurance disables adding/restoration; non-boundary
actions remain enabled. All six buttons have accessible names, minimum24px
desktop/44px compact bounds and remain in the viewport. Enabled centers are
unobscured. Exactly four decorative nonfocusable currentColor SVGs required;
regen amounts remain mathematical text, not substituted icons.

Real Tab traversal from the resource summary reaches each enabled button/input
in DOM order with focus-visible; Enter collapses/reopens the section. No edits,
spending, HTTP/client-log writes or page errors. Compact GM screenshot inspected:
labels, values, maximums and dimmed boundary actions are readable and aligned.
This is not mutation/persistence, read-only character, all-theme contrast or
physical-device acceptance. Existing resource intent tests remain separate.

Evidence: resource-counter-icons/{final-results.json,payload-checks.json,
checkpoint.md}. E2E types, scoped lint/format/diff PASS; protected selection test
unchanged. No full suite, CI rerun, publication or Linear write.

## 2026-09-17 — collapsed character rail overflow repair

Actual desktop GM rail reproduced horizontal overflow: client55px, scroll107px.
Archive-list and per-character archive text had not followed the existing narrow
rail treatment; initial buttons also retained unnecessary horizontal padding.
Collapsed archive actions now use the existing Lucide Archive icon, while their
accessible text remains intact. Expanded text/actions and compact hidden-rail
behavior are preserved. No changes to archive requests, permissions or data.

New actual-App fixture gate8/8 PASS26.0s: Chrome/Firefox GM/PLAYER1280/360.
Keyboard collapse/expand retains trigger focus; desktop rail has no horizontal
overflow and visible buttons have names/minimum24px bounds; compact rail hides
and restores; GM-only actions absent for PLAYER. No HTTP/client-log writes or
page errors. Desktop GM screenshot inspected: centered initial, visible add and
archive icons fit the narrow rail. Initial locator-name failure was a harness
error, not the product reproduction; geometry-red is the actual failing gate.

One build1.70s, four served payload hashes checked. Web/E2E types, scoped
lint/format/diff PASS. Evidence: character-rail-icons/{geometry-red-results.json,
fixed-results.json,manifest.json,checkpoint.md}. This is not archive mutation,
all-theme contrast or full character-workspace acceptance. No publication.

## 2026-09-17 — gallery paging keyboard focus repair

Actual-App old-runtime regression: Enter on Next changed the image but moved
focus from the button to the viewer container, preventing repeated Enter paging.
Viewer entry focus now runs on mount only, not on every item change. Image-error
reset still tracks item/source independently; close/remount retains entry behavior.
No changes to image permissions, URLs, ordering, persistence or dialog ownership.

New browser gate8/8 PASS27.0s: Chrome/Firefox GM/PLAYER1280/360, two-entry fixture.
Repeated Enter wraps images while preserving the Next button focus; ArrowRight
also preserves focus; Escape closes and returns to the original thumbnail.
Both navigation SVGs are decorative/nonfocusable, button bounds meet24px desktop
and44px compact. No HTTP/client-log writes or page errors. Compact screenshot
inspected: both controls fit and Next has a visible focus outline. The fixture
uses a1px PNG; this proves control behavior, not realistic image-fit acceptance.

Existing gallery removal/component regressions11/11 PASS3.86s. Web/E2E types,
scoped lint/format/diff PASS. One build1.67s/four served hashes verified. Evidence:
character-gallery-navigation/{red-results.json,fixed-results.json,manifest.json,
checkpoint.md}. Protected selection test unchanged; no full suite/CI/publication.

## 2026-09-17 — live participant status presentation

GM preparation shows both connected and disconnected players; its misleading
heading "Игроки онлайн" now reads "Игроки". No change to membership filtering,
presence protocol, permissions or rename behavior.

Actual-App4/4 PASS15.8s Chrome/Firefox1280/360: mocked socket presence events
switch offline→online→offline, accessible names follow status and icon shapes
differ, SVG stays decorative/nonfocusable/currentColor. Focus survives updates;
Enter opens rename and Escape returns to the same member. Minimum24/44px bounds
and corrected heading checked. No writes/client-log or page errors. Baseline
compact screenshot revealed the heading mismatch while otherwise passing the
status flow. This is UI subscription evidence, not live-server presence delivery.

One build1.69s/four served hashes; web/E2E types, scoped lint/format/diff PASS.
Evidence: participant-status-icons/{baseline-results.json,fixed-results.json,
manifest.json,checkpoint.md}. Protected selection test unchanged; no publication.

## 2026-09-17 — party marker no longer covers location text

Baseline browser controls passed, but the compact screenshot exposed a visual
failure: party-position SVG overlaid the location caption at the same coordinates.
The badge now sits inside the location button beside its icon/caption, sharing
the unchanged normalized map anchor. It remains a named image with decorative
inner SVG; no map data, party position or selection behavior changes.

Final4/4 PASS16.4s Chrome/Firefox GM1280/360: no badge/caption intersection,
distinct decorative currentColor SVGs, minimum24/44 bounds, center hit (including
the badge area), keyboard selection/pressed state/focus and visible detail.
No writes/page errors. Corrected compact screenshot inspected; caption readable.
Existing5 component tests PASS2.83s, including original coordinate assertion on
the shared location anchor and named GM/PLAYER component presentation. PLAYER
product navigation remains intentionally unavailable, not enabled by this change.

The first fixed harness still counted nested SVGs as direct location icons;
direct-child selectors correct that without weakening each icon contract. Old
independent-coordinate unit expectation replaced by shared-anchor containment.
One build1.65s/four served hashes, web/E2E types/lint/format/diff PASS. Evidence:
world-map-markers/{baseline-results.json,direct-icons-results.json,checkpoint.md}.
Not all map-edge/long-label/theme/contrast acceptance; no full suite/CI/publication.

## 2026-09-17 — party description and evidence consolidation

Independent read-only Sol review found the nested named party image did not
guarantee an announcement when focusing its explicitly named location button.
Two new GM/PLAYER component assertions were RED: accessible description empty.
The current location now describes itself through a stable useId reference to
the badge's actual visually-hidden text. Other locations have no description;
location names/coordinates and decorative SVGs are unchanged. Referencing only
the badge aria-label was insufficient in the DOM description algorithm; that
intermediate attempt failed and was replaced with real text, not a weaker test.

Final33/33 targeted component/source-policy/closure tests PASS3.07s; browser4/4
PASS15.1s Chrome/Firefox GM1280/360 asserts the computed description alongside
existing nonoverlap, SVG, hit and keyboard selection checks. One build1.77s/four
served hashes; web/E2E types/lint/format/diff PASS. Actual screen-reader device
acceptance remains distinct. Evidence: world-marker-description/{fixed-results.json,
manifest.json,checkpoint.md}. Top-level coverage index reconciles ten earlier
reports with their scope/limits rather than claiming one all-green HEAD run.

## 2026-09-17 — long world-map labels

Extended the same marker gate with short/long location names. Old compact runtime
failed: label right438.36px while marker right239.5px; clipping the outer button
did not create the intended text ellipsis. A dedicated label span now shrinks
within the flex row and ellipsizes independently of the icons. Full location name
remains in accessible name, detail/list and new title; normalized anchor unchanged.

Browser8/8 PASS26.7s Chrome/Firefox GM1280/360 × short/long names. Location/party
SVGs remain16/24px; label box stays inside the marker, party/caption do not overlap,
description/focus/selection/hit checks retained. Compact long-name screenshot
inspected: visible ellipsis and full name below. No writes/page errors. Map edges
remain a separate unchecked axis. One build1.65s/four hashes; web/E2E types and
scoped lint/format/diff PASS. Evidence: world-marker-long-label/{red-results.json,
fixed-results.json,manifest.json,checkpoint.md}. No full suite/CI/publication.

## 2026-09-17 — shared quick-roll privacy visual gate

Reused50290e5 built runtime; no product changes/rebuild. Actual-App fixture
8/8 PASS26.0s, Chrome/Firefox GM/PLAYER1280/360: Space toggles the map dice
privacy button with pressed state/focus intact; decorative currentColor SVG and
minimum24/44px bounds verified. Quick-roll panel displays the matching private
warning. Keyboard collapse hides buttons/warning; reopening restores warning
and trigger focus. On compact screens, map/journal navigation preserves privacy;
switching back to public removes the warning without hiding characteristic rolls.
No HTTP/client-log writes or page errors. PLAYER360 screenshot inspected: private
warning and disclosure focus outline visible without overlapping roll buttons.

This is shared UI-state evidence, not a roll submission, recipient ACL or reload
persistence test. Original gameplay/privacy tests remain independent. E2E types,
scoped lint/format/diff PASS. Four served payload hashes checked; preview stopped.
Evidence: quick-roll-privacy-icons/{baseline-results.json,payload-checks.json,
checkpoint.md}. No full suite/CI/publication; all-theme acceptance remains open.

## 2026-09-17 — gallery reorder busy-state repair

Two new component regressions failed on old code: another row's reorder button
remained enabled during the two-write swap; an old character's failed reorder
appeared in the newly opened gallery. Row reorder/edit actions now lock across
the gallery until the operation settles. A synchronous operation ref prevents
overlap with another reorder/removal and scopes updates/error/finally to the
initiating gallery instance. An accepted swap continues its existing two requests
after navigation, but cannot paint results or unlock a different operation.
No server transaction/ordering API redesign is claimed.

Component13/13 PASS3.80s, including lock through both writes and stale failure
isolation. Connected browser16/16 PASS47.2s: delayed reorder + gallery paging,
Chrome/Firefox GM/PLAYER1280/360. All row actions disabled while response waits;
explicit fixture503 restores editing/reorder with a visible error and only one
request. Existing repeated paging/focus regression passes. No unexpected writes,
client logs or page errors. Compact GM busy screenshot inspected. This fixture
does not prove successful server persistence or multi-client atomic ordering.

One build1.67s/four served hashes; web/E2E types, scoped lint/format/diff PASS.
Evidence: character-gallery-busy/{fixed-results.json,manifest.json,checkpoint.md}.
Protected selection test unchanged; no full suite/CI rerun/publication.

## 2026-09-17 — full-size gallery image/caption fit

New large-image fixture exposed horizontal overflow in the viewer: a valid
long unbroken caption produced scroll964px inside client656px on desktop.
Caption now has max-width100% and overflow-wrap:anywhere, matching the existing
thumbnail metadata wrapping rule. Text is preserved rather than truncated.

Browser8/8 PASS29.8s: Chrome/Firefox GM/PLAYER1280/360, rendered1600x900 landscape
and900x1600 portrait SVG fixtures, decoded image present, long caption, viewer
and dialog within horizontal viewport, no viewer horizontal overflow. Next
button is center-hittable after scrolling into view; Escape restores thumbnail
focus. No writes/client-log errors/page errors. Both compact screenshots viewed:
whole bordered images and navigation fit; long caption wraps. This covers fixed
dimension visual fixtures, not user-upload codecs or all viewport heights/themes.

One build1.62s/four served hashes. E2E types and scoped lint/format/diff PASS.
Evidence: character-gallery-fit/{red-results.json,fixed-results.json,manifest.json,
checkpoint.md}. CSS-only product change; no repeated full unit suite/CI/deploy.

## 2026-09-17 — world editor gallery touch controls

Old-runtime actual-App gate passed desktop but failed compact: reorder button
width32px instead of44px. World media action buttons now have minimum44px bounds
under1024px and their row may wrap instead of overflowing a narrow grid column.
No changes to media order, permissions, requests or the world reader.

Browser4/4 PASS17.7s: GM editor only, Chrome/Firefox1280/360. Both image entries,
long caption without horizontal grid overflow, first/last disabled reorder
boundaries, names, four decorative nonfocusable currentColor SVGs, button bounds
and enabled center hit areas verified. No writes/client-log or page errors.
Compact screenshot inspected: labels wrap and touch controls fit. PLAYER editor
access is intentionally absent; this does not invent a player route or establish
full mobile GM/editor acceptance. No mutation/keyboard reorder proof claimed.

One build1.74s/four served hashes; E2E types, scoped lint/format/diff PASS. Evidence:
world-media-controls/{baseline-results.json,fixed-results.json,manifest.json,
checkpoint.md}. Protected selection test unchanged; no full suite/CI/publication.

## 2026-09-17 — метки у границ карты

На базе `9853777` подтверждено обрезание метки при x=y=0: левый край
-34.10px вместо допустимых 12px. Визуальный сдвиг теперь ограничен рамкой
карты; сохранённые x/y, процентные left/top и игровые данные не меняются.
Один ResizeObserver на canvas обновляет два размера без React state и без
наблюдателя на каждую метку. Подпись занимает доступное место, иконки не сжимаются.

Receipt `world-marker-edges`: один build, четыре проверенных runtime-хеша.
Браузерная матрица 40 уникальных случаев — Chrome/Firefox, GM, 1280/360,
центр и восемь edge/near-edge координат. Edge-сценарии также меняют ширину
уже открытой карты; сохраняются hit-area, именованные SVG, доступное описание
группы, keyboard selection и отсутствие pageerror/неожиданных записей.
`fixed-results.json`: 16 PASS, затем ошибка тестовой точности SVG
16.000001907px вместо ровно 16; это не изменение фактического размера.
После сравнения с точностью 0.005px выполнены **только оставшиеся 24**, все PASS
в `remaining-results.json`, без пересборки и повторения первых 16.
Шесть компонентных тестов PASS, включая один observer при выборе, resize,
нулевой размер скрытой карты и disconnect при закрытии. Типы web/E2E, lint,
format и diff проверены. Просмотрены compact-скриншоты короткой/длинной метки.

Границы: это не приёмка PLAYER, всех тем, всех пропорций изображения,
физических устройств или screen reader. Карта ниже высоты самой кнопки
математически не может вместить её; экстремальные пропорции этим пулом не
проверены. Исходная UIX-645 остаётся In Progress; публикации нет.

## 2026-09-17 — связанная приёмка режимов панели карты

Runtime `2fbf179d0fec99425a1f322410d0e2b6c61bf15b`, повторно использован
`world-marker-edges/dist`; четыре served SHA256 совпали, новой сборки нет.
`tests/e2e/map-tool-icon-states.spec.ts`: Chrome/Firefox × GM/PLAYER ×1280/360,
оба состояния панели в каждой сессии. Exact inventory: десять режимов GM,
четыре PLAYER; имена и glyphs различны. После Enter ровно один режим selected.
Иконки direct SVG decorative/nonfocusable/currentColor/stroke2; кнопки и
GM summary/collapse ≥24px desktop и ≥44px compact, центр доступен указателю.
Все enabled icon controls панели достижимы настоящим Tab с focus-visible и
видимым indicator. Grid/Resize/More GM раскрываются Enter, закрываются Escape
с сохранением фокуса; у PLAYER этих элементов нет в DOM.

112 selected-icon samples в expanded/collapsed: normal и hover ≥12.054:1 при
пороге3:1. Hover-state проверяется после завершения переходов существующим
paint oracle; это computed contrast, не pixel/AT-сертификация. Горизонтального
page overflow и неожиданных API writes/pageerror нет. Compact GM screenshot
просмотрен: панель прокручивается; раскрытые подписи занимают часть карты,
что не объявляется полноценной mobile-layout приёмкой.

Составное evidence: `reviewed-results.json` — пять PASS, остановка на
43.999992px Firefox вместо44; после точности0.001px выполнены только оставшиеся
три в `remaining-results.json`, все PASS. `combined-evidence.json` содержит
только восемь уникальных прошедших случаев и их измерения. Ранние diagnostic
runs не используются для полной приёмки: mode selector включал Undo/Redo;
программный focus после pointer input ошибочно считался keyboard focus-visible.
Независимый review усилил exact-name, exclusive-selected и summary/collapse
assertions до итогового запуска. E2E types/lint/format PASS.

Source maps того же кандидата: 47 уникальных Lucide icon modules (45main+2renderer),
нет dynamic registry в Lucide sources, HTML с локальными JS/CSS. Полный сохранённый
npm-пакет не импортируется целиком. Это не полная runtime network-проверка.
`main.tsx` всё ещё фиксирует dark ThemeProvider, player-theme styles не подключены;
персональные темы не объявляются проверенными. Рисование/изменение тумана,
history mutations, music/chat и полная исходная UIX-645 остаются отдельно.
Приложение не менялось; новый scoped regression test/docs сохранены локально.

## 2026-09-17 — иконки и состояния композера событий

На неизменном runtime `2fbf179` (`world-marker-edges/dist`, четыре served SHA256)
добавлен `tests/e2e/chat-icon-states.spec.ts`. Восемь случаев Chrome/Firefox ×
GM/PLAYER ×1280/360 прошли за44.9s: `chat-icon-states/ordered-results.json`,
unexpected/skipped/flaky=0. Это реальный ActivityPanel с синтетическими API и
WebSocket; других веток чата и реальной доставки сообщений проверка не доказывает.

Отправка, Стикеры и summary фильтра имеют точные доступные имена, три разных
Lucide SVG с декоративным currentColor/stroke2 contract. Область ≥24px desktop,
≥44px compact, центр доступен указателю. Настоящий Tab от вкладки событий
достигает всех трёх с focus-visible и видимым indicator.40 samples normal/hover:
минимумы6.6456:1 и7.3743:1 при пороге3:1. Это computed-color, не pixel/AT audit.
После отключения «Броски» summary сообщает «Скрыто: Броски», badge показывает1;
иконка и hit-area сохранены. Sticker показывается только при пустом вводе;
короткая Enter/Escape-проверка не заменяет прежний полный lifecycle receipt.

Пустая отправка валидируется локально, без POST. После отправки введённого текста
черновик очищается, стикеры возвращаются; во время отложенного ответа Send остаётся
**enabled по действующему контракту**, можно набирать новый черновик. Не вводился
искусственный disabled. Зафиксирован один разрешённый synthetic POST PUBLIC/TABLE,
без неожиданных записей/pageerror. После усиления ожидания fetch completion и двух
animation frames выполнены только два дополнительных GM360 Chrome/Firefox —
`client-settled-results.json`,2PASS14.8s; новый текст сохранён после ответа.
Не складывать8+2 как десять уникальных случаев. Rejection/restore отдельно.

Диагностический Firefox FAIL был вызван маршрутом, начинавшимся после фильтра
и ожидавшим циклический обход через browser chrome. Сохранён focus-trail:
после последней Send document traversal не возвращался к фильтру. Итоговый
тест входит из предыдущей вкладки и проверяет естественный прямой Tab-путь.
Один промежуточный probe ошибочно повторил старую точку входа из-за неприменившейся
текстовой замены; это не evidence исправления приложения.

E2E types/lint/format PASS. Compact PLAYER Firefox screenshot просмотрен.
Существующий mobile CSS уже обеспечивает44px; source-only предположение о30px
опровергнуто фактическим каскадом и browser geometry. Приложение не менялось,
пересборки/fullsuite/CI/push/deploy нет. UIX-645 и UIX-624 остаются открытыми;
следующий связанный scope — музыка/пауза, не повтор этого композера.

## 2026-09-17 — музыка и перерыв: разные действия и роли

`tests/e2e/music-pause-icons.spec.ts`, receipt `music-pause-icons/reviewed-results.json`:
четыре случая Chrome/Firefox × GM/PLAYER,21.4s, unexpected/skipped/flaky=0.
Неизменный runtime2fbf179 / world-marker-edges/dist,4served hashes; без сборки.
На1280px проверены visible decorative Lucide SVG, exact имена, stroke2/currentColor,
≥24px, center-hit, settled normal/hover и keyboard focus-visible/indicator/contrast≥3:1.
Helper сначала снимает прежний focus, чтобы normal/hover не подменялись focused paint.

До выбора трека «Играть» disabled для обеих ролей. После synthetic audio state
GM управляет ровно PLAY→PAUSE с разными glyph/именами; PLAYER остаётся disabled,
хотя shared playing-state меняет glyph/name. GM видит меню/трек, у PLAYER меню
отсутствует. Личная громкость у обеих ролей меняется клавиатурой и сохраняет0.05
в localStorage, без изменения общего звукового состояния. Popup закрывается
Escape с возвратом фокуса. Desktop GM Firefox screenshot просмотрен.

На resize360 MusicBar **намеренно скрыт контрактом P1**, открытый volume details
закрывается, focus не остаётся в скрытом контроле. Это не PASS доступности
управления музыкой на телефоне. Не добавлялись новая навигация, второй аудиоплеер
или выход за утверждённый P1. Исходный контракт: uix-624-mobile-foundation.md§2.

На360 у GM явно свёрнута панель: visible Pause glyph и скрытая текстовая подпись,
кнопка≥44px с normal/hover/focus. Во время единственного deferred synthetic POST
перерыва кнопка disabled. Проверены count/body/revision/actionId, после bootstrap
виден overlay и «Продолжить игру». PLAYER не имеет Start/Continue, получает только
snapshot перерыва. Compact GM Firefox screenshot просмотрен; page overflow нет.
Неожиданных API writes/pageerror нет. Resume и серверная авторизация не проверялись.

Независимый review устранил слабости первой4PASS-проверки (невидимый SVG мог пройти,
не было focus-paint и desktop image, pause POST учитывался boolean вместо count/body).
Для приёмки использовать reviewed, не складывать с baseline. E2Etypes/lint/format PASS.
Валидный silent WAV служит только metadata; consent выключен, реальный playback
**не заявляется**. Приложение не менялось, fullsuite/CI/push/deploy не запускались.
UIX-645 остаётся открытой по общим gates и оставшимся потребителям/темам.

## 2026-09-17 — масштаб в настоящем редакторе токена

Расширен существующий `token-upload-source-selection.spec.ts`, без отдельного
демо и изменения приложения. `token-zoom-icons/initial-results.json`: два случая
Chrome/Firefox,28.2s, unexpected/skipped/flaky=0. Каждый проходит1280 и360px на
неизменном runtime2fbf179; четыре served hashes проверены, новой сборки нет.

Для «Уменьшить масштаб» и «Увеличить масштаб» проверены точные доступные имена,
два разных видимых decorative Lucide SVG/currentColor/stroke2, hit-area≥24/44px
и доступность центра. Normal/hover/focus computed contrast≥3:1, настоящий
ShiftTab/Tab возвращает focus-visible с indicator. Enter меняет1→1.1 и8→7.9;
на1 недоступен минус, на8 плюс. При отложенной загрузке другого исходника обе
кнопки disabled; после принятия нового изображения масштаб1, плюс снова enabled.
Продолжение прежнего сценария сохраняет именно полученный TOKEN и не добавляет
неожиданных записей/pageerror. Compact Firefox screenshot просмотрен.

Это GM-сценарий с synthetic transport, не серверная генерация/persistence,
физический телефон, OS file picker или все темы. Перед выбором источника
генератор отсутствует: не приписывать ему проверку несуществующих disabled-кнопок.
Удаление файла из черновика этим расширением не проверено. E2Etypes/lint/format
и diff-check PASS; protected selection recovery test сохранён без изменений.
UIX-645 повторно прочитана, остаётся In Progress по исходным критериям.

## 2026-09-17 — удаление файла из черновика: фокус, контраст, touch

У `ImageUploadField` и `AudioUploadField` подтверждена потеря фокуса после
удаления: два unit RED получали body вместо picker; старый runtime2fbf179
также провалил новый assert в настоящем диалоге замены изображения.
Оба поля теперь синхронно фокусируют постоянную кнопку выбора перед удалением
preview, без timeout/rAF. Последующий Tab не перехватывается.

В том же сценарии выявлены ещё два дефекта общей корзины: hover contrast2.205:1
и compact hit-area40px. Scoped CSS сохраняет danger в обычном состоянии, использует
семантический primary foreground на hover и обеспечивает≥44px без flex shrink
на compact/coarse pointer. Другие кнопки/общая палитра не менялись.

Receipt `upload-remove-focus/touch-fixed-results.json`:4PASS39.5s,
Chrome/Firefox ×1280/360, настоящий GM AssetReplacementDialog, synthetic API.
Видимый декоративный SVG/currentColor/stroke2, exact name, ≥24/44px, center-hit,
normal/hover contrast≥3; Enter удаляет только local draft, picker получает
focus-visible, Tab идёт дальше. Повторный выбор, cancel, conflict/review/retry и
обновление изображения продолжают проходить. Compact Firefox screenshot просмотрен.

Связанные unit33PASS; web/E2E types, lint, format и diff-check PASS.
Три сборки соответствовали последовательно найденным product fixes;
финальный runtime `upload-remove-focus/dist-touch`, четыре served hashes в manifest.
Не запускались fullsuite/CI/push/deploy. Vite предупреждает о крупном основном chunk.

Измеритель сначала отказался от неизвестного Lab serialization поверхности.
Добавлено только преобразование **opaque Lab** через browser sRGB canvas (8-bit),
без ослабления запретов на opacity/media/unsupported paint. Сохранён прежний
oracle и добавлены Lab black/white/gray и отрицательные примеры:
`oracle-complete-results.json`4PASS6.8s Chrome/Firefox. Первый Lab-only2PASS не
заменяет полный oracle. Не считать его отдельной приёмкой продукта.

Аудиополе подтверждено unit, но не самостоятельным browser caller; все темы,
реальный сервер и физический телефон не заявляются. UIX-645 не закрыта.
