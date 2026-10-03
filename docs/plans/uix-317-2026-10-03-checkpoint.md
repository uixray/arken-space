# UIX-317 / UIX-644 — дизайн-система, контрольный пул 03.10.2026

## Решение и граница

- Продолжаем существующую UIX-317, не реализуем персональные темы повторно: membership persistence, preview/save/cancel/reset и `classic-v1` уже выпущены.
- Текущий пул исправляет совместимость семантических floating-ролей с персональными темами и восстанавливает owner-слои Base UI Select, обнаруженные при theme E2E. Остальной редизайн, floating panels, density и GM automation не начинались.
- Никакого merge, push или deploy. Незакоммиченные изменения Antigravity сохранены; файлы не индексировались и не коммитились.

## Ревизия и изменённые файлы

- Рабочее дерево: `.worktrees/uix-421-scene-inputs`, ветка `codex/project-roadmap-2026-09-18`, HEAD `92338fb68b78cf7d3f65b1272a1752363c32341a`.
- До пула: 116 modified/untracked entries. После: 117. Большинство не относится к этому пулу.
- `apps/web/src/design-system/player-theme-gravity.css`: non-classic floating-роли берут текущие theme tokens; общий HUD не получил новых рамок, теней или blur.
- `apps/web/src/design-system/Select.css`: owner-specific z-index на реальном Base UI Positioner — base 1000, workspace 1999, modal dialog+1. **Файл уже был untracked после Antigravity; созданный им компонент не принимается этим checkpoint целиком.**
- `tests/e2e/player-theme-surfaces.spec.ts`: проверка слоя перенесена со старого UIKit wrapper на Base UI Positioner; visibility, hit-test и focus assertions сохранены.

## Проверка

- `pnpm --filter @arken/web typecheck`: PASS до и после узкого пула.
- `pnpm vitest run tests/ui-icon-policy.test.ts`: 21 PASS.
- `pnpm vitest run apps/web/src/design-system/player-themes.test.ts --pool=forks`: 15 PASS.
- `pnpm vitest run apps/web/src/design-system/Select.test.tsx --pool=forks`: 8 PASS.
- `player-theme-states.spec.ts`, Chromium: 4 PASS.
- `player-theme-surfaces.spec.ts`, Chromium: 4 PASS; Firefox: 4 PASS. GM/PLAYER × 1280/390, включая реальные pointer hit-test, z-index и Escape/focus.
- Prettier для трёх затронутых файлов: PASS. `git diff --check` для двух отслеживаемых файлов пула: PASS.

## Блокеры полного gate

- Исходный `pnpm vitest run --pool=threads` не дал результатов и был остановлен. Повтор с `--maxWorkers=1 --reporter=dot` продвигался по тестам, затем Node 24.15.0 завершился нативным V8 fatal error (`UnregisterJitAllocationForTesting`). Полный набор **не принят**.
- `pnpm exec playwright test` без backend падал на `ECONNREFUSED /api/bootstrap`. После запуска локального backend через PGlite полный запуск обнаружил, что browser fixtures требуют экспортированного `DATABASE_URL` и прямого PostgreSQL; Docker daemon недоступен. Кроме того, новый landing в dirty tree ломает старую accessibility assertion с неоднозначным heading. Полный E2E **не принят**.
- В UIX-644 остаются прежние broader gates (ResizeObserver causal replay и headed native Firefox popup). Этот scoped Select fix их не закрывает.
- Rendered contrast всех игровых поверхностей, first-paint, физические устройства и художественная приёмка UIX-317 ещё не выполнены.

## Следующее действие

Сначала согласовать/сохранить точный Antigravity snapshot и восстановить изолированную PostgreSQL E2E-среду; затем устранить несовпадения тестов с новым landing/Base UI, выполнить полный Vitest/E2E на фиксированном кандидате. Отдельным связным дизайн-пулом измерить rendered contrast всех тем и провести визуальную приёмку. До этого не мержить и не публиковать.

## Продолжение QA после запуска Docker — 03.10.2026

**Решение:** проверять только текущее dirty worktree; не использовать существующий `arken-space_postgres-data` и не менять source ради зелёного отчёта. Docker 29.7.2 доступен. Одноразовый PostgreSQL 17 запущен отдельно на `127.0.0.1:5433` с tmpfs, без volume; миграции прошли. Dev backend подключился именно к этой базе. После проверки сервер остановлен, контейнер `arken-codex-e2e-20261003` остановлен и автоматически удалён. Данные существующих томов не затронуты.

