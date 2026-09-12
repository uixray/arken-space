# UIX-645 — Lucide foundation checkpoint, 2026-09-06

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
