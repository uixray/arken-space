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
