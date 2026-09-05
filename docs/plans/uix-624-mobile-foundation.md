# UIX-624 — P1: responsive foundation

Дата: 2026-09-05. **Checkpoint замороженного implementation-пула; не Done, не полный mobile acceptance и не release.** Статус задачи, итоговые SHA и результаты последующих full E2E / PR / CI gates фиксируются в Linear **UIX-624** и Git, а не считаются пройденными по этому документу.

Родитель — [UIX-316 mobile discovery](./uix-316-mobile-discovery.md). Пользовательское «Хорошо, давай» от 2026-09-05 утвердило направление **minimum 360 CSS px / full PLAYER / limited GM / no PWA** и начало только **P1 / UIX-624**. P2–P6 / UIX-625–629 остаются Backlog; full PLAYER — целевое направление, не результат одного P1.

## 1. База, scope и владение

- Implementation base: **5bd5431**, ветка PR #63; отдельный main/discovery reference: **f1a66c8**. Это разные точки истории, не интегрированный release.
- Feature branch: **codex/uix-624-mobile-foundation**. Точную feature-ревизию, parentage и состав PR проверять в Git / Linear UIX-624; исходные discovery-замеры не переносить на новую реализацию.
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

Список снят с рабочего Git diff и untracked inventory перед feature commit; коммит и дальнейшую ревизию устанавливает root. Не включает изменения данных или миграции БД.

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

Результаты ниже — факты завершённых связанных прогонов, **не утверждение о финальном CI**. Повторный последовательный quality на замороженном коде также завершился exit 0: format:check → lint → typecheck → build → test, **224 файла / 1804 теста**. Full E2E ещё выполняется. Его true exit, counts, итоговая ревизия и последующие PR/CI gates фиксируются в **Linear UIX-624 и Git**.

| Завершённый прогон                                | Результат и значение                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Первичный quality pool                            | **PASS; unit: 224 файла / 1804 теста.** Не подменяет повторный frozen-code gate.                                                                                                                                                |
| Первая новая Chromium + Firefox матрица           | **8 PASS / 4 Firefox reader-position FAIL**: после скрытия области позиция 120 → 0. Дефект воспроизведён до исправления.                                                                                                        |
| Матрица после retention fix                       | **11 PASS / 1 native worker crash**, exit code **3221226505**. Прогон не объявляется 12/12 PASS; native crash не маскируется retry.                                                                                             |
| Адресный PLAYER 820 + desktop-first, оба браузера | **4/4 PASS** после исправлений; включая field focus и закрытие utility по Escape.                                                                                                                                               |
| Существующий narrow + desktop-control pool        | **22 PASS, без retries**; исходные ширины **390 / 720 / 800 / 960** не увеличивались ради зелёного результата.                                                                                                                  |
| Финальная viewport geometry                       | **36 GM/PLAYER проверок PASS**: ширины **390 / 430 / 768 / 1023**, а также **844×390 / 360×420**; три основных surface. Screenshot/geometry evidence не означает physical-device acceptance.                                    |
| Диверсия новых Chromium journeys                  | Изменены конкретные ожидания: normal navigation **3 → 4**, preview **2 → 3**; **6 ожидаемых FAIL**. Исходные байты восстановлены. Это доказательство чувствительности assertions, не воспроизведение нового production-дефекта. |
| DOM-диверсии read/scroll                          | **2 read-state + 2 scroll-state** проверки дали ожидаемый FAIL при диверсии и PASS после восстановления.                                                                                                                        |

Артефакты geometry — внешняя локальная папка **C:/Users/UIXRay/.codex/visualizations/2026/09/05/01a06ffd-d3d7-7b81-9942-44767cc771f2/**: uix624-measurements.json и 36 финальных uix624-{GM|PLAYER}-{map|journal|character}-{WxH}.png (timestamps около 11:02). В Git-документе только путь и агрегированные результаты: raw fixture tokens, логи и личные данные не копируются. Приватный продукт не означает приватный GitHub-репозиторий.

Фактический browser QA выполнен через **Playwright**: repo agent-browser CLI не установлен. Эмуляция размеров и visualViewport не заменяет реальный Safari/Chrome с экранной клавиатурой, browser chrome и touch. Физические **iOS Safari / Android Chrome / планшеты не проверялись**. Общий multiplayer rehearsal и release gate этим пулом не выполнялись.

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
- **Next action:** root завершает full E2E, оформляет feature commit и PR, фиксирует true results/revision и CI stage gate в Linear UIX-624. Frozen quality завершён; physical-device/full-touch evidence остаётся явно отложенным, а не выданным за PASS. **Merge и production deploy не разрешены этим checkpoint.**

Следующий пул опирается на этот checkpoint, Linear и Git history. Решение — P1 foundation; revision — feature branch относительно указанной базы; changes — 23 файла; verification — §4; открытые gates — full E2E/PR/CI и отдельное hardware/full-touch acceptance. P2–P6 не начинаются автоматически.