**Полный E2E:** точная команда `pnpm exec playwright test` с `DATABASE_URL` теперь запускает 1100 сценариев; начальные игровые тесты проходят. Gate остаётся FAIL на текущем дереве: `accessibility.spec.ts` на странице входа получает два заголовка для `Туман войны` (нужен точный locator или пересмотр разметки); оба legacy-сценария `activity-feed-layout.spec.ts` ожидают 0 `.initiative-panel`, получают 1. После воспроизводимых отказов полный прогон остановлен, поэтому общие PASS/FAIL counts не заявляются. Это не проблема Docker/DB. Trace/error contexts сохранены в игнорируемом `test-results/`.

**Полный Vitest:** обязательный `--pool=threads` остаётся неподтверждённым из-за нативного V8 crash. Диагностический полный прогон `pnpm vitest run --pool=forks --maxWorkers=2 --reporter=dot` завершился: **291/292 файлов, 2484/2485 тестов PASS; 1 FAIL**. `ChatPanels.test.tsx:345` требует, чтобы `<strong aria-label="Итог броска">25</strong>` содержал только текст, но текущий `OutcomeFrame` добавляет декоративный `<div aria-hidden="true">` перед `25`. Это несовпадение тестового контракта с dirty UI; пока не классифицировано как дефект компонента или устаревшее assertion. Альтернативный forks PASS не заменяет обязательный threads gate.

**Изменения этого QA-пула:** только данный checkpoint; исходники и тесты не правились, Git index/commit/push/merge/deploy не выполнялись. После QA `git status --short` показывает 118 entries в общем dirty tree; причины прочих изменений не атрибутируются этому пулу без отдельного diff-аудита.

**Следующее действие:** адресно разобрать три воспроизводимых E2E assertion failures и один Vitest mismatch с фактическим продуктовым поведением, не переписывая тесты ради PASS; затем повторить затронутые проверки. Полный gate возможен только после фиксированного кандидата и успешного обязательного threads-прогона, полного E2E и визуальной/контрастной приёмки.

## Пул исправления подтверждённых отказов — 03.10.2026

**Решения:** accessibility locator был неточным: `Туман войны` и `Динамический туман войны` — разные заголовки. Возврат InitiativePanel в dirty `ChatPanels.tsx` был реальной регрессией против принятого UIX-621 «убрать бой из UI, сохранить данные»; E2E assertions не ослаблены. `OutcomeFrame` внутри `<strong>` имел некорректный блочный корень; raw-markup regex проверял структуру вместо смысла. Дополнительно устранены новые `useMemo` после early return, нарушавшие Rules of Hooks.

**Ревизия:** всё ещё HEAD `92338fb68b78cf7d3f65b1272a1752363c32341a`, dirty tree, без commit/index/push/merge. `git status --short`: 120 entries после пула; это суммарное состояние, не перечень собственных изменений.

**Изменённые файлы пула:** `tests/e2e/accessibility.spec.ts` — exact heading; `apps/web/src/sidebar/ChatPanels.tsx` — не рендерить сохранённую инициативу, снять новые условные memo; `apps/web/src/sidebar/ChatPanels.test.tsx` — семантическая DOM-проверка total `25` и отсутствие приватного frame URL; `apps/web/src/sidebar/OutcomeFrame.tsx` — декоративный `span` вместо `div`; `apps/web/src/styles.css` — отсутствовавший `--surface-raised` alias к canonical `--color-surface-raised` для theme-aware табов. Большие остальные diff hunks в `ChatPanels.tsx` и `styles.css` предшествовали этому пулу; форматирование затронутых файлов выполнено без намеренного изменения чужой логики.

**Верификация:** `ChatPanels.test.tsx` — 14/14 PASS через Vitest forks; web typecheck PASS; адресный eslint четырёх TS/TSX файлов PASS; Prettier/check для затронутых файлов PASS; `git diff --check` для затронутых tracked файлов PASS. E2E `accessibility.spec.ts` + `activity-feed-layout.spec.ts` сначала дал 9 PASS/1 FAIL: реальный Chromium axe contrast у #chat-tab-story 2.05:1 (light text на hardcoded dark fallback). После semantic alias адресный game-screen axe E2E — Chromium 1 PASS, Firefox 1 PASS. Предыдущие 9 PASS не повторялись после одной CSS-правки. Это **не полный 1100-case gate**.

