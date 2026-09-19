# Конечный пул: дизайн сервиса и персональные темы

## Граница и остановка

Поручение владельца от 19 сентября: закончить **этот** пул и приостановить
работу. Не переходить затем к производительности, игровым механикам или другим
карточкам backlog. Новые Linear-карточки не создавать. Этот документ — маршрут
выполнения, а не новый источник статусов вместо Linear.

База: локальный `bb875e6dbaf18bfa28fca08825683df1732d504d`, ветка
`codex/project-roadmap-2026-09-18`. Выпущенная версия —
`cce56397a6b1e91fcf2fc6951e506d64b62647cb`; три существующих exact-main CI
35388600458 / 35388600465 / 35388600599 повторно **прочитаны**, все completed /
success на том же SHA. Повторного запуска из-за смены контекста нет.

## Пять существующих задач

| Карточка | Результат для мастера и игроков                                                                                                          | Остаток до приёмки                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UIX-317  | Своя исходная тема, любой опубликованный вариант, предпросмотр, сохранение и возврат к своей теме; прежнее оформление остаётся доступным | Серверная принадлежность и сохранение, runtime, общие состояния, контраст и визуальная матрица всех тем; не один изолированный переключатель                               |
| UIX-644  | Меню, списки и окна открываются, читаются и закрываются предсказуемо, без неправильного перекрытия                                       | Разрешить оставшиеся строки полного реестра 37 групп / 76 мест; исторический observer incident и нативное окно Firefox не считать исправленными только по зелёному повтору |
| UIX-645  | Единые понятные иконки во всех темах, в том числе при фокусе, ошибке и недоступном действии                                              | Проверка опубликованных тем после UIX-317; полный Lucide уже сохранён, повторная загрузка не нужна                                                                         |
| UIX-624  | На узком экране удобно нажимать также поля внутри настроек карты                                                                         | Измерить все доступные поля Grid / Resize / More, исправлять только подтверждённые нарушения; общий компактный shell уже проверен                                          |
| UIX-502  | Выпадающий список внутри окна не обрезается и не теряет владельца                                                                        | Исходные критерии уже имеют evidence; сохранить их регрессию после подключения тем и оформить gate, не переписывать решённую проблему                                      |

UIX-507 имеет evidence по исходным десяти критериям и не становится новым
подпроектом этого пула. Ранее закрытые формы, иерархия действий и айдентика —
потребители общей проверки, а не автоматически переоткрываемые задачи.

## Связанные этапы, без бесконечного добавления работ

1. **Контракт и персональное оформление.** Завершить опубликованный каталог,
   владение настройкой, назначение своей исходной темы, save / reset / preview,
   серверную валидацию и приватность. Не смешивать оформление с игровыми ACL.
2. **Применение к сервису.** Подключить оформление к авторизованному shell,
   общей библиотеке контролов и безопасным canvas-adjacent ролям; сохранить
   цвета игровых данных. Закончить связанные семантические состояния и
   компактные зоны нажатия одним пулом, не тестом после каждого CSS-правила.
3. **Единый приёмочный проход.** Все восемь вариантов плюс system, GM / PLAYER,
   desktop / compact, клавиатура, ошибки / read-only / disabled / pending,
   меню / окно / toast, чат / бросок / карта. Затем точечные проверки
   persistence, reload / re-login, shared-PC и устаревших ответов.
4. **Закрытие и остановка.** Сверить оригинальные критерии каждой карточки,
   записать фактический revision, changed files, receipts и ограничения.
   Только подтверждённые задачи могут получить Done. После завершения пула
   поставить общую работу на паузу; следующий backlog не начинать.

## Решения, которые нельзя принимать скрыто

- **Ответ владельца 19 сентября:** настройка отдельно для игрока в каждой
  кампании. Владелец данных — стабильная membership-запись; имя игрока,
  beta handle, session ID и character ID не заменяют эту идентичность.
- В UIX-317 записан согласованный постепенный переход на Base UI с Button.
  Повторный вопрос о нём признан лишним: первый этап Button входит в пул,
  остальные Gravity-компоненты не переписываются заодно.
- Исходные палитры утверждены ранее; заново придумывать их не нужно.
  `classic-v1` сверяется с сохранённым образцом, не с памятью агента.
