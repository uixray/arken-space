# UIX-414 — Sidebar: компонентная проверка role-routing

## Checkpoint — 2026-09-06

- **Стадия:** локальный scoped pool готов к интеграции; задача целиком не закрыта.
- **База:** `8dadb9ae295560c6f225cce5de5be522683393ab` (`main`).
- **Ветка:** `codex/uix-414-sidebar-role-tests`; точная revision — в Git history этого checkpoint.
- **Изменённые файлы:** `apps/web/src/Sidebar.role-access.test.tsx` и этот checkpoint.
- **Production code:** постоянных изменений нет. Две временные диверсии
  `Sidebar.tsx` восстановлены побайтно; `git diff --exit-code --
apps/web/src/Sidebar.tsx` — **0**.

## Решение и границы

Добавлены два связанных теста настоящего `Sidebar`:

1. `gmSnapshot()` + прямой `workspace="world-encyclopedia"` открывают editor.
2. `playerSnapshot()` + тот же workspace не открывают editor.

Роль проходит через настоящий `snapshot.me.role`; положительная GM-проверка
не позволяет считать пустой или всегда закрытый renderer корректным. Используются
jsdom и общий `test-support/render.tsx`, включая автоматический cleanup.

Тяжёлые дочерние компоненты и Gravity Button заменены leaf-моками,
типизированными через `ComponentProps<typeof RealComponent>`. Editor-мок читает
только настоящий `open`, ничего не знает о роли или имени fixture. Context
provider настоящий; полный тип `CampaignActions` проверяет command-заглушки,
неожиданная команда бросает ошибку вместо имитации мутации. Названия меню и
заголовков не зафиксированы: параллельный UIX-423 не должен ломать routing-тест.

Это **не** проверка содержимого editor, серверного ACL, браузерного фокуса,
навигации, character mutations или snapshot-фильтрации. Reader `world-codex`
не добавлен в scope: оба пункта меню сейчас GM-only, но прямой reader branch
в `Sidebar` не имеет `isGm`; здесь эта политика не меняется и не нормализуется.

## Проверка и адресные диверсии

Каждая команда возвращала сохранённый exit code самого процесса, не фильтра.
Все проверки ниже локальные, без API/БД и production.

| Проверка                                                        | Результат                                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --offline --frozen-lockfile`                      | **0**, 666 reused, 0 downloaded. Первый запуск под sandbox: EPERM создания `_tmp`, **1**; scoped escalation решила filesystem blocker. |
| `pnpm --filter @arken/contracts build`                          | **0**                                                                                                                                  |
| `pnpm --filter @arken/system build`                             | **0**                                                                                                                                  |
| `pnpm --filter @arken/db build`                                 | **0**                                                                                                                                  |
| `pnpm --filter @arken/web typecheck`                            | **0**                                                                                                                                  |
| `pnpm exec eslint apps/web/src/Sidebar.role-access.test.tsx`    | **0**                                                                                                                                  |
| Component pool ниже, до диверсий и после полного восстановления | **0**, 4 файла / 14 тестов PASS в обоих прогонах                                                                                       |

```sh
pnpm exec vitest run apps/web/src/Sidebar.role-access.test.tsx apps/web/src/sidebar/MediaPanel.test.tsx apps/web/src/WorkspaceNav.dom.test.tsx apps/web/src/campaign-actions-context.test.tsx
```

Исходный точный guard в `Sidebar.tsx`:
`{props.workspace === "world-encyclopedia" && isGm && (`.
Перед изменением проверялись чистота файла и ровно одно совпадение guard.

| Временная диверсия                            | Адресный запуск                                                                                                                         | Подтверждённый результат                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `&& isGm` → `&& !isGm` только у editor branch | `pnpm exec vitest run apps/web/src/Sidebar.role-access.test.tsx -t "opens the editor route for a GM snapshot" --reporter=verbose`       | **1**, ровно GM-тест FAIL: отсутствует editor region; PLAYER-тест skipped.          |
| Удаление `&& isGm` только у editor branch     | `pnpm exec vitest run apps/web/src/Sidebar.role-access.test.tsx -t "rejects the editor route for a PLAYER snapshot" --reporter=verbose` | **1**, ровно PLAYER-тест FAIL: запрещённый editor region появился; GM-тест skipped. |

После **каждой** диверсии `finally` возвращал сохранённые исходные байты.
SHA-256 файла до и после обоих восстановлений:
`5956af2f7398abdc1549312dd87f9eb4dcd228092cb018cd80a00bfeb0b869ac`.
После каждой диверсии также проверялся пустой Git diff файла, затем весь
связанный component pool снова прошёл без диверсий.

Финальный receipt после восстановления:

- `pnpm exec prettier --check apps/web/src/Sidebar.role-access.test.tsx docs/plans/uix-414-component-checkpoint.md` — **0**.
- `git diff --check` — **0**; `git status --short` содержит только два новых
  owned-файла. `Sidebar.tsx` не изменён.
- Read-only review оркестратора: blocking замечаний к тесту нет.

## Блокеры и следующий шаг

- Подтверждённых локальных блокеров нет.
- Полный repository quality gate, E2E и multiplayer этим узким пулом не
  запускались; scoped PASS не заменяет интеграционный gate. **Full CI pending**
  для revision, в которую оркестратор интегрирует этот test-only delta.
- Оркестратор фиксирует только два названных файла отдельным commit и обновляет
  Linear на stage gate. Ветка не включена в production-кандидат UIX-642;
  общий CI и последующая интеграция остаются следующим шагом.
- Публикации, push, merge и deployment этого test-only delta не было.
