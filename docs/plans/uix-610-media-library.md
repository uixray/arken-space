# UIX-610 — использование и удаление файлов в медиатеке

## Замер

Точка входа уже изолирована в `sidebar/MediaPanel.tsx`: она получает snapshot и
upload action через `Sidebar.tsx`. Для вертикального flow не нужны изменения в
`App.tsx`, `styles.css` или `ChatPanels.tsx`.

## План

1. Расширить `AssetActions` запросом usage и guarded delete с reload snapshot.
2. В `MediaPanel` показывать превью, имя, тип, размер и состояние использования.
3. Для GM добавить раскрытие usage и удаление только после подтверждения;
   `ASSET_IN_USE` показывать как блокировку без force-delete.
4. Покрыть component tests: success, blocked, cancel и server failure.
5. Провести focused-проверки и диверсию; полный gate оставить на конец UI-пула.

## Границы

- Не менять `apps/web/src/App.tsx`, `apps/web/src/styles.css` и
  `apps/web/src/sidebar/ChatPanels.tsx`.
- Не добавлять force-delete и не воспроизводить серверное правило usage на
  клиенте.
- Не выполнять push, merge или deploy.

## Checkpoint — 2026-09-02

- **Решение:** flow остаётся внутри `MediaPanel` и `AssetActions`; серверное
  правило usage не дублируется, force-delete отсутствует.
- **Ревизия:** `4d46329` (реализация `e3436d0`, browser flow `4d46329`).
- **Изменено:** `use-asset-actions.ts`, `MediaPanel.tsx`, его component tests,
  безопасная передача actions через `Sidebar.tsx`, один E2E flow.
- **Проверка:** format/lint/typecheck/build PASS; Vitest 209 файлов / 1692 теста
  PASS; focused component 6/6 PASS; isolated Chromium + Firefox 2/2 PASS.
- **Диверсия:** неверный usage count дал 1 failed / 5 passed, после возврата
  6/6 PASS.
- **Открытый gate:** полный `pnpm test:e2e` требует `DATABASE_URL`; без него
  runner ожидаемо остановлен. Связанный mock-based flow прошёл в обоих браузерах.
- **Дальше:** review/интеграция ветки; push, PR, merge и deploy не выполнялись.