- Удалённый override должен безопасно давать system. Отсутствие override
  (`null`) означает собственную тему. Эти состояния не взаимозаменяемы.

## Явно вне пула

- UIX-289: новые анимированные рамки результатов, импорт их исходных
  иллюстраций и редактор назначения. Это отдельная продуктовая функция с
  provenance / asset ACL / reduced-motion критериями; она не объявляется Done.
  Читаемость **существующих** бросков во всех темах остаётся внутри UIX-317.
- Полный mobile P2–P6, физические iOS / Android и touch / pinch — UIX-316,
  а не задним числом добавленные критерии компактного P1 UIX-624.
- Новые игровые сценарии, музыка, контент, декомпозиция приложения,
  производительность, портфолио и новый production-выпуск.

## Ограничения gate

- Владелец разрешил обновлять существующие Linear-карточки; запись stage gate
  в UIX-317 успешно выполнена. Done по-прежнему требует исходных критериев.
- Владелец разрешил публикацию этой ветки и CI. Слияние и новый production
  deploy не входят в разрешение этого пула.
- Один локальный test worker, ограниченные время / память, cleanup своих
  процессов. Финальный связанный browser gate использует два независимых
  worker в том же суммарном лимите4GiB. Доступны все свободные ресурсы по ответу владельца; остаётся
  аварийный запас RAM1GiB. Full suite после каждой правки запрещён. Использовать результаты
  неизменного SHA, не выдавая их за проверку новых файлов.
- `tests/e2e/selection-recovery.spec.ts` остаётся нетронутым и неотслеживаемым;
  исходный SHA256: `7A5AB2F67EA250F787DFAC9AC441CE387CD61C4F9B99AAA48210A935EB6D6D9A`.

## Текущий этап

Контракт / реализация независимых частей. После root review добавлены:

- `PlayerThemeSettings`: реальный shared Select, предпросмотр, явное
  сохранение, обычный (не destructive) сброс, сохранение черновика при ошибке,
  синхронизация успешного сброса даже при уже пустом override, фильтрация
  недоступных вариантов и разделение draft по игроку.
- `usePlayerThemePreference`: независимый от выбранного хранилища controller,
  injected save adapter, отдельные null / system, проверка публикации,
  последовательность revisions, отмена и игнорирование старого ответа при
  смене игрока (включая A → B → A), защита от двойного сохранения.
- `PlayerThemeProvider`: согласованное оформление html и реальной light /
  dark-схемы Gravity; применение до paint и очистка при завершении владельца.
- Семантические состояния полей / сообщений / карты / media, безопасная
  поверхность ошибок вместо непроверенного tinted background. Игровые цвета
  не изменены; отдельные classic-исключения сохраняют прежнее оформление.
  Совместимые имена EntityState/dialog теперь наследуют персональную палитру,
  а не старый светлый текст preview на светлой теме.

**Один адресный gate: 49/49 PASS, 5 файлов, 81.08 s, один worker.** Включает
реальные DOM-контролы, scope/response races и существующую математическую
матрицу 47 контрастных пар каждой из семи палитр. Это не rendered WCAG
certificate всего приложения и не backend persistence. После этого gate
добавлены два source-regression checks семантического CSS и исправлены два
TypeScript-описания fixtures. Последующий controller subset: 8/8 PASS;
финальный CSS/config gate: 16/16 PASS (360 ms). Первая версия CSS guard читала
только geometry-rule класса и ложно падала; исправлен сбор точных selector
rules, семантическое ожидание не ослаблено. Это отдельные receipts, не один
выдуманный общий frozen-run.

App / main, API, БД и production ещё **не подключены** к этим компонентам:
решение владельца о persistence scope и границе Base UI ожидается. Новых
палитр и зависимостей нет. Изолированные компоненты не означают Done UIX-317.

UIX-624 тест дополнен, но новые браузерные измерения не завершены. Причина
первых readiness timeout установлена отдельным probe и чтением entrypoints:
Vite / TypeScript / ESLint зависали на Node compile cache. Process-local
`NODE_DISABLE_COMPILE_CACHE=1` вернул Vite readiness за 1500 ms и работу
компилятора/linter. Кэши не удалены, production / зависимости / правила
проверок не изменены. Артефактный runner теперь фиксирует это окружение.

