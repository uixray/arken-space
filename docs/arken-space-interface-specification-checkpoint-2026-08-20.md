# Checkpoint — Arken Space interface specification

**Дата:** 20.08.2026

**Major pool:** актуализация функционального состава и черновик UI/UX ТЗ

**Revision:** `main`, `HEAD 42c7ccc61863f6728977d2381b9f8997f059e95c`

**Рабочее дерево:** крупный существующий dirty pool; не очищался и не перезаписывался.

> **Internal — not for public/player export.** Наблюдение актуализировано
> 20.08.2026 в 06:01 MSK. Checkpoint исторический и не заменяет
> `docs/current-state.md`, Git или Linear.

## Решения

- До новых макетов сначала согласовать функциональное ТЗ.
- Текущая session IA: карта + адаптивная строка workspaces + resizable/collapsible sidebar + workspace windows/full-canvas workspaces.
- GM и Player проектируются как разные композиции; недоступные role actions скрываются.
- Direct messages не входят в current visible UI.
- Shortcut reference помечен как незакоммиченный WIP.
- UIX-472 намеренно скрывает Files, World Maps и Encyclopedia из Player navigation; это current decision.
- Доступные игроку STORY-сообщения публикуются в единой Activity feed; отдельная Player Story surface остаётся возможным later-scope.
- GM preview в текущей реализации read-only.
- Condition editor и current-turn model зафиксированы как design/product gaps.
- Дизайн строится поэтапно: functional grayscale → controls → frame geometry → palette/material → domain components → full screens.
- Ближайший theme pilot после functional gate: gold/brown dark fantasy; small controls получают облегчённые рамки и минимум texture.
- Pen, Linear и production-код в этом пуле не изменяются.

## Изменённые файлы

- `docs/arken-space-interface-specification-2026-08-20.md` — создано полное функциональное ТЗ.
- `docs/arken-space-interface-specification-checkpoint-2026-08-20.md` — создан этот checkpoint.

Documentation task намеренно не редактировала product code; существующие или параллельные dirty changes не входят в scope checkpoint и не атрибутированы ему. Релевантный WIP на момент последнего аудита ограниченно проверялся в `App.tsx`, `Sidebar.tsx`, `ShortcutsDialog.tsx`, `landing-guide-content.ts`, `map-interaction.ts`, `map-tool-shortcuts.ts` и `Orthographic2DRenderer.tsx`.

## Проверка

- README, Git history, текущие UI contracts и test inventory проверены read-only.
- Отдельно проверены актуальные роли, navigation, sidebar, map tools, combat/initiative, resources, characters и WIP shortcuts.
- Независимый review ТЗ нашёл и позволил исправить пять расхождений: dynamic stat groups, physical dice, player initiative visibility, persistence фильтров и lifecycle сцен/токенов.
- Markdown-структура, парность fences, UTF-8 и отсутствие trailing-whitespace ошибок проверены; Mermaid-блоки структурно просмотрены, но отдельным renderer не компилировались.
- Визуальный runtime/Pen baseline для этого документа не снимался; последующие
  технические Playwright gates относятся к отдельному implementation-пулу.

## Блокеры / открытые решения

- Названия двух энциклопедий.
- UI редактора token conditions.
- Current turn/round mechanics.
- Финальная типографика, logo interaction и персональные themes.

## Следующий шаг

Получить правки/подтверждение ТЗ. После этого открыть Pen, запустить локальный сервис, снять актуальный GM/Player baseline и собрать functional grayscale макеты без преждевременных textures/shaders.
