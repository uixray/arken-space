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

## 2026-09-16 — 360 px map action targets (local continuation)

Candidate based on `d451abe`; this does not replace the full P1/mobile acceptance.

- Actual App audit of enabled visible buttons, summaries and tabs in the map and
  journal exposed map actions at 24–36 px wide / 28–32 px high. The prior journal
  rules did not cover the map's separate dice tray, toolbar and HUD.
- Compact main-content actions now use a 44×44 minimum, with no desktop change.
  Zoom starts below the enlarged object-list trigger; its vertical range target
  is widened. The tool column reserves the bottom token row and scrolls within
  its existing bounds instead of intercepting the token trigger.
- Compact tool menus use fixed viewport-bounded positioning outside that scroll
  column, with the existing popup tier while open (below workspace/modal tiers).
  They are not moved to a new portal or made globally topmost.
- `compact-action-targets.spec.ts`: 4/4 PASS, GM/PLAYER at 360×850, Chrome/Firefox.
  Enumerates every enabled visible button/summary/tab in these fixture surfaces,
  scrolls each into view, checks >=44 dimensions and center hit-testing, checks
  document horizontal overflow and zero game HTTP writes. GM also opens the real
  More menu, hit-tests its checkbox and closes it with Escape/focus return.
- Red evidence preserved: initial undersized actions; first CSS selector missed
  sibling controls; corrected scope exposed token-trigger interception. The first
  added popup check mistakenly expected a button where the actual GM-only menu
  has checkboxes; corrected fixture checks the real existing input, no role bypass.
- Final evidence: `compact-targets-gate/browser-05.log` (4 PASS,31s) and screenshots.
  The PLAYER Chromium map screenshot was visually inspected; the fixture has no
  map image/characters, so this is not visual/content acceptance of a full game.
  Prettier, scoped test ESLint and git whitespace checks pass. CSS-only runtime
  change: no repeated web typecheck, production build or full CI in this slice.
- Open: short-height/landscape, character/invite/handoff and populated workspaces,
  disabled controls, checkbox/range targets beyond this scope, every tool popup,
  physical touch/browser zoom, desktop and integrated release gate. No task Done,
  Linear write, push or deploy. Selection-recovery remains untracked and untouched.

## 2026-09-16 — short portrait and landscape map controls

Follow-up to `5ea2c0f`, not acceptance by extrapolation from the 850px-tall screen.

- At 360×640, the map dice panel intercepted Minus and Fit. At 640×360,
  non-scrolling toolbar chrome consumed the available height and left the inner
  tool group effectively unreachable. Both failed real center hit-testing.
- Compact map dice remain complete in a single independently scrolling row,
  rather than a tall overlay. At <=480px viewport height, zoom uses a horizontal
  range/row. The whole compact toolbar scrolls, including its chrome, instead of
  shrinking only the tool group. Popup placement outside the scrollport remains.
- Existing target spec now includes 360×640 and 640×360. Only the eight new
  role/browser cases ran in the final slice: 8/8 PASS (59s), Chromium/Firefox,
  GM/PLAYER, map+journal enabled visible buttons/summaries/tabs >=44 and hit-test,
  no document horizontal overflow or game HTTP mutation. Every control is
  scrolled into view before measurement; this does not mean all are simultaneous.
- GM cases additionally use actual grid numeric input, resize-mode button and
  More checkbox: open by ordinary pointer click, hit-test, Escape, trigger focus.
  Initial added resize test wrongly expected an input; corrected against actual
  source, not by skipping the menu or using force.
- PLAYER Chromium landscape screenshot was inspected (the empty scene is a
  fixture, not a full game visual acceptance). Evidence: `compact-short-gate`,
  browser-01/02 reproductions, browser-03 selector error, browser-04 final8 PASS.
  Prettier, scoped ESLint and whitespace checks PASS. CSS-only runtime change;
  typecheck/build/full CI deferred to the connected delivery gate, not waived.
- Not yet proven: physical orientation changes/software keyboard, populated
  character surfaces, all input touch targets, zoom-value interaction, or a real
  multiplayer session. The tests start in each viewport; they do not prove a
  live in-session rotation retained state. No publication/deploy or Linear Done.

## 2026-09-16 — PLAYER sheet, pending text and inner overflow

Local continuation from `e9d8017`. Real App/CharacterWorkspace with an owned
PLAYER character, name, one stat, wallet values and backstory; not a full
inventory/skills/media/authorization fixture.

- New `compact-player-sheet.spec.ts` found wallet +/- controls at 40×44; compact
  sheet buttons/summaries now have the full 44×44 minimum, not only height.
- The first green geometry pass did NOT prove visual fit: screenshot inspection
  revealed backstory clipped beyond the right edge. Document scrollWidth was
  360, but the sheet's inner body was ~406 and textarea right edge ~398.
  Added actual control bounds and inner ancestor scroll-width checks.
- Setting only body min-width did not fix the implicit grid track. Compact sheet
  cards now explicitly use `grid-template-columns: minmax(0, 1fr)`, with body
  min-width:0; text reflows within the card instead of masking overflow.