**Среда/cleanup:** адресный E2E шёл против отдельного PostgreSQL 17 на `127.0.0.1:5433`, tmpfs без volume; dev backend подключился к нему. Backend остановлен; одноразовый Docker-контейнер остановлен/удалён. Production и постоянные тома не тронуты.

**Открытые gate и срок:** обязательный полный `--pool=threads` не принят на локальном Node 24; CI использует Node 22. Полный E2E на одном зафиксированном кандидате, checks (tokens/build/typecheck/lint/format/Vitest), multiplayer, review всех dirty файлов, rendered contrast/first-paint/manual GM+players и UIX-644 historical acceptance впереди. Затем отдельно exact-main CI, backup/restore/media/rollback/host preflight/postflight по release checklist и явное разрешение владельца. Оценка до технической готовности кандидата при отсутствии новых крупных дефектов — ориентировочно **1–3 рабочих дня**, не обещание даты деплоя; ручная приёмка и неизвестные регрессии могут увеличить срок. Следующий шаг — зафиксировать и просмотреть candidate diff, затем единый удалённый CI gate на Node 22; полный набор локально после каждой правки не повторять.

## Пул подготовки кандидата и security review — 03.10.2026

**Решения:** единый dirty snapshot Antigravity (~121 modified/untracked entries) не считать релизным кандидатом и не делать `git add -A`. Проведён read-only deep review: beta alias fallback, demo seed на обычном startup, silent PGlite fallback и публичная localhost Storybook ссылка были блокерами. Права на `critical-success.png` и `critical-failure.png` владелец подтвердил как собственные или с правом публикации; независимая проверка происхождения не заявляется. `cookies.txt` исключён точным правилом `.gitignore`, содержимое не читалось.

**Ревизия:** HEAD `92338fb`, ветка `codex/project-roadmap-2026-09-18`, без commit/index/push/merge/deploy. Изменения безопасности: `apps/server/src/routes.ts` — beta alias снова fail-closed, без создания grant/membership; новый `beta-player-auth.integration.test.ts` — 6 сценариев. `apps/server/src/seed.ts` — обычный seed не сбрасывает activeScene, не раскрывает fog и не добавляет demo/users/grants/tokens; большой Antigravity demo-блок сохранён в невызываемом `seedDevelopmentDemoContent` с явным dev-only opt-in и случайными token hashes. `apps/server/src/env.ts`, `index.ts` — postgres по умолчанию, PGlite только явный development driver, без вывода DATABASE_URL. `apps/web/src/AuthGate.tsx` — Storybook localhost только в DEV, hardcoded version удалена; `docs/development-guide.md` документирует driver. Все изменённые рабочие файлы остаются частью общего dirty дерева, не приняты целиком.

**Верификация:** server typecheck PASS; beta auth integration 6/6 PASS (`--pool=forks --maxWorkers=1`); Prettier для seed/routes/dev guide PASS; `git diff --check` для этих серверных файлов PASS. Seed isolation ещё не имеет отдельного integration test; полный threads Vitest и полный E2E не повторялись на незамороженном кандидате. Node 24 native crash прежнего полного threads gate остаётся; Node 22 CI ещё не запускался.

**Блокеры / следующее:** проверить seed isolation тестом на существующей кампании; отделить нужный frontend candidate от объёмных сторонних diff/lockfile churn; review ACL прав персонажа и Storybook/design-system imports; заморозить чистый commit SHA и выполнить единую матрицу gates, затем ручную GM/PLAYER приёмку и release-host gates. Производство не обновлять без полного gate и отдельного явного запроса.

## Пул проверки seed и границ релиза — 03.10.2026

**Решения:** обычный `ensureSeed` проверен на уже существующей кампании. Deep review отделил четыре возможных связанных кандидата: узкие UI/QA fixes, self-service ACL, большой frontend redesign, dev DB tooling. Выбор между узким релизом и полным Antigravity redesign запрошен у владельца; до ответа не stage/commit/push. Права на две PNG рамки подтверждены владельцем ранее.

**Ревизия/файлы:** HEAD `92338fb`, без commit/index/push. Добавлен только `apps/server/src/seed-safety.integration.test.ts` в этом пуле; совместная dirty ветка остаётся около 121 entries. Код seed сохранён после предыдущего пула.

**Проверка:** адресный `seed-safety.integration.test.ts` 1/1 PASS на изолированной PGlite с миграциями: active scene, сцены и fog неизменны; demo grants/catalog/tokens/controllers не созданы. Server typecheck PASS, Prettier теста PASS, `git diff --check` по изменённым серверным файлам PASS. Полный Vitest/E2E/CI не запускался, кандидат не заморожен.

