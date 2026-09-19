# UIX-645 — Lucide foundation checkpoint, 2026-09-06

> **Текущий статус:** реализация и reachable-миграция находятся в main; для
> closure использовать приложение «Сверка исходных критериев — 2026-09-19» в
> конце файла. Исторические unchecked/pending формулировки ниже сохраняют ход
> работы и не являются текущим списком повторной миграции. UIX-645 остаётся
> In Progress: plural player themes не опубликованы и зависят от решения UIX-317.

## Продолжение 2026-09-12 — интеграция main и иконки чата

После отдельного успешного exact-main gate `9393593` интегрирован в прежнее
чистое рабочее дерево без конфликтов, merge `a484e2e`. Проверенные изменения
UIX-624 (native TextArea, scope epochs, pending draft/attachment guards) сохранены.
Только затем фильтр и две send-кнопки ChatPanels заменены на Ellipsis/Send.
`/` — буквальная slash-команда, не псевдоиконка; Direct send остаётся текстом.

Guard/test inventory **28 файлов**, actual-source filter glyph negative fixture.
Никаких handlers, состояний, ARIA-ownership или draft tests ради иконок не меняли.
Существующий Direct pending-draft harness не покрывает эти два send render-path,
поэтому SVG-проверки в него не подмешивали. Browser/quality gate UIX-645 остаётся
невыполненным. Main PASS относится к main, не к новым локальным SVG-пулам.
Далее: финальный glyph/coverage аудит и общий разрешённый hosted/browser gate.
Публикации UIX-645 нет; скрытый Initiative не возвращать.

## Продолжение 2026-09-12 — escaped glyph в выборе стикеров

После `128c87d` текущий source-аудит обнаружил ещё `\u263A` в компактном
StickerPicker: заменён на официальный Sticker, текстовый режим «Стикеры»,
disabled/expanded/haspopup и каталог не менялись. Добавлены два узких DOM-кейса
trigger и negative fixture escaped literal; guard перечисляет **27** файлов.
Runtime не выполнялся. Source inventory не является доказательством полного
отсутствия glyphs; ChatPanels и сохранённый скрытый Initiative ещё учтены отдельно.
UIX-644 lifecycle/Escape/focus/outside/geometry стикеров остаётся самостоятельным
непроверенным scope, замена иконки его не закрывает. Публикации нет.

## Продолжение 2026-09-12 — оставшиеся авторские Gravity SVG

База локального пула `6a2727e`: SelectionActions, ImageUploadField и
GravityFoundationPreview используют AppIcon вместо Gravity Icon/data. Имена
кнопок, handlers, disabled и controlled upload lifecycle сохранены. Пакеты,
lockfile и внутренние иконки UIKit не менялись.

Подготовлены SVG/name проверки в существующих selection/upload DOM-тестах;
upload case проверяет controlled onUpdate(undefined) и снимает временный URL
stub после unmount. Никаких загрузок или пользовательских файлов в тесте.
Guard теперь перечисляет **26 source-файлов**, запрещает прямой импорт прежнего
пака в пройденных областях; negative fixtures используют настоящие исходники.
Проверки только source/diff/inventory, runtime/formatter/types/browser/bundle
не выполнены. Обязательный общий gate всё ещё впереди, UIX-645 не опубликован.
Next: интегрировать проверенную main после её отдельного gate, затем ChatPanels,
финальный реестр оставшихся glyphs и bundle/UI QA. Hidden Initiative не включать.

## Продолжение 2026-09-12 — медиа, карта и выбранность

База `e219729`: WorldContentWorkspace и CharacterMediaGallery переведены на
named reorder/pagination SVG; у world icon-only кнопок появились явные имена,
иначе удаление glyph лишило бы их имени. Relation arrows в содержимом сохранены.
WorldMaps: MapPin для локации, UsersRound 24px для группы, прежние координаты,
roles/labels и pointer policy. CSS accent selector теперь адресует SVG, тень
группы поддержана SVG drop-shadow без новых анимаций или assets.
TokenConditionMenu/Orthographic renderer: Check вместо ✓, Plus/Minus для zoom,
прежние aria-checked, условия, handlers и Konva primitives сохранены.