Повтор нового compact gate с работающим Vite дошёл до первого теста, но
остановлен на **суммарном owned RSS 896 MiB** во время оптимизации зависимостей
и запуска браузера. Это отдельный ресурсный предел, не прежний startup-блокер
и не установленный product FAIL. Лимит не повышен, новых measurements нет.
Нужен разрешённый CI либо отдельно согласованное подходящее окружение;
не повторять неизменённую попытку в том же бюджете.

Финальные **web typecheck и E2E typecheck PASS**. Первый typecheck находил
две ошибки только в новых fixtures; они исправлены. После устранения cache
блокера lint выявил три обращения к ref во время render в controller: заменены
на state-based scope view и обновление refs только в handlers/effects. Правила
не отключались; адресный controller lint PASS. Scoped format и diffcheck PASS.
Browser acceptance и серверное сохранение остаются незакрытыми.

## Checkpoint — последовательная сборка и граница локального браузера

**Ревизия продукта:** `df2d796722e95d699206732066452d010d0e1225`.
Следующие изменения — только документы; продуктовый bundle не менялся.

**Решения.** Не расширять пул и не запускать повторно exact-main CI уже
выпущенной версии. Для экономии RAM сборка отделена от браузера. После
остановки Vite preview заменён минимальным статическим сервером уже собранных
файлов, без нового изменения продукта или ослабления тестов. Оба запуска
браузера всё равно остановлены прежним ограничителем памяти; повторять их
неизменёнными нельзя.

**Изменённые файлы этого этапа:** этот план,
`docs/plans/uix-644-runtime-coverage.json`,
`docs/plans/uix-644-applicability.md`. Временные configs/server/receipts
остаются локальными и не входят в кандидат.

**Проверено:**

- `design-df2-build`: production web build PASS, 4016 modules, 7.87 s;
  timeout180s / owned RSS896MiB. Никакого deploy.
- `compact-built-payload.json`: HTTP200 и точное совпадение SHA256 всех пяти
  файлов HTML / JS / CSS / WebP, включая ленивый renderer. Это подтверждение
  обслуживаемого bundle, не визуальная или игровая приёмка.
- `compact-built-gm` (Vite preview) и `compact-static-gm` (без Vite):
  остановлены по owned RSS896MiB до завершения первого сценария. Новых
  размеров полей и product FAIL/PASS нет. API/WS — только fixture, не live.
- UIX-644: сохранены все 37 buckets / 76 occurrences и исторические статусы
  26 PASS / 2 FAIL / 9 BLOCKED. В восьми смешанных/неактивных группах уточнены
  16 occurrences: пять достижимых с существующим evidence и одиннадцать
  недоступных в текущем продукте. Последние не объявлены runtime PASS;
  каждому оставлены source evidence и условие повторного открытия.

**Блокеры:** ответ владельца о границе персонального сохранения и Base UI;
разрешение на публикацию этого кандидата/CI и ранее запрещённую запись в
Linear; недостающая браузерная приёмка. Для одного последовательного прогона
задан отдельный вопрос о потолке1.5GiB, preflight3GiB free и остановке при
free<1GiB. До ответа эти лимиты не применяются. Исторический ResizeObserver
и нативный popup Firefox остаются незакрытыми, не подменяются зелёным build.

**Следующее действие:** после разрешения подходящего браузерного окружения
получить три GM measurements, исправить только подтверждённую связанную
геометрию и пройти один frozen Chromium/Firefox gate на12 cases. После
продуктового решения подключить темы к правильному серверному владельцу,
затем выполнить единую проверку тем/иконок/меню. Не начинать следующий backlog.

## Возобновление после ответов владельца — 2026-09-19

Предыдущие блокеры решения/публикации/Linear/бюджета RAM сняты явными ответами
владельца. Предыдущий checkpoint сохранён как история, а не текущий запрет.

- Persistence: текущая membership своей кампании, published-only каталог,
  self-only preference projection, revisions/CAS, отдельные null(reset) и system.
- Начальный default назначается и сохраняется стабильно по membership UUID
  из семи утверждённых персональных палитр; это техническое начальное
  назначение, не вывод о предпочтениях человека. Без displayName/handle.
  Мастер может назначить опубликованную исходную тему участнику своей
  кампании; сохранённый пользовательский override этим не перезаписывается.
  Classic доступен в переключателе, не выбирается автоматическим default.
