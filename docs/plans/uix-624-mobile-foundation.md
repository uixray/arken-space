# UIX-624 — P1: responsive foundation

Дата: 2026-09-05. **Checkpoint замороженного implementation-пула; не Done, не полный mobile acceptance и не release.** Статус задачи, итоговые SHA и результаты последующих full E2E / PR / CI gates фиксируются в Linear **UIX-624** и Git, а не считаются пройденными по этому документу.

Родитель — [UIX-316 mobile discovery](./uix-316-mobile-discovery.md). Пользовательское «Хорошо, давай» от 2026-09-05 утвердило направление **minimum 360 CSS px / full PLAYER / limited GM / no PWA** и начало только **P1 / UIX-624**. P2–P6 / UIX-625–629 остаются Backlog; full PLAYER — целевое направление, не результат одного P1.

## 1. База, scope и владение

- Implementation base: **5bd5431**, ветка PR #63; отдельный main/discovery reference: **f1a66c8**. Это разные точки истории, не интегрированный release.
- Feature branch: **codex/uix-624-mobile-foundation**. Замороженная code-ревизия: **0e558df735b6118eda75ea425b569a757c460c31**, parent **5bd543126cf8390ae14a3ba6a0241afa78d84010**. Коммит пока только локальный; последующий docs-only checkpoint не меняет проверяемый код. Исходные discovery-замеры не переносить на новую реализацию.
- Scope: адаптивный вход, compact shell, три основные области, доступ к вторичным разделам, bounded workspace/dialog geometry, safe-area/visualViewport и сохранение состояния представления. Общие игровые команды, auth/ACL и renderer сохраняются; отдельной mobile бизнес-логики нет.
- Root владеет интеграцией, lifecycle, тестами и gates. CSS slice добавляет отдельный mobile-foundation.css и viewport-fit=cover, не переписывает общие styles.css, tokens и тему. Docs slice фиксирует approval и checkpoint. Фактический перечень файлов — §3.
- Перед дальнейшими shared-styles/tools изменениями сохраняется проверка ownership **UIX-317 / UIX-214**. Realtime-архитектура UIX-412 не входит в P1. Репетиция 1 GM + 6 игроков принадлежит UIX-217; mobile QA передаёт evidence туда, не дублирует rehearsal.

## 2. Решения текущего пула

| Область             | Контракт                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Breakpoint          | CSS и TS используют **(max-width: 1023px)**. 768/820 — compact; 1024 — первый измеренный fit исходной desktop-компоновки, не гарантия всех сложных форм. Tablet split не навязывается.                                                            |
| Навигация           | Одна активная область «Карта / Журнал / Персонаж»; session caption, «Разделы» и существующее меню сеанса. Старые desktop navigation / scene switcher / MusicBar в compact header не дублируются. Сложная подготовка явно обозначена desktop-only. |
| Retained roots      | Карта #main-content и sidebar #activity-sidebar остаются mounted; неактивные получают hidden и inert. Character portal кэшируется, но точечный global hidden guard действует и после возврата в desktop. Нет второго Sidebar/renderer.            |
| Draft и focus scope | Состояние изолировано по **campaign / membership / preview**. Возврат внутри своего scope не стирает черновик; смена scope не показывает предыдущий текст и не переносит скрытый focus.                                                           |
| Viewport и формы    | visualViewport height/top, safe areas, bounded roster и одноколоночные character forms; controls журнала прокручиваются, composer/nav достижимы на коротком viewport. Это browser evidence, не доказательство настоящей экранной клавиатуры.      |
| Overlays            | Shell использует absolute в нескроллируемом документе, чтобы не отделять account menu от character portal новым fixed stacking context. Владелец Gravity popup/modal layers сохранён; общей эскалации z-index нет.                                |
| Journal state       | Скрытый журнал не создаёт read side effects; browser-generated scroll в скрытом root не должен обнулять reader position. Проверяется возврат из другой области, а не только mounted DOM.                                                          |

Minimum 360 принят как направление; **320 — best-effort**. Retained DOM, выбранный раздел и ограниченный renderer sizing **не доказывают полное сохранение камеры или touch gestures**.

## 3. Changed files — 23 файла замороженного пула

Список соответствует feature commit **0e558df**; последующий checkpoint меняет только этот документ. Не включает изменения данных или миграции БД.

**Реализация — 12:**

```text
apps/web/index.html
apps/web/src/App.tsx
apps/web/src/CompactNavigation.tsx
apps/web/src/Sidebar.tsx
apps/web/src/main.tsx
apps/web/src/mobile-foundation.css
apps/web/src/renderers/Orthographic2DRenderer.tsx
apps/web/src/sidebar/CharacterWorkspace.tsx
apps/web/src/sidebar/ChatPanels.tsx
apps/web/src/ui/dismissible-details.ts
apps/web/src/ui/useCompactNavigation.ts
apps/web/src/ui/useFollowScroll.ts
```

**Проверки и E2E helper — 9:**