Guard/test inventory теперь **23 source-файла**. Подготовлены новые негативные
actual-source fixtures, GM/PLAYER WorldMap marker DOM-кейсы и выбранная/пустая
condition SVG-проверка. Не запускались. Media reorder/viewer и canvas layer/zoom
пока source-only; крупные mock harnesses не создавались.
Проверки текущего пула: только source review, declarations, anchors и diff;
никаких текущих runtime/browser/bundle/contrast PASS. Публикации UIX-645 нет.
Next: оставшиеся Gravity consumers и ChatPanels после UIX-624 integration;
скрытый Initiative не возвращать. Затем общий разрешённый hosted/browser gate.

## Продолжение 2026-09-12 — ресурсы и статус участников

После локального `2e38364` подготовлены ResourceCounters (кнопки Minus/Plus) и
SetupPanel (CircleDot/Circle вместо status glyphs, скрытый доступный текст
«Онлайн»/«Не в сети»). Права, обработчики, значения и регенерация не менялись.
Дополнен существующий ResourceCounters DOM-тест; большого Setup mock harness
не создавали, настоящий browser gate статуса пока не выполнен.

Guard/test inventory расширен до **18 source-файлов**, ASCII +/− в кнопках
отличаются от обычного текста/формул. Negative fixture восстанавливает настоящий
старый ASCII-plus в копии ResourceCounters; обычный оператор вне кнопки допустим.
Новый AST-helper проверен только source review; runtime/formatter/types ещё нет.
Изменены два компонента, один DOM-test, registry, guard/test и три документа.
Next: оставшаяся медиа/карта/selection миграция, без скрытого battle и без
ChatPanels до UIX-624 integration. Публикация UIX-645 по-прежнему не разрешена.

## Продолжение 2026-09-12 — персонажи и режимы бросков

База этого пула — локальный shell-коммит `90c03ce`; разделы ниже исторические.
Без runtime и публикации подготовлены CharacterWorkspace (rail/close/create/
archive), StatLayoutCard (reorder/rename/delete/add), RollModeControl, disclosure
QuickRollPanel и GM-only control DiceTrayPanel. Настоящий смысл diamond оказался
приватностью броска, поэтому в обоих местах используется один EyeOff, а не
иконка кости. Текстовые d2–d20 и формулы сохранены. Normal/advantage/disadvantage
различаются Circle/ArrowUp/ArrowDown; radio/pressed labels и handlers не менялись.

- Изменены пять компонентов, registry, scoped guard/test, StatLayoutCard test,
  новый DiceTrayPanel.icons test, CSS удаляет только осиротевший span-override
  в collapsed character create; три документа миграции.
- Guard теперь перечисляет **16 source-файлов**. Новые negative fixtures
  восстанавливают glyph в in-memory копиях реальных StatLayoutCard/DiceTray
  исходников. Это пока намерение проверки, а не её успешный запуск.
- Подготовлены DOM-проверки пяти stat-actions и двух dice cases: разные
  декоративные SVG/selected radio; GM-only name/pressed state/точный payload.
  Никто не запускал их в этом пуле; это не доказательство browser acceptance.
- Проверка: source review и `git diff --check`; без Node/npm/Docker/build/
  форматтера. Обязательны будущие hosted quality, SVG guard с negative/restored,
  browser GM/PLAYER, темы и compact rail alignment.
- Блокер публикации UIX-645 не изменился: отдельного разрешения нет. Не
  публиковать и не закрывать карточку. Next: оставшиеся checklist-области,
  затем единый разрешённый gate; ChatPanels только после интеграции UIX-624.

## Продолжение 2026-09-12 — карта и навигация, локальный пул

Этот раздел актуальнее исторического foundation-отчёта ниже.

После сохранения первого пула в `b9882ad` подготовлен следующий shell-пул:
шесть контролов App (выбор/показ/создание сцены, меню сеанса, раскрытие Sidebar,
закрытие roll toast). Изменены только изображения иконок; исходные publication
branch, ARIA и handlers сохранены. Guard расширен до 11 source-файлов и
negative fixture возврата fullwidth-plus на копии фактического App source в
памяти теста. Это доказывает intent теста guard, не browser-поведение App:
сам fixture ещё не запущен. Локальная подготовка, без публикации и runtime.