- Параллельные владельцы файлов: server/contracts/db; frontend theme wiring;
  Base UI Button; root — компактные controls, общая интеграция и gate.
- Браузер работает с фиксированным built payload и одним worker; budget4GiB
  при preflight2GiB free, остановке free<1GiB и ограничении времени.
  Запуск `compact-static-gm-authorized` заменяет ресурсно прерванный baseline;
  он ещё не считается успешным до receipt.

## Checkpoint — connected implementation, before browser gate

**Decisions:** the owner's answers above supersede the historical blockers.
The actual App now uses the membership-scoped preference and the real server
adapter. GM default assignment has its own public revision; private player
activity is not exposed through that counter or through the GM preview endpoint.
The first Base UI migration is Button only; other Gravity controls remain.

**Revision:** product changes on top of `dfd07bb`; exact freeze follows this
checkpoint. Files: server theme routes/service/snapshot/seed, contracts catalog,
DB migration0044, App/root/theme settings, shared Button and its consumers,
compact Grid/More sizing, targeted unit/integration/browser tests and docs.

**Verification:** `design-connected-corrected` passed canonical generation,
contracts/DB builds, web/server/E2E types, scoped format/lint (zero errors, two
pre-existing App dependency warnings), **65/65 tests in10 files**, and a frozen
App plus real-control fixture build. One worker; receipt/logs and source hashes
in `selection-closure-2026-09-18`. The first connected run was62/65: a real SQL
constraint mismatch and disabled-link callback were fixed, not waived.
The privacy/default-counter corrections are covered by the same final run.

**Browser baseline:** the authorized compact run completed three GM viewports
and exposed34px grid inputs and18px checkbox labels. Scoped44px fixes are in
this candidate; post-fix browser acceptance is next, not claimed from source.

**Remaining gate:** current built browser matrix; actual-server reload/re-login
and privacy E2E on CI; original menu-ledger limits including the historical RO
incident/native Firefox popup. No task is Done from a build or unit run alone.
Protected untracked selection test remains untouched and excluded. No deployment.

**Next action:** freeze this connected candidate, run the targeted browser gate,
publish the approved branch/PR and use its CI once. Update existing Linear cards
at the acceptance gate; do not start a new backlog pool.

## Checkpoint — connected correction before final browser acceptance

**Revision:** published `b51a18c`, local `7f15cb4` plus the explicitly staged
correction below. Draft PR85: https://github.com/uixray/arken-space/pull/85.
No merge or deployment of this design candidate is authorized or performed.

**Verified CI on b51 only:** checks35407076062:2411 PASS/9 FAIL;
E2E35407076074:993 PASS/29 SKIP/62 FAIL; multiplayer35407076077:PASS.
All browser failures fall into three known classes: media-backed theme icons,
default-theme selection focus, and the real-server test's player-picker locator.
The latter reached GM assignment after actual player save/reload/re-login/reset/
system succeeded, but the whole persistence case is NOT a PASS.

**Corrections:** opaque personal-theme HUD surfaces (no canvas/game palette
change); shared Select restores only its own lost selection focus and preserves
consumer-owned dialogs/other inputs; actual accessible combobox locators;
TypeScript dotted-basename source-closure resolution; schema CHECK/snapshot0044,
route/probe inventory and the two new menu rows in the39/78 runtime ledger.
Historical37/76 evidence, RO incident and native Firefox gaps remain immutable.

**Files:** theme bridge, shared FormSelect and DOM tests; DB schema/snapshot;
source-closure guard/tests; campaign route inventory and executable isolation
probe; browser preference/persistence/contrast tests; menu ledger and foundation
documentation. New role/viewport/all-theme chat/critical-roll/dialog screenshot
cases are acceptance coverage, not a new feature or an all-surface WCAG claim.

**Local verification:** first corrective gate103/108 PASS; failures were ledger
placement, the missing executable route probe, and one local startup timeout.
The corrected inventory/focus gate29/29 PASS, plus executable inventory1/1 and
the new real PGlite cross-campaign boundary1/1 PASS; scoped lint/format and
web/E2E types PASS. The earlier other seven files remain unchanged and green.
These are separate receipts, not a fabricated combined run. All artifacts live
under `selection-closure-2026-09-18` in the session artifact directory.