```text
apps/web/src/sidebar/DirectChatPanel.dom.test.tsx
apps/web/src/ui/useFollowScroll.dom.test.tsx
tests/e2e/canvas-token-regressions.spec.ts
tests/e2e/concept.spec.ts
tests/e2e/mobile-foundation.spec.ts
tests/e2e/scene-workspace-dialog.spec.ts
tests/e2e/skill-cards.spec.ts
tests/e2e/story-channel.spec.ts
tests/e2e/workspace-nav-helper.ts
```

**Документация — 2:**

```text
docs/plans/uix-316-mobile-discovery.md
docs/plans/uix-624-mobile-foundation.md
```

## 4. Зафиксированные проверки и ограничения evidence

Результаты ниже — факты локальных связанных прогонов, **не утверждение о финальном CI**. Повторный последовательный quality на замороженном коде завершился exit 0: format:check → lint → typecheck → build → test, **224 файла / 1804 теста**. **Полный локальный E2E gate НЕ ПРОЙДЕН:** первый запуск прерван после native crash Vite; второй завершился exit 1 после повторного отказа dev-server. На момент этого checkpoint PR ещё не создан, обязательный GitHub CI не запускался; отдельный публичный GO уже получен (§6).

| Завершённый прогон                                | Результат и значение                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Первичный quality pool                            | **PASS; unit: 224 файла / 1804 теста.** Не подменяет повторный frozen-code gate.                                                                                                                                                                                                                                                                                                                                                          |
| Первая новая Chromium + Firefox матрица           | **8 PASS / 4 Firefox reader-position FAIL**: после скрытия области позиция 120 → 0. Дефект воспроизведён до исправления.                                                                                                                                                                                                                                                                                                                  |
| Матрица после retention fix                       | **11 PASS / 1 native worker crash**, exit code **3221226505**. Прогон не объявляется 12/12 PASS; native crash не маскируется retry.                                                                                                                                                                                                                                                                                                       |
| Адресный PLAYER 820 + desktop-first, оба браузера | **4/4 PASS** после исправлений; включая field focus и закрытие utility по Escape.                                                                                                                                                                                                                                                                                                                                                         |
| Существующий narrow + desktop-control pool        | **22 PASS, без retries**; исходные ширины **390 / 720 / 800 / 960** не увеличивались ради зелёного результата.                                                                                                                                                                                                                                                                                                                            |
| Финальная viewport geometry                       | **36 GM/PLAYER проверок PASS**: ширины **390 / 430 / 768 / 1023**, а также **844×390 / 360×420**; три основных surface. Screenshot/geometry evidence не означает physical-device acceptance.                                                                                                                                                                                                                                              |
| Диверсия новых Chromium journeys                  | Изменены конкретные ожидания: normal navigation **3 → 4**, preview **2 → 3**; **6 ожидаемых FAIL**. Исходные байты восстановлены. Это доказательство чувствительности assertions, не воспроизведение нового production-дефекта.                                                                                                                                                                                                           |
| DOM-диверсии read/scroll                          | **2 read-state + 2 scroll-state** проверки дали ожидаемый FAIL при диверсии и PASS после восстановления.                                                                                                                                                                                                                                                                                                                                  |
| Первый полный E2E                                 | **Прерван, exit 1; не PASS.** Vite завершился с native-кодом **3221226505**; trace cold-resize показывает отказ загрузки renderer modules, последующие попытки — CONNECTION_REFUSED. Два более ранних 0ms падения прошли на retry; их точная exception не установлена и не приписывается позднему crash. Код по этой инфраструктурной серии не менялся.                                                                                   |
| Повтор полного E2E                                | **FAIL, exit 1; 261 PASS / 22 FAIL / 1 flaky / 4 SKIP**, 30,7 мин, **0e558df**, один worker. В 11:54:48 MSK trace первого scene-workspace FAIL показывает 19 script + 4 fetch CONNECTION_REFUSED к localhost:5173, затем ErrorBoundary; retries — page.goto CONNECTION_REFUSED. Native-код recovery Vite неизвестен. Отдельный flaky PLAYER820: worker exit **3221226505**, retry PASS 38,8 с. Полный gate не подменяется адресными PASS. |
| Финальный адресный Firefox-пул                    | **27 PASS / 1 FAIL**, exit 1, 4,4 мин, **retries=0**. Все 22 case из scene-workspace-dialog / skill-cards / story-channel / token-generator / world-maps прошли. Из mobile-foundation 5 PASS, PLAYER820 снова worker exit **3221226505** при 0ms; раньше адресный этот case проходил (§4). Native-проблема повторяется и не выдана за PASS; точная причина процесса не установлена.                                                       |
| Изолированный Docker multiplayer                  | **PASS, exit 0; Chromium 2/2**, четыре PostgreSQL probes exit 0, restart/изоляция origin/port PASS; точная build revision **0e558df735b6118eda75ea425b569a757c460c31**. Compose cleanup и resource-leak-check PASS, containers/volumes пусты. Production health до/после **SKIPPED: isolated-only**.                                                                                                                                      |