Дополнение текущего пула: локально подготовлен также MusicBar (Play/Pause,
Volume2, Ellipsis) и GamePauseOverlay (Pause), с двумя focused DOM-кейсами.
Добавлены `docs/icons-migration.md`, `scripts/ui-icon-policy.mjs` и
`tests/ui-icon-policy.test.ts`. Guard читает десять точных source-файлов,
CSS-охват по-прежнему toolbar/grid/resize; negative fixtures включают JSX,
entities, config/template, CSS escapes, named-only import contract и
исключения для прозы/математики. Source review исправил обработку отсутствующих
AST nodes и запрет динамического каталога: это статическая policy, а не runtime
security boundary. Никакие новые runtime PASS не заявляются.

Все 38 оставшихся групп source-кандидатов зафиксированы в migration checklist
по областям; неоднозначную форму выбирать по реальному действию и доступному
имени, не меняя flow. Потребители другого SVG-пака и скрытые legacy-контролы
учтены отдельно. Дальше — продолжение checklist и разрешённый hosted gate;
пока публикация этого отдельного пула не разрешена, он остаётся локальным.

- Исходный foundation сохранён отдельным коммитом `f506a7c`, затем без
  конфликтов интегрирован проверенный main `22e0583` в `db68636`.
  Используется прежнее рабочее дерево; повторных установок и копий зависимостей нет.
- Переведены MapToolbar, CursorPresenceMenu, GridSettings,
  CanvasHistoryControls и кнопка сворачивания Sidebar; общий AppIcon и
  семантические named exports переиспользованы. Контролы и обработчики сохранены.
- Удалены CSS-псевдоиконки только связанного toolbar-пула. В развёрнутом виде
  доступны подписи, в свёрнутом — реальные SVG. Раскрытие и скрытие тумана
  полигоном различаются Pentagon/Hexagon, а не одной формой без подписи.
- Дополнены DOM-проверки состава иконок, доступных имён курсора и различимости
  полигонов после сворачивания. Независимый source review нашёл одинаковые
  polygon-иконки; исправлено до runtime gate.
- Изменены: `MapToolbar.tsx`, `MapToolbar.dom.test.tsx`, `Sidebar.tsx`,
  `renderers/CanvasHistoryControls.tsx`, `renderers/GridSettings.tsx`,
  `ui/CursorPresenceMenu.tsx`, `ui/CursorPresenceMenu.test.tsx`, `ui/icons.ts`,
  связанный участок `styles.css`. Anti-regression guard и полный реестр —
  следующий связанный шаг, не доказанная готовность.
- Проверено только чтением source/diff и `git diff --check`. Тесты, сборка,
  темы/контраст и browser QA новой ревизии не запускались. Исторические PASS
  ниже не являются приёмкой текущего пула.
- Код локальный: не опубликован, не main и не production. UIX-645 остаётся
  In Progress. Следующее действие: scoped guard + полный migration checklist,
  затем разрешённый hosted gate; не закрывать всю карточку по карте.

## Историческое состояние 2026-09-06

- **Решения:** Lucide — обязательный пак авторских UI-иконок; Unicode/emoji/
  entities/CSS content не заменяют иконки. Обычный текст, формулы, хоткеи и
  пользовательский контент не затрагиваются. Полная миграция и её приёмка —
  UIX-645; полный аудит выпадающих меню — отдельная сквозная UIX-644.
- **Ревизия:** база `8dadb9ae295560c6f225cce5de5be522683393ab`, локальная ветка
  `codex/uix-645-lucide-foundation`, worktree `.worktrees/uix-645-lucide-foundation`.
  Изменения **не закоммичены и не опубликованы**. Свежий remote fetch не выполнен:
  сетевое чтение GitHub в sandbox недоступно; использована известная main-база.
- **Изоляция:** основной checkout `antigravity/uix-407-app-decomposition` и
  release worktree не менялись и при финальной проверке оставались clean.
  Production, данные кампаний, чужие ветки и release-процессы не затрагивались.
- **Файлы:** `apps/web/package.json`, `pnpm-lock.yaml`;
  `apps/web/src/ui/{icons.ts,AppIcon.tsx,AppIcon.test.tsx,ArkenDialog.tsx,ArkenDialog.icons.test.tsx,gravity-foundation.css}`;
  `docs/icons.md`, `docs/development-guide.md`, этот checkpoint.