**Next:** freeze the corrected source; normal single-entry product build and
separate control fixture; two disjoint browser batches on those exact bytes,
then one coordinated branch update/CI. Close only existing issues whose original
criteria are actually met. Broader UIX-317 surface/first-paint criteria and
UIX-644 historical/manual boundaries cannot be waived by a green build.
Protected untracked group-selection test remains unchanged and excluded.

## Checkpoint — final local acceptance and critical-text correction

**Revision / decision:** PR85 candidate `4f3ee38fd6bd8e32fcd4354f9e5e99f9d7b52a86`
passed checks35410244349 and multiplayer35410244362. E2E35410244501 is still
running; it has not been restarted. The next connected commit contains only
the confirmed light-theme critical-text correction and its acceptance coverage.
Do not repeat the earlier successful release of `cce56397`.

**Local evidence:** 116 unique browser cases passed in disjoint batches on the
same v5 product bytes: critical14 (individual passing cases before a fixture
diagnostic stop), remaining92, Firefox token2 and surfaces8. The stopped batch
itself is NOT a successful complete run. No retries/flaky waivers were used.
All source revisions, stdout, JSON and bounded-process receipts are retained
under the session artifact directory's `selection-closure-2026-09-18`.

**Final correction:** screenshot review found real low-contrast critical text
on light cards: failure2.87:1 and success1.86:1. The new rendered regression
failed against immutable v5 on that defect, then passed against v6: failure
5.655:1 and success13.461:1. Only six text targets in the light theme change;
colored outcome borders, game colors, classic/system and dark palettes do not.
Files: `player-theme-gravity.css`, `tests/player-theme-contrast.test.ts`,
`tests/e2e/player-theme-surfaces.spec.ts`. The first new source guard failed on
Windows CRLF parsing; whitespace normalization fixed the guard, not its target.

**Verification:** scoped lint/types and17/17 contrast/source tests PASS; normal
single-entry product build plus separate fixtures PASS; final v6 surface matrix
8/8 PASS (Chrome/Firefox, GM/PLAYER,1280/390, nine theme choices per case),
144 raw screenshots and eight critical-text measurement receipts. Bundle audit
v6 PASS:47 named emitted icons within48 allowed /2066 installed, no dynamic
registry, emitted Lucide network calls or icon CDN. Both v5/v6 reports preserved.
New `MemberDefaultThemeField.test.tsx`:3/3 real-component cases PASS, scoped
lint/web types PASS. Pending controls, generic error/draft preservation, actual
409 conflict alert, adopted theme/revision and next-save revision are covered.
The earlier agent runner's inconclusive startup is not counted as a test pass.

**Remaining acceptance:** await the already-running real-server E2E, then publish
this single final correction and use its exact CI. UIX-624/502/645 can close only
at the resulting evidence gate. UIX-317 still must not be presented as an
all-surface rendered WCAG, no-first-paint-flash or physical-device certificate.
UIX-644 keeps the original ResizeObserver causal-reproduction and headed native
Firefox gaps; passing current token menus does not erase historical failures.
No new cards, gameplay backlog, merge or deployment. Stop after this finite pool.

### Exact-CI result and final scroll-test settlement correction

E2E35410244501 on `4f3ee38` finished1062 PASS/29 SKIP/1 FLAKY, zero
permanent failures. Both real-server personal-theme persistence cases PASS.
The workflow correctly remains red because Firefox360 journal geometry passed
only on retry; that retry is not accepted as a green gate.

Its retained trace proves keyboard End was still moving the controls scrollport:
scrollTop347 at62476ms,368 at62493ms, while the old test sampled its target and
owner through separate async bounding-box calls. The target was14px above the
allowed edge. No product CSS was changed for this test race. The existing
`compact-journal-budget.spec.ts` now waits for the actual End destination, then
reads both rectangles atomically with bounded assertion polling. All44px minima,
160px journal budget and existing1px containment tolerances remain unchanged;
there is no repeated interaction or extra test retry in that poll.

Local diagnostic reused the exact captured CI PLAYER snapshot against v6 and
the current assertion helper:17 consecutive Firefox360 repetitions PASS, no
assertion failure, then the240s whole-process budget stopped the20-repeat run.
This is partial repetition evidence, not a successful20-test complete run and
not backend/authentication acceptance. Temporary fixture source and trace stay
in session artifacts, excluded from Git. The next exact CI is authoritative.