**Новые блокеры:** `pnpm-lock.yaml` резолвит `@storybook/addon-mcp@10.6.1` с peer `storybook ^10.6.1`, тогда как импортёр использует Storybook `10.5.10`; Playwright 1.62.1/1.63.0 смешан. Эти unrelated `latest` upgrades исключить из узкого кандидата либо отдельно выровнять и проверить. ACL expansion в `routes.ts` разрешает PLAYER создание персонажа и owner/controller менять skills/spells/wallet/catalog; явной cross-character дырки при review не найдено, но матрица прав и тесты creation/ownership/foreign campaign/revoked controller неполны. Для полного frontend кандидата нужны все связанные untracked imports, иначе сборка сломается.

**Дальше:** получить решение о scope; собрать точный manifest/commit без приватных данных и unrelated tooling drift; выполнить remote Node 22 gates и браузерную матрицу на одном SHA, затем ручную приёмку и release-host checklist. Без этого релиз запрещён.

## Пул полного кандидата: права и инструменты — 03.10.2026

**Решение владельца:** ближайший кандидат должен включать **полный редизайн и функции Antigravity**. На этапе Validate/Ship prep это зафиксировано stage-gate комментарием UIX-317. Нельзя заменить scope только узкими fixes. По-прежнему не разрешены merge/push/deploy без отдельного запроса.

**Ревизия/файлы:** HEAD `92338fb`, dirty worktree ~125 entries, без staging/commit. Добавлена матрица ACL в `apps/server/src/character-catalog-acl.integration.test.ts`: PLAYER self-owned create, foreign campaign 404, owner/controller skills/spells, wallet через штатный counters endpoint, catalog CRUD, unrelated player и revoked controller denial. Обновлены `apps/web/.storybook/main.ts`, `apps/web/package.json`, root `package.json`, `pnpm-lock.yaml`: неиспользуемый addon-mcp удалён (его latest давал несовместимый peer), Playwright и core закреплены на стабильном 1.62.1, Chromatic на прежнем 5.3.0; PGlite importer сохранён как зависимость dev-DB работы. Из двух существующих UI тестов удалены лишние пустые строки в EOF.

**Верификация:** ACL integration 7/7 PASS на PGlite; server typecheck PASS; Prettier ACL PASS; `pnpm install --lockfile-only --offline --frozen-lockfile` PASS без установки пакетов; в lockfile нет Playwright 1.63.0; `git diff --check` для dependency файлов и двух UI тестов PASS. Два промежуточных падения ACL были неверным test route (`wallet` передавался в general PATCH вместо dedicated counters) и повторной no-op суммы в fixture; в финальном сценарии исправлены, production route не менялся. Полный Vitest/E2E на фиксированном SHA ещё не выполнялся.

**Блокеры/следующее:** связный frontend candidate всё ещё не зафиксирован; в большом dirty tree есть новые untracked компоненты/ассеты, которые нужно включать по import closure. Затем разовая проверка build/typecheck/lint/format/tokens/Vitest/Playwright/multiplayer на frozen SHA, browser визуальная/контрастная приёмка GM и игрока, release-host gates. Production не обновлять.

## Пул полного candidate audit и P1/P2 исправлений — 03.10.2026

**Решения:** создан `docs/plans/full-redesign-candidate-2026-10-03.md` с группами import/dependency closure и исключениями; это не финальный staging manifest. Astra read-only audit обнаружил: P1 потерю hit-testing рисунков, P1 двойной MusicBar/audio при открытии мобильного меню, P2 отсутствие инвалидации кэша тумана после async texture load, P2 race быстрого входа beta-игрока. Никаких других конкретных auth bypass в этом проходе не выявлено; это не утверждение о полном security audit.

**Ревизия/файлы:** база всё ещё `92338fb`, dirty tree, без staging/commit/push. `Orthographic2DRenderer.tsx` — foreground Line снова слушает hit events, outline остаётся non-listening; fog cache зависит от загруженной текстуры. Новый `Orthographic2DRenderer.interactions.test.ts` фиксирует конфигурацию. `App.tsx`, `AppHeader.tsx`, `CompactMenuSurface.tsx`, `MusicBar.tsx` — один стабильно смонтированный audio owner, контролы через portal переключаются между header/menu; `MusicBar.test.ts` проверяет DOM identity и громкость. `AuthGate.tsx` — синхронный pending guard и доступное disabled состояние quick-login, новый `AuthGate.test.tsx`. Форматирование App/MusicBar затронуло уже большой Antigravity dirty diff; релизный review должен смотреть полный файл/поведение, не считать все строки изменением этого пула.