Артефакты geometry — внешняя локальная папка **C:/Users/UIXRay/.codex/visualizations/2026/09/05/01a06ffd-d3d7-7b81-9942-44767cc771f2/**: uix624-measurements.json и 36 финальных uix624-{GM|PLAYER}-{map|journal|character}-{WxH}.png (timestamps около 11:02). В Git-документе только путь и агрегированные результаты: raw fixture tokens, логи и личные данные не копируются. Приватный продукт не означает приватный GitHub-репозиторий.

Локальные машинные артефакты (не входят в Git): **test-results/uix624-full/** — прерванный прогон; **test-results/uix624-full-recovery/** — повтор; **test-results/uix624-firefox-tail/** — адресный Firefox; **test-results/multiplayer/runner.json** — Docker receipt. Логи: **%TEMP%/arken624-full-e2e.log**, **%TEMP%/arken624-full-e2e-recovery.log**, **%TEMP%/arken624-firefox-tail.log**, **%TEMP%/arken624-local-multiplayer.log**, **%TEMP%/arken624-frozen-{format-check,lint,typecheck,build,test}.log**.

Фактический browser QA выполнен через **Playwright**: repo agent-browser CLI не установлен. Эмуляция размеров и visualViewport не заменяет реальный Safari/Chrome с экранной клавиатурой, browser chrome и touch. Физические **iOS Safari / Android Chrome / планшеты не проверялись**. Автоматический изолированный multiplayer не подменяет ручной **UIX-217 / 1 GM + 6 игроков** rehearsal; release gate этим пулом не выполнялся.

## 5. Подтверждённые дефекты и исправления

- **Fixed stacking context:** GM360 показал перекрытие account menu порталом персонажа. Shell переведён fixed → absolute; сохранён существующий слой topbar, без повышения общего z-index.
- **Hidden read:** подавлены read side effects скрытого журнала; недостаточно только убрать его из layout.
- **Firefox scroll:** подавлена потеря reader position из-за scroll-to-zero при display:none; исходные 4 FAIL и последующие результаты сохранены раздельно в §4.
- **Scope/focus:** исправлены focus boundaries при смене области/scope, доступ к character field и Escape utility flow; addressed cross-browser evidence — 4/4 в §4.

## 6. Незакрытые границы, rollback и следующий gate

- **44×44 не заявляется для всех legacy controls.** P1 покрывает вход, compact navigation, composer, базовый journal chrome и workspace shell. Legacy map toolbar / zoom / dice chrome и сложные GM flyout местами остаются меньше 44 px или требуют отдельной проверки достижимости на коротком экране; это явный остаток **P3 / UIX-626** и связанных utility flows P4 / UIX-627, не blanket mobile acceptance.
- Полные camera/pan/pinch/drag/fog/resize mechanics, multi-pointer cancellation и поведение физических устройств с keyboard/browser chrome не доказаны. Сохранённый root не является их доказательством.
- Новые DM, whispers до UIX-365, восстановление battle, PWA/offline editing и общая realtime-перестройка вне этого scope. Полный mobile acceptance и Done для UIX-316 не следуют из P1.
- **Rollback:** обратимый feature commit / commits UIX-624, а не возврат к 5bd5431 или откат чужого base/stack. Проверить точный diff и parentage перед revert. Миграций/данных БД нет; database rollback не требуется.
- **Публичный GO получен после остановки:** read-only GitHub metadata показали **isPrivate=false** для **uixray/arken-space**; исходный push/draft PR был отклонён auto-review до исполнения. После раскрытия публичности пользователь отдельно ответил: «давай завершать текущие задачи и опубликуем на проде и гитхабе актуальную версию». Это разрешает GitHub publication и подготовку production release, но не обход незавершённого gate. Видимость репозитория не меняется; raw QA fixtures/tokens/traces не публикуются.
- **Локальный E2E blocker:** два full-прогона потеряли dev-server, а Firefox worker повторно завершался native-кодом; точная причина процесса Windows не установлена. Не исправлять приложение по одному CONNECTION_REFUSED и не повторять полный прогон бесконечно. Нужны стабильное окружение и полный зелёный прогон; адресные результаты сохранены отдельно.
- **Cleanup локального P1 QA:** собственный API остановлен, dev-server Playwright завершён; после проверки имени/label/loopback-port удалён только **arken624-browser-db**. Слушателей 4100/5173/55498 нет. Корневой **antigravity/uix-407-app-decomposition** остался чистым и не менялся.
- **Next action:** exact push только **codex/uix-624-mobile-foundation**, draft PR с базой **codex/uix-502-modal-popovers**, затем обязательные GitHub checks/e2e/multiplayer. В стабильном окружении выполнить полный E2E, а не переносить агрегат отдельных PASS как готовый gate. До его результата задача не считается готовой. После интеграции текущих PR требуется отдельный exact-main release gate со свежим backup/restore и rollback. Production GO не означает, что эти проверки пройдены. Physical-device/full-touch и human UIX-217 acceptance остаются явно отложенными.

Следующий пул опирается на этот checkpoint, Linear и Git history. Решение — P1 foundation; code revision — **0e558df**; changes — 23 файла плюс docs-only receipt; verification — §4; открытые gates — стабильный full E2E, PR/CI, integrated release и отдельное hardware/full-touch acceptance. P2–P6 не начинаются автоматически.