- **Результат:** официальный `lucide-react@1.41.0`, ISC LICENSE в пакете;
  общий named-export entrypoint и декоративный `AppIcon` (16/20/24 px,
  stroke 2, currentColor, aria-hidden, focusable=false). Символы закрытия и
  сброса расположения workspace-окон заменены реальными SVG; действия,
  доступные имена, focus logic и размеры кнопок не менялись.
- **Lockfile:** сохранено только добавление Lucide (12 строк); попутные
  обновления Storybook/Playwright, внесённые package manager из-за `latest`,
  убраны. `pnpm install --frozen-lockfile --ignore-scripts --offline` PASS,
  существующие версии сохранены; install scripts не запускались.
- **Проверка:** `pnpm --filter @arken/web... build` PASS;
  scoped Vitest **4 файла / 23 теста PASS** (`AppIcon`, `ArkenDialog.icons`,
  `useWorkspaceWindow`, `StatLayoutCard`); web typecheck PASS; scoped ESLint
  PASS; Prettier для изменённых source/docs PASS; `git diff --check` PASS.
  Первый прогон StatLayoutCard упал из-за отсутствующего dist у @arken/system
  в новом worktree; после сборки workspace dependencies повторный gate зелёный.
- **Bundle:** source maps содержат только два icon-модуля Lucide (`x.mjs`,
  `rotate-ccw.mjs`) и общий runtime, не весь каталог. Vite предупреждает о
  крупных application chunks; этот foundation-пул не решает code splitting.
- **Границы evidence:** тесты используют реальные SVG и workspace DOM; только
  неиспользуемая modal-ветка Gravity заглушена из-за CSS в Vitest. Browser QA,
  все GM/PLAYER/compact states, полная миграция и anti-glyph CI guard **ещё не
  выполнены**. Документированный запрет не выдавать за автоматическую защиту.
- **Следующее действие:** продолжить UIX-645 с реестра всех псевдоиконок и
  миграции связанными UI-пулами; добавить проверенный отрицательным примером
  anti-regression guard. До интеграции обновить известную main-базу, проверить
  пересечения с параллельной работой и пройти общий gate. Не закрывать задачу
  по одному установленному пакету или первым двум иконкам.

## Current built shell / compact gate — 2026-09-17

Build source `1ea7051b56092551423546ae9a507a22069f9f62`; test strengthening `2283d26bf36d77e225e5816b46d1fb8e93abb1a5`. One local production build3.28s,20/20 Chrome/Firefox cases PASS83.894s: shell SVG8 (GM/PLAYER1280/390, decorative accessibility/currentColor/stroke2/named controls/min24px) and compact actions12 (GM/PLAYER360x850,360x640,640x360,44px targets/hit/keyboard according to existing scope). Shell fixtures now reject unexpected writes including client error telemetry and capture pageerrors. No API/server/physical-device acceptance implied.

Served HTML/CSS/main/lazy-renderer payloads4/4 SHA256 match saved build; no dev client. Sourcemaps contain47 Lucide icon modules out of2066 package modules and no dynamic Lucide module. This is not an import of the entire catalogue. Source maps are local diagnostic artifacts, not deployment. Main chunk1,078,380-ish bytes remains above500kB warning (see exact manifest); do not suppress warning. Inter still uses remote Google Fonts: no icon CDN does not mean no remote fonts.

Artifacts under `icons-built-1ea7051` in current artifactBase: build.log,dist,manifest.json,bundle-audit.json,results.json,case-index.json,browser-output. GM390 and PLAYER1280 Chromium screenshots visually inspected; SVGs render/align in sampled controls, compact toolbar and dice remain scrollable/partially outside initial view. Not all themes, contrast/disabled-state matrix, full UI migration or formal Done. Reuse this exact build while app source is unchanged; original UIX-644 ResizeObserver FAIL remains.

## Сверка исходных критериев — 2026-09-19

Текущий кандидат для runtime evidence:
`cce56397a6b1e91fcf2fc6951e506d64b62647cb`, GitHub Actions E2E run
`35388600465`. Его retained reports подтверждают центральный current-SHA gate:
`icon-shell-contract.spec.ts` — 4/4 в Chromium и 4/4 в Firefox;
`compact-action-targets.spec.ts` — 6/6 в Chromium и 6/6 в Firefox. Итого 20/20,
без failed cases. Это не делает более ранний bundle audit exact-candidate audit.

