# UIX-507 — предсказуемое множественное выделение

## Замер

PR #58 восстановил рамку и групповой drag, но текущая реализация остаётся неполной:

- рамка запускается обычным drag вместо Shift+drag, поэтому empty-canvas pan недоступен;
- Shift+click token/drawing не добавляет и не снимает отдельный объект;
- drawing marquee обходит общий фильтр visibility, а MAP token можно включить в bulk через прямой click;
- нет счётчика, подтверждения bulk delete и группового Delete;
- массивы выбора не пересчитываются после удаления, resync или потери access;
- ошибка группового перемещения не имеет явного UI rollback/resync-контракта.

## План

1. Вынести pure модель selection: toggle/replace, пересечение рамки и prune по текущим editable объектам.
2. Привести жесты к контракту Linear: обычный empty drag — pan, Shift+drag — marquee, Shift+click — toggle, обычный click — replace.
3. Строить selection и movable targets только из видимых редактируемых token/drawing; исключить pending, locked, MAP и чужие объекты.
4. Добавить счётчик типов, подтверждение bulk delete и Delete для группы; очищать выбор только после успешной мутации.
5. Пересчитывать selection при authoritative props/access changes; на group-move failure откатывать transient drag и запрашивать resync.
6. Закрепить pure unit и два связанных browser flow для GM/PLAYER; выполнить адресные диверсии.

## Зависимость

Ветка stacked на PR #58, где находятся базовая marquee-модель, queued bulk move и пользовательский Ctrl+click ping. Merge и production publication отложены до отдельного scope; production-сервер выключен.

## Чекпоинт

- Решение: обычный empty-canvas drag снова панорамирует; Shift+drag создаёт рамку, Shift+click добавляет/снимает token или drawing, обычный click заменяет выбор.
- Доступ: выбор, keyboard/group move и delete используют текущие видимые редактируемые объекты; pending, MAP, locked, скрытые и чужие объекты исключены.
- UI: показаны общее количество и типы; Delete/кнопка открывают подтверждение, выбор очищается только после успешного bulk delete и пересчитывается после authoritative access/visibility changes.
- Ошибка move: `MapMoveQueue` сообщает terminal failure ровно один раз; App выполняет authoritative recovery, renderer remount откатывает transient Konva positions.
- Изменённые файлы: `App.tsx`, `Orthographic2DRenderer.tsx`, `SceneRenderer.ts`, `map-selection.ts` и тест, `map-move-queue.ts` и тест, `canvas-token-regressions.spec.ts`, этот план.
- Проверка: unit 39/39 PASS; web typecheck PASS; targeted ESLint и Prettier PASS; browser GM+PLAYER Chromium/Firefox 4/4 PASS.
- Диверсия: принудительный marquee без Shift адресно уронил GM browser test — camera handle не сместился на ожидаемые 40 px; renderer восстановлен.
- Диагностика: первые E2E-падения были ошибками координат fixture (drag попадал в token или вне hit-plane), не дефектами продукта; после привязки к измеренному world-to-screen transform оба браузера зелёные.
- Блокеры: отсутствуют для review. Полный CI выполняется в PR; production не используется.
- Следующее действие: commit, push, stacked PR и Linear In Review.