- Final 2/2 PASS (24.3s), Chromium/Firefox. Both actually resize the same session
  360×640→640×360→360×640, audit enabled visible sheet buttons/summaries via
  dimensions and center hit-testing after scrolling, then type backstory,
  hold its PATCH response, visit Journal and return after resize. Text remains
  intact, exactly one captured backstory request precedes return, no unexpected
  writes. The held response is released only for cleanup: no durable-server save
  or post-ack convergence claim. Ownership is ordinary fixture data, not ACL bypass.
- Final PLAYER Chromium screenshot visually checked: field fits and wraps.
  Evidence `compact-player-gate/browser-01` (40px red), `browser-02` (earlier weak
  pass), `browser-03` (inner clipping red), `browser-04` (body-only fix insufficient),
  `browser-05` (final2 PASS). One PowerShell quote syntax failure ran no test.
- Scoped ESLint/Prettier/diffcheck PASS; no full suite/build/typecheck rerun for
  the CSS-only runtime change. Existing character queue regression not replayed.
  No publication/deploy/Linear Done. All-skills/inventory/dialog controls, real
  device keyboard/touch, other roles/characters and integrated CI remain open.

## 2026-09-16 — integrated built-candidate UI gate

Exact runtime candidate: `8504feac439ec0d68d473b13f7149b53ce47a3ba`.
This supersedes the older `508167f` compiled UI evidence for the covered cases,
not the separate production release or whole mobile acceptance.

- One web typecheck (768 MiB) and one Vite production build PASS. Saved the full
  dist and seven-file SHA256 manifest; copied artifact hashes verified afterward.
- One sequential browser gate against **vite preview of production dist**, not
  the development server: 34 expected, 0 skipped, 0 unexpected, 0 flaky;
  retries0/workers1, Chromium+Firefox, duration167.926s. Existing unchanged CI was
  not restarted and no backend/full test suite was launched.
- Covered: compact enabled action dimensions/hit-testing at360×850,360×640,640×360
  for GM/PLAYER; grid/resize/More popup reachability; actual PLAYER sheet pending
  backstory and viewport/navigation transitions; Escape ownership vs workspaces
  and blocking dialogs; responsive menu hidden-state cleanup; desktop/compact
  SVG/icon-button contracts. These are five existing focused specs, no weakened
  assertions or newly skipped cases. Synthetic API/socket fixtures throughout.
- Receipt folder `ui-integrated-8504fea` in the current local artifact root:
  revision.txt, types.log, build.log, payload-sha256.json, dist/, results.json,
  browser-01.log and browser-01/ artifacts. JSON results preserve per-test records
  and diagnostic attachments instead of relying only on a dot-reporter count.
- MainJS1076454bytes, CSS296536bytes, lazy renderer364587bytes; Vite's >500kB chunk
  warning remains, not hidden by changing limits. This is build-size evidence,
  not a device performance/latency acceptance or an optimization claim.
- Preview stopped after the gate. No source edits during build/QA, no publication,
  deploy, production mutation or Linear write. Untracked selection test preserved.
- Still required: remaining original UI624/316 and UI644 inventories/roles/states,
  physical-device/human acceptance, complete backend/persistence/multiplayer and
  exact integrated CI/release gates. A local built UI pass does not close these.

## 2026-09-17 — current real-server entry/navigation/handoff gate

Tested revision `9d019e95d92137265cd8a33a82852acb9eca3284`, unchanged
`tests/e2e/mobile-foundation.spec.ts`:12/12PASS195.941s, one worker, retries0,
no skips/flaky/unexpected. Eight GM/PLAYER ×360×800/820×1180 ×Chrome/Firefox
journeys plus four desktop-first character/compact-preview cases.

This time authentication, invitations, session cookies, bootstrap, chat writes,
read cursors and realtime delivery used the actual current source API and isolated
PostgreSQL18.1, not intercepted HTTP/socket responses. Reused only our stopped
request-server-gate cluster (127.0.0.1:15439), API14109 and Vite5189; all listeners
verified loopback. Per-test campaigns are created by the existing campaign fixture.
Health reported databaseok, schema2 and the exact tested SHA.

Verified within the existing assertions:

- Actual GM entry and PLAYER invitation/name/keyboard entry.
- Compact map/journal/character navigation, checked controls44px, no measured
  document overflow, hidden/inert roots excluded from keyboard navigation.
- Desktop collapse preference, canvas identity/zoom, journal reader position,
  composer/resource drafts retained across surface/viewport changes.
- Messages from a separate authenticated context arrive through real sockets;
  hidden journal does not submit read acknowledgements, reopening does.
- Nested rename and handoff confirmations own focus; cancelling preserves draft.
  Confirmed exit unmounts game roots, bootstrap returns401 and reload stays signed
  out. This does not prove a subsequent different player's entire session.

Evidence: mobile-real-gate/results.json and8decoded geometry receipts (21measurements
per GM /25per PLAYER), browser/vite config and loopback source copy. Source server
logs are local only and may contain synthetic authentication URLs. Free RAM during
run was approximately2.4GiB. Existing Konva6/7-layer warnings remain; this is not an
all-console-clean or performance acceptance claim.