| #   | Исходный критерий Linear                                                                     | Текущий результат                    | Evidence и точная граница                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Официальный Lucide установлен, exact version/license сохранены                               | **PASS**                             | `lucide-react@1.41.0`, lockfile и ISC license интегрированы в main. Повторная установка не нужна.                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | Общий documented entrypoint и реальное SVG-использование                                     | **PASS**                             | `AppIcon`/named `icons.ts`, documented contract и реальные SVG используются в reachable UI; central exact-main gate видит отрисованные SVG.                                                                                                                                                                                                                                                                                                                                           |
| 3   | Полная reachable-миграция; Unicode/emoji/glyph больше не служат авторскими UI-иконками       | **PASS**                             | Интегрированный migration checklist и source-closure guard покрывают reachable local source. Обычный текст, формулы, хоткеи, пользовательские emoji/стикеры и unreachable legacy не являются нарушением критерия. Исторические unchecked строки ниже не требуют повторной миграции.                                                                                                                                                                                                   |
| 4   | Иконка соответствует действию; размер/stroke/currentColor и hover/disabled/focus согласованы | **PASS для reachable current UI**    | Exact-main shell/compact 20 cases проверяют currentColor, stroke2, rendered bounds, hover/disabled/focus и компактные hit targets. Датированные per-surface receipts в `docs/icons-migration.md` дополняют действия/выравнивание; они не переименовываются в exact-main bundle evidence.                                                                                                                                                                                              |
| 5   | Icon-only controls имеют accessible names; decorative SVG скрыты и не создают tab stop       | **PASS**                             | Exact-main central gate проверяет непустые control names, `aria-hidden`, `focusable=false`, keyboard focus на контроле, а не SVG.                                                                                                                                                                                                                                                                                                                                                     |
| 6   | Desktop/compact, GM/PLAYER, keyboard, themes, contrast и hit-area                            | **PARTIAL / BLOCKED UIX-317**        | **PASS** для единственной reachable current dark theme: exact-main покрывает GM/PLAYER, 1280/390 и compact 360×850/360×640/640×360, keyboard, focus/hover/disabled и ≥24/44px targets; retained surface receipts содержат contrast checks. **BLOCKED** для plural player themes: generated theme styles не опубликованы в runtime, ownership/persistence/publication не решены в UIX-317. UIX-645 не выбирает account/profile/campaign/membership и не активирует темы ради закрытия. |
| 7   | Нет runtime CDN/whole-catalog import; quality gate проходит                                  | **PASS с immutable bundle boundary** | Ранее сохранённый bundle report на verified revision `6f28bb2` содержит 47 уникальных Lucide modules из 2066, без DynamicIcon/dynamic registry/network в emitted Lucide modules и с локальными HTML assets. Это immutable earlier evidence, **не** exact-cce bundle audit. Exact-main quality/E2E green подтверждает текущую интеграцию, но не расширяет границу старого bundle report.                                                                                               |
| 8   | Автоматический запрет возврата псевдоиконок проверен отрицательным примером                  | **PASS**                             | Policy/source-closure gate 28/28 включает negative JSX/config/HTML/CSS/escaped-glyph fixtures и реальные source anchors; тесты включены в обычный Vitest CI.                                                                                                                                                                                                                                                                                                                          |
| 9   | Наличие пакета не подменяет полную миграцию и QA                                             | **PARTIAL**                          | Reachable migration, guard, exact-main central runtime и датированные visual micropools имеют evidence. Полная строка не PASS, пока исходный theme axis критерия 6 остаётся BLOCKED; package-only closure не заявляется. Физические устройства, server mutations, playback и gameplay не добавляются как новые icon criteria.                                                                                                                                                         |

**Closure result:** автоматического `Done` нет. Единственный материальный остаток
исходной матрицы — unpublished plural-theme axis, принадлежащий решению и
интеграции UIX-317. До этого решения не переустанавливать пакет, не повторять
миграцию и не перезапускать неизменившиеся icon gates. Если UIX-317 публикует
темы, следующий связанный пул — одна cross-theme проверка icon contrast,
focus/disabled/currentColor и hit-area на уже мигрированных controls; если не
публикует, статус UIX-645 всё равно меняется только отдельным Linear stage gate,
а не этим документом.
