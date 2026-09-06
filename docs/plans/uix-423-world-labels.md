# UIX-423 — названия рабочих пространств мира

## Решение и границы

- База: `8dadb9ae295560c6f225cce5de5be522683393ab`, ветка `codex/uix-423-world-labels`.
- `world-encyclopedia` — **Редактор мира**: создание, изменение, архивирование и публикация сущностей.
- `world-codex` — **Справочник мира**: поиск и чтение опубликованного канона.
- Формулировки делегированы исполнителю в Linear. Объединение не нужно: роли содержимого различаются.
- Общие названия используются навигацией и заголовками, связанный текст ошибки также согласован.
- IDs, порядок, `isGm`, API, права публикации и данные сохранены. Оба пункта сейчас скрыты в PLAYER navigation; это существующее решение UIX-472, не новый ACL.

## Изменённые файлы

- `apps/web/src/world-workspace-labels.ts`
- `apps/web/src/workspace-nav.ts`
- `apps/web/src/WorldContentWorkspace.tsx`
- `apps/web/src/WorldEncyclopediaWorkspace.tsx`
- `apps/web/src/WorkspaceNav.dom.test.tsx`
- `tests/e2e/navigation-completion.spec.ts`
- этот checkpoint.

## Проверки

- Offline frozen-lockfile install: PASS, lockfile не изменён.
- Build: PASS; существующее предупреждение о крупных chunks, не ошибка.
- Однократный bounded review: блокирующих замечаний нет.
- DOM: настоящий `workspaceNavItems` → `WorkspaceNav` → клик по доступному названию → прежний callback ID.
- Browser: реальные диалоги на 1024/390 px, API замокан; не доказательство content/auth/server ACL.
- Первичный связанный DOM/unit pool: **5/5 PASS**; новый browser-сценарий: **2/2 PASS**, Chromium и Firefox, retries=0.
- Диверсия подписи редактора на название справочника: адресный DOM-тест **FAIL (exit1)** и тот же browser-сценарий **FAIL в обоих браузерах (exit1)** — старое имя редактора нельзя найти. Сохранённые байты source восстановлены в `finally`.
- Диверсия `onSelect(item.id)` → `onSelect("world-codex")`: DOM-тест **FAIL (exit1)** на точном сравнении ожидаемого `world-encyclopedia` и полученного `world-codex`. `WorkspaceNav.tsx` восстановлен побайтно, Git diff этого файла пуст.
- Полный typecheck обнаружил в новом DOM-тесте опцию `exact`, существующую у Playwright, но не у Testing Library. Опция удалена: строковый `name` Testing Library уже сравнивает точно; production-код и проверяемый контракт не менялись. Формат нормализован перед повторным read-only gate.
- Итоговый пакет после восстановления: `format:check`, `lint`, `typecheck` — **PASS**, lint: 0 ошибок / 4 прежних предупреждения.
- Восстановленный DOM/unit pool: **5/5 PASS**. Весь `navigation-completion.spec.ts`: **12/12 PASS**, Chromium + Firefox, retries=0, 53.5 с.
- Полный Vitest: **227 файлов / 1818 тестов PASS**, exit0, 438.16 с. Это этот label-only delta поверх main; независимый test-only delta UIX-414 в эту ветку не включён.

## Блокеры и следующий шаг

Новый пул отделён от UIX-642. Он не публиковался и не менял уже собранный release-кандидат. Локальный gate завершён; точная revision — в Git history этого checkpoint. Следующий шаг — review/полный CI и отдельная интеграция новой ветки. Полный E2E suite, multiplayer и production для этой новой revision не запускались и не объявляются пройденными.
