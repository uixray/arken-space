# UIX-644 / UIX-507 — выделение и панель масштаба

## Решения и границы

- База: `3577d2d7a93240650659e1c64f8028be70d2f3cb`, ветка `codex/uix-644-overlay-contract`.
- Постоянные счётчики выделения убраны из HUD и общего `SelectionActions`. Количество и типы объектов сохранены в подтверждении опасного удаления.
- Групповое удаление доступно отдельной позиционированной кнопкой вне `.map-scale`. Структура zoom-блока не зависит от выделения; кнопки, slider, процент, «Вписать» и переключатель слоя GM сохранены.
- Состояние выделения, ACL, payload мутаций, подтверждение/отмена и callbacks не меняются.
- Это ограниченный срез UIX-644/507, не завершение всей приёмочной матрицы.

## Изменённые файлы

- `apps/web/src/renderers/Orthographic2DRenderer.tsx`: удалён постоянный summary; bulk action вынесен из `.map-scale`.
- `apps/web/src/styles.css`: только позиционирование selection action; существующие zoom-правила неизменны.
- `apps/web/src/ui/SelectionActions.tsx`: удалён счётчик, сохранены видимость и три действия.
- `apps/web/src/ui/SelectionActions.dom.test.tsx`: настоящий Gravity, отсутствие toolbar при пустом выборе, callbacks при одном/нескольких объектах без счётчика.
- `tests/e2e/canvas-token-regressions.spec.ts`: GM/PLAYER × desktop/compact; старые UIX-507 assertions опираются на подтверждение и реальные запросы, а не удалённый счётчик.
- Этот checkpoint.

## Проверка

- Root воспроизвёл старый HUD новым Chromium GM desktop тестом: при выборе одного токена x zoom-блока изменился с `843.78125` до `600.9375`, то есть на `242.84375` CSS px. FAIL получен на реальном bounding box, а не поиске строки исходника.
- Новые сценарии сравнивают x/y/width/height в одном viewport с `toBeCloseTo(..., 1)` — разница строго менее `0.05` CSS px. Проверяются 0/1/несколько токенов и рисунков, смешанная группа, Escape и пустой клик.
- Положительное доказательство выбора: `aria-pressed` настоящего списка объектов, панель рисунка и bulk confirmation с количеством/типами. Отмена не отправляет мутацию и сохраняет группу; после очистки Delete не действует.
- Масштаб проверяется реальными +/− и клавишей End на native range; сверяются value и видимый процент. «Вписать» возвращает исходную камеру fixture перед жестами.
- Сохранены GM mixed MOVE/DELETE payload и PLAYER исключение недоступных объектов/разрешённые DELETE targets/prune после отзыва доступа.
- Смешанная группа сохраняется в PNG каждого viewport/role для визуального просмотра root. Синтетические API fixtures не являются production/multiplayer evidence.
- Статический gate worker: scoped Prettier, web/E2E TypeScript, scoped ESLint и `git diff --check` PASS. Первый web TypeScript выявил три неподдерживаемых RTL `exact` option; исправлены до финального PASS.
- Финальный browser и real-Gravity DOM gate пока ожидают root-интеграции. Результат старого базового SHA не переносится на новую ревизию автоматически.

## Блокеры и следующее действие

- Root выполняет интеграцию, сравнение старого/нового поведения, просмотр PNG, commit явных файлов, Linear stage gate и отдельный publication gate.
- DOM-тест использует узкий Gravity inline, уже включённый в интеграционный пул через UIX-421. Этот срез не меняет Vitest config.
- Worker не делал commit, push, PR, Linear write или deploy. Следующий шаг — общий регрессионный gate, затем обновление этого checkpoint точным результатом.
