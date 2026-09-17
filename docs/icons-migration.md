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