Cleanup: own API/Vite stopped, isolated PG fast-stop succeeded, ports15439/14109/5189
no longer listen; existing postgresql-x64-18 service remainsRunning. Temporary API
entry removed via exact verified path. Original untracked selection test unchanged.

Limits: development/source runtime, not current production bundle/GitHubPG17 CI,
physical touch/Safari/software keyboard, full P2–P6, new-player cross-session privacy
matrix or release acceptance. No product/test changes, full suite/build/release
rerun, publication or Linear write; UIX-624 remains under original full criteria.

## 2026-09-17 — full shared-browser A→B real-server gate

Extended the existing multiplayer shared-browser test, rather than duplicating
authentication: manually created browser context now honors the configured
viewport; per-run names are unique and remain under the40-character input limit.
PlayerA types an unsent composer draft before handoff; after PlayerB enters the
same browser with their own invitation, the composer must be empty. Wait for the
actual shell before choosing compact navigation, not a one-shot visibility query
while login is still pending. Original session/socket/projection assertions remain.

Final4/4PASS40.685s:Chrome/Firefox ×1280/360,worker1,retries0,real isolated API/PG.
All receipts prove actor identity changed, prior private note absent, old action
401, new action201 and empty new draft. Existing assertions also verify A socket
disconnect, bootstrap401 after logout, B-only full character data and the deliberate
public identity-only projection of A. This is not a promise to hide character
names that the campaign intentionally exposes.

Harness corrections, not product failures: initial retained DB lacked the static
multiplayer credential; preparation now used a separate synthetic campaign without
changing existing credentials. An inline tsx command silently did not prepare it;
an explicit file did. First unique names exceeded40chars and were truncated by the
real input; shortened tags preserve exact identity assertions. Compact test initially
queried navigation before shell readiness. Two later attempts lost their Vite process
(exit1, cause not established). Final gate owned a hidden Vite child in the same
PowerShell try/finally as the test, with separate stdout/stderr and guaranteed stop;
it was alive until intentional cleanup. Retained earlier reports are not product REDs.

Targeted TypeScript exposed pre-existing multiplayer helper errors: expectOk now
retains the generic response type while requiring only used ok/status/text methods
(browser Response as well as APIResponse); two encounter predicates treat an absent
optional collection as not-yet-matched, retaining the required ACTIVE/ENDED predicate.
Scoped tsc/ESLint/format/diffPASS. Full GM+6 scenario was not rerun or claimed covered.

Evidence:shared-mobile-gate/owned-results.json,receipts.json,configs and logs.
Own API/PG stopped; frontend stopped in finally; ports15439/14109/5189 absent and
user PostgreSQL service remainsRunning. No product code, deployment, full suite,
new cards or Linear write. This covers real A→B entry/privacy at two viewport sizes,
not physical hardware, every private surface or personal-theme persistence.

## 2026-09-17 — close native map settings when their owner is hidden

A real built-app regression was reproduced at 360×850 GM: open grid settings,
focus compact Journal navigation and press Enter. The map becomes hidden/inert,
but `<details open>` survived because keyboard navigation emits no outside
pointerdown and no resize. This could revive stale settings on returning to Map.

`useDismissibleDetails` now observes only `hidden`/`inert` on the details element
and its current ancestor chain, and only while open. Initial hidden owners close
immediately; removal of an attribute does not close a visible menu. Toggle/close/
unmount disconnect the observer; stale ref callbacks cannot close a replacement.
The observer never focuses a hidden summary. Existing Escape ownership and
viewport behavior remain unchanged; no ResizeObserver or whole-document subtree
watcher was added. No gameplay mutations, layout redesign or new navigation.

Focused helper/DOM gate: **19/19 PASS**, including hidden and inert changes,
reopen, initial hidden owner, removal-only records and focus preservation.
Web/E2E types, scoped lint and diff checks passed. One fresh web build4.29s;
four served runtime hashes verified in the pool. Browser results are recorded in
compact-owner-hide/checkpoint.md and the final report under the current artifact
base, separate from the initial red and intermediate harness failure.

The intermediate fixed run passed the closing assertion but exposed an incorrect
new test expectation: compact navigation intentionally restores focus inside the
new surface (useCompactNavigation), not permanently on its navigation button.
The test now verifies focus inside the active non-hidden/non-inert surface and
that the old settings remain closed after return. Product focus policy was not
changed or weakened. No full-suite/remote CI rerun, publication or Linear update;
UIX-624 and UIX-644 retain their remaining original gates.

Final connected browser gate: **24/24 PASS** Chrome/Firefox, one worker,
retries0/skipped0/flaky0. Includes compact GM/PLAYER map/journal targets at
360×850,360×640,640×360 (12 cases), mixed popup/modal Escape ownership at
1280/390 (8), desktop→compact→desktop lifecycle (4). New keyboard hiding cases
cover both grid and resize settings, active-surface focus and no stale reopening.
This is synthetic App/browser behavior, not live multiplayer or physical devices.