**Проверка:** renderer targeted test 2/2 PASS; AuthGate targeted test 1/1 PASS; MusicBar targeted tests 28/28 PASS; web typecheck PASS; Prettier по изменённым файлам и `git diff --check` для audio пула PASS. Тест renderer структурный, не заменяет canvas E2E/ручное перемещение рисунка. Full threads Vitest, E2E, Storybook/build и visual QA на frozen SHA всё ещё не выполнены.

**Дальше:** просмотреть full candidate import closure и все изменённые/новые файлы, затем локальный точный manifest и commit без приватных/временных файлов; для remote CI требуется отдельное разрешение на push. После CI — browser/ручной GM+PLAYER QA и release-host gates. Прод не обновлять.

**Уточнение перед staging:** в `docs/plans/ai-execution-log.md` добавлено явное предупреждение, что прежние `[x]` и «проверено» — рабочие заявления Antigravity, не текущая приёмка полного релиза. `git diff --check` по всему tracked diff не показывает ошибок whitespace; status около 128 entries, HEAD неизменен. `cookies.txt` и `.data/` не появляются в untracked status. Запрошено отдельное разрешение владельца на будущий push ветки для CI (без merge/deploy); до ответа push не делать.

## Замороженный кандидат и первый remote CI — 03.10.2026

**Решение/ревизия:** владелец разрешил push ветки для CI и отдельным ответом draft PR только для CI. Exact manifest (131 файл, без `git add -A`, без `cookies.txt`/локальных данных) закоммичен как `87eac435c82538a82abf296c5d656e3c22e8a5d6` и отправлен в `origin/codex/project-roadmap-2026-09-18`. Создан draft PR [#86](https://github.com/uixray/arken-space/pull/86); merge/deploy запрещены. Рабочее дерево было чистым после коммита.

**CI первого SHA:** `checks` [run 37105508239](https://github.com/uixray/arken-space/actions/runs/37105508239) FAIL на `pnpm lint` (27 errors/22 warnings; build/typecheck прошли до lint, downstream format/Vitest не достигнуты). `multiplayer` [run 37105508241](https://github.com/uixray/arken-space/actions/runs/37105508241) PASS. `e2e` [run 37105508208](https://github.com/uixray/arken-space/actions/runs/37105508208) ещё выполнялся на момент проверки; результаты первого SHA нельзя переносить на следующий.

**Исправление связным пулом после CI:** адресно устранены все lint errors в `App.tsx`, `CompactMenuSurface.tsx`, компонентных primitives/stories, `CharacterWorkspace.tsx`, `DiceTrayPanel.tsx`, `SkillCards.tsx`, новых тестах и beta-auth тесте. Условный `useMemo` roleBadge перенесён перед early return; React Compiler-sensitive callback в App получил стабильные локальные зависимости. Workers проверили ESLint на назначенных файлах без ошибок, web/server typecheck PASS и узкие 27 Vitest tests PASS; Prettier исправлен для восьми затронутых файлов, `git diff --check` PASS. Предупреждения lint остаются, но не являются errors. Полный lint/format/Vitest на следующем SHA ещё должен пройти в CI.

**Следующее:** закоммитить только этот lint pool, push в уже одобренную ветку; дождаться exact-SHA checks/e2e/multiplayer. Затем browser/ручная приёмка и release-host gates. Не мержить и не публиковать.

## Второй CI gate: форматирование — 03.10.2026

**Ревизия:** lint-пул закоммичен как `b08aa78c12b1817ed0b746db4c1d1e5c225ee29a` и отправлен в draft PR #86. `checks` [run 37106110154](https://github.com/uixray/arken-space/actions/runs/37106110154) прошёл до `pnpm format:check` и FAIL на 36 файлах (главным образом новые design-system CSS/stories/docs, plus plans/DB/test). Тем самым lint на exact SHA прошёл; full Vitest в этом run ещё не достигнут. `e2e` и `multiplayer` для b08 выполнялись на момент проверки, их результат не переносить на следующий SHA.

**Исправление:** ровно 36 путей из CI лога отформатированы Prettier без ручных логических правок. Адресный `prettier --check` 36/36 PASS и `git diff --check` PASS. Следующее — отдельный commit формат-пула, push в уже разрешённую ветку и ожидание полной CI матрицы на новом SHA. Merge/deploy запрещены.
