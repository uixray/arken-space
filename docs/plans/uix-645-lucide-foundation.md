# UIX-645 — Lucide foundation checkpoint, 2026-09-06

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
