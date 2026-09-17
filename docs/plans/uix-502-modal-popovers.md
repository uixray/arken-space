# UIX-502 — modal-owned dropdowns

## Замер

PR #58 устраняет видимый дефект: внешний Floating UI wrapper Gravity Select поднят над modal, и hit-test проходит. Но правило глобально поднимает любой `.g-select-popup` до dialog+1, не различая owner workspace/modal, зависит от приватной DOM-структуры и не доказывает keyboard, focus, narrow placement или nested dialog lifecycle.

## План

1. Добавить контекст overlay-owner в `ArkenDialog`: modal или workspace.
2. Провести Gravity Select через общий wrapper, который назначает popup class по owner; мигрировать raw Select в FeedbackReporter.
3. Ограничить CSS Floating wrapper scoped modal popup вместо глобального `.g-select-popup`; workspace popup не должен обгонять modal.
4. Расширить существующий token-editor browser flow на desktop и narrow: hit-test/clipping, keyboard Enter, Escape/outside dismiss, focus return, переход к nested dialog.
5. Выполнить адресную диверсию по modal popup layer и связанный UI gate. Production-сервер не используется.

## Зависимость

Ветка stacked на PR #58, где находится проверенный hotfix внешнего Floating wrapper. Merge и publication выполняются позже отдельным scope.

## Чекпоинт реализации

- Решение: владелец overlay передаётся контекстом `base | workspace | modal`; общий `FormSelect` маркирует popup классом владельца, а CSS поднимает только внешний Floating UI wrapper соответствующего слоя.
- Слои: workspace-select остаётся выше плавающих рабочих окон, но ниже dialog; modal-select расположен на `dialog + 1`. Глобальное повышение всех `.g-select-popup` удалено.
- Изменённые файлы: `FeedbackReporter.tsx`, `ArkenDialog.tsx`, `GravityFormControls.tsx`, `gravity-foundation.css`, новые `overlay-owner.ts` и `overlay-owner.test.ts`, браузерная регрессия в `tests/e2e/token-generator.spec.ts`.
- Проверка: unit owner tests 2/2 PASS; web typecheck PASS; адресные ESLint, Prettier и `git diff --check` PASS; UIX-502 Playwright desktop+narrow в Chromium+Firefox 4/4 PASS.
- Диверсия: временное понижение modal popup до общего popup-layer изолированно уронило Chromium desktop UIX-502 на hit-test (`Expected true, Received false`); после теста исходный CSS восстановлен побайтно, нормальный прогон остаётся зелёным.
- Среда: первая попытка Playwright была остановлена Windows `EPERM` на `.last-run.json`; повтор с отдельным output-каталогом прошёл. Docker и production не использовались.
- Блокеры: нет. Следующее действие — commit, push, stacked PR и перевод Linear в In Review.

## Возобновление — регрессия workspace popup, 05.09.2026

- Исходная ревизия: `3c685a0`; свежая база PR #58 `34ccd8a` влита обычным
  merge-коммитом `b4ee2aa`. `origin/main` остаётся `f1a66c8`.
- Воспроизведение: исходный Chromium workspace hit-test падает именно на
  `Expected true / Received false`, как GitHub E2E PR #63.
- Замер до правки: внешний Floating UI wrapper имеет computed `z-index: auto`,
  workspace — `1204`; `CSS.supports("z-index", "1999.5")` возвращает `false`.
  В центре option `elementFromPoint` возвращает чужой `SPAN.g-button__text`.
  Предки workspace не создают дополнительного stacking context.
- Решение: только целочисленные слои — workspace `1200…1998`, его popup
  `1999`, blocking modal `2000`, modal popup `2001`. Контекст владельца и
  портал не переписываются; устранена подтверждённая невалидная CSS-величина.
- Файлы: `apps/web/src/ui/gravity-foundation.css`,
  `apps/web/src/ui/useWorkspaceWindow.ts`,
  `tests/e2e/scene-workspace-dialog.spec.ts`, этот checkpoint и
  `docs/current-state.md`.
- Регрессия проверяет реальный hit-test и выбор option при обычном открытии и
  после насыщения счётчика поднятия workspace. Между workspace и dialog должен
  оставаться отдельный целочисленный popup-слой; замеры прилагаются к трассе.
- Уточнение границы прежних доказательств: переход из token picker в
  «Подготовку» проверяет закрытие popup и смену workspace, а не одновременно
  открытый nested modal. Строгая иерархия произвольных вложенных modal с
  сохраняющимся открытым popup пока не доказана. Подтверждённого отдельного
  runtime-дефекта в таком сценарии нет; архитектура не расширяется вслепую.
- Проверки: восстановленный popup-пул Chromium+Firefox — **8/8 PASS** без
  retries (workspace normal/cap, FeedbackReporter, token modal desktop/narrow).
  Замеры после правки: normal `1204 < 1999 < 2000`, saturated
  `1998 < 1999 < 2000` после 832 событий pointerdown.
- Диверсии — три изолированных ожидаемых FAIL, после каждого исходники
  восстановлены побайтно:
  - возврат popup `1999.5` роняет normal-phase integer assertion;
  - возврат workspace cap `1999` роняет saturated-phase strict ordering;
  - понижение modal popup до `1000` роняет desktop token modal hit-test.
- Артефакты: `%TEMP%/arken502-diversion-{fractional,cap,modal}.log` и
  одноимённые output-каталоги с трассами;
  `%TEMP%/arken502-restored-pool.log` — итоговый зелёный browser-пул.
- Полный quality gate выполняется; полный GitHub gate после push обязателен.
  До его завершения PR не считается зелёным.
- Merge PR, публикация и production-данные не использовались.

## Checkpoint — 2026-09-08, одновременные владельцы modal

- **Ревизия и граница:** локальный acceptance-срез в
  `codex/uix-502-overlay-acceptance` от `main` `3f6b7c4`. Это следующий
  существующий Review, не новая задача Backlog. Код production-компонентов,
  их owner-контекст, стили, API и правила доступа не меняются.
- **Точность прежнего App-доказательства:** Select в редакторе токена выбирает
  **персонажа**, не изображение. Изображение теперь выбирается встроенным
  `AssetPicker`; там нет popup/портала. Переход в «Подготовку» закрывает
  редактор и открывает workspace, а не оставляет два modal одновременно.
  Основной исполнитель отдельно уточняет этот существующий App-тест и
  проверку встроенного picker; данная фикстура не подменяет его.
- **Решение:** отдельная test-only HTML-точка входа использует настоящие
  `ArkenDialog`, `FormSelect` из `GravityFormControls`, обычные Theme/Toaster
  providers и production CSS в том же порядке, что `main.tsx`. Файлы лежат
  в `apps/web/tests/fixtures/modal-owner/`, вне `src`, без ссылки из build
  entry. Это обычная страница dev-server; Vite config, package и lockfile
  не изменяются. Отсутствие фикстуры в production output проверяет общий gate.
- **Стимул:** обычная кнопка A ожидает fixture-only GET. Браузерный тест держит
  ответ до фактически открытого popup A, проверенного указателем, и только
  затем завершает запрос. React открывает B, не удаляя A. Нет setters в App,
  `force`-кликов, принудительного `open` Select, своего focus trap, portal
  target или дополнительных z-index. Топологии sibling и React-nested
  выражены композицией настоящих компонентов и проверяются отдельно.
- **Новые файлы:** `apps/web/tests/fixtures/modal-owner/index.html`,
  `main.tsx`, локальный `tsconfig.json`,
  `tests/e2e/modal-owner-contract.spec.ts`; изменён этот checkpoint.
- **Подготовленный oracle:** перед открытием B настоящий popup A связан с
  trigger через `aria-controls`, видим, помещается в viewport и принимает
  указатель. B-кнопка должна действительно пересекать прежний прямоугольник
  popup A; проверяются hit-test точки пересечения и обычный клик со счётчиком.
  Без пересечения тест не засчитывается. Автоматическое закрытие popup A
  допустимо; если он остался смонтирован, его options не должны принимать
  указатель поверх B. Background A может стать aria-hidden — проверяется
  сохранение его DOM, не доступность фонового owner.
- **Фокус и очистка:** закрытый Select B — строгие 8 Tab и 8 Shift+Tab через
  существующий `assertModalFocusCycle`. Открытый popup B — отдельная проверка
  области B и именно его связанного popup, ArrowDown/Enter и сохранение
  значения. Escape сначала закрывает popup, затем B, сохраняя A; фокус должен
  вернуться на реально сфокусированный перед completion trigger A.
  Проверяются удаление B-портала/guards, отсутствие самопроизвольного
  возвращения A-popup, повторный реальный выбор в A и окончательная очистка.
  Счётчик A не меняется во время действий B. Нет backend-запросов, pageerror
  или Vite error overlay; существующий React console guard не ослабляется.
- **Диагностика:** PNG сохраняются по `testInfo.outputPath`; JSON содержит
  геометрию старого popup/нового действия, пересечение и hit target, цепочки
  stacking context до/после B и с его popup, полный focus transcript и ошибки.
  Числа CSS используются только для диагностики, не вместо pointer/focus.
- **Проверка пока NOT RUN:** восемь contract-комбинаций
  sibling/nested × 1280×900/390×844 × Chromium/Firefox; вместе с четырьмя
  существующими уточнёнными App-сценариями gate выполняет основной исполнитель
  после заморозки. Отдельная проверка типов фикстуры:
  `pnpm exec tsc -p apps/web/tests/fixtures/modal-owner/tsconfig.json`.
  Локальный tsconfig нужен потому, что e2e tsconfig не включает JSX.
- **Оставшаяся граница:** contract fixture проверяет определённый lifecycle
  настоящих компонентов, не найденный естественный маршрут App и не
  произвольную глубину вложенности. До первого результата нельзя объявлять
  ни PASS, ни подтверждённый продуктовый дефект. Полное закрытие UIX-502
  требует соответствия согласованным критериям; публикация сама их не заменяет.
- **Дальше:** общий browser/quality gate, разбор фактического результата и
  точный stage-gate итог. Исполнитель фикстуры не запускал dev-server/тесты,
  не делал commit/push, изменений Linear или production.

### Первая baseline-проверка и точная коррекция фикстуры

- Общие build/format/lint/typecheck и отдельный fixture typecheck прошли у
  основного исполнителя; fixture не включён в production dist.
- Все восемь contract-сценариев остановились **до открытия B** на одном
  strict locator: UIKit присваивает ID из trigger `aria-controls` одновременно
  внешнему `.g-list__items` и вложенному `role="listbox"`. Это подтверждено
  snapshot ошибки и установленным кодом UIKit; результат не доказывает
  дефект наложения, фокуса или nested-modal lifecycle.
- Исправлен только test helper: точное значение `aria-controls` дополнено
  `role="listbox"` и явным требованием единственного совпадения. Такой же
  строгий выбор используется в focus-recorder B вместо `getElementById`.
  Нет `.first()`/`.last()`, расширения допустимого владельца, изменения UI
  или ослабления последующих geometry/focus/cleanup assertions.
- Старые failed receipts сохранены. Следующий общий прогон выполняет основной
  исполнитель после заморозки обеих test-only коррекций; PASS пока не заявлен.

## Итоговый acceptance gate — 08.09.2026

- **Ревизия:** локальный test-only пул `codex/uix-502-overlay-acceptance` от
  `3f6b7c4`. Production overlay-компоненты и стили совпадают с опубликованным
  `main` `6b2c8c9`; менять runtime для этого gate не потребовалось.
- **Файлы:** test-only HTML/TSX/tsconfig в
  `apps/web/tests/fixtures/modal-owner/`, новый
  `tests/e2e/modal-owner-contract.spec.ts`, уточнённый App-сценарий
  `tests/e2e/token-generator.spec.ts`, этот checkpoint — шесть файлов.
- **Проверка:** общий build/format/lint/typecheck и отдельный fixture typecheck
  PASS; четыре существующих lint warning. Проверено отсутствие fixture entry
  и его endpoint-маркера в production dist. Новый полный Vitest не повторялся:
  production и unit/integration source не менялись; база имеет проверенный
  полный gate 234 файла / 1880 тестов.
- **Браузер:** восстановленный связанный пул **12/12 PASS**, Chromium/Firefox,
  desktop/390, один worker, без retries, 1.8 минуты. Восемь contract-комбинаций
  sibling/nested и четыре настоящих App-сценария.
- **Фактический lifecycle:** во всех восьми комбинациях popup A автоматически
  закрывается при появлении B. Прежний rectangle A действительно пересекается
  с кнопкой B; B получает pointer, счётчик A не меняется. Строгие 8 Tab и
  8 Shift+Tab, собственный popup B, Arrow/Enter, Escape по уровням, возврат
  фокуса, отсутствие порталов/guards и повторное открытие A проходят.
  PNG и JSON сохраняются; четыре репрезентативных комбинации просмотрены
  визуально. Это проверка двух уровней настоящих production-компонентов,
  а не обещание произвольной глубины или найденный естественный App-маршрут.
- **Исторический image AC:** текущий AssetPicker в редакторе inline.
  App-регрессия теперь отдельно проверяет его реальный hit/границы,
  pointer/Arrow/Enter и сохранение выбора, затем настоящий popup поля
  «Персонаж». Переход в «Подготовку» правильно отмечен как смена workspace
  после закрытия редактора, не nested modal.
- **Причины первого FAIL:** восемь contract-тестов остановились до B из-за
  двух Gravity DOM-узлов с одним id; helper теперь требует точный
  `aria-controls` плюс единственный `role=listbox`, без first/last.
  Четыре App-теста прошли UI-assertions, но recorder обнаружил ожидаемый
  автоматический `POST /api/chat/read`; он тоже заблокирован, а все прочие
  записи запрещены. Ни один запрос записи не направляется в реальный backend.
  Эти изменения исправляют фикстуры, не ослабляют продуктовые assertions.
- **Решение и дальше:** точный недостающий concurrent-modal gate выполнен;
  новая регрессия подготовлена для следующей GitHub-интеграции. Сам этот
  локальный пул не публиковался и не менял production. Широкий UIX-644
  и отдельные задачи ручной/mobile-приёмки этим не закрываются.

## 2026-09-16 — revalidation using existing release evidence

Live UIX-502 remains In Review. Existing exact-main CI `35043939211` was read,
not restarted: SHA `7f28ca399ec0530e55e6bd41d4427ea23150522b`, both browser jobs
successful (Chromium239 passed/2 skipped; Firefox238 passed/3 skipped).
The modal-owner contract, close-lifecycle and token-generator scenarios, dialog
ownership implementation and styles have no diff from that released revision.
The current form-wrapper change is confined to checkbox forwarding, not Select.

Downloaded modal-owner receipts from that run contain all eight combinations of
sibling/nested ×1280/390 ×Chrome/Firefox. Each final diagnostic has zero page
errors, zero unexpected API requests, zero leftover layers and29 focus events.
The existing assertions cover actual overlapping hit targets, focus cycles,
Arrow/Enter, Escape levels, owner focus return and cleanup. This reuses release
evidence rather than re-running browser tests because the chat changed.

The generic synthetic-acceptance artifacts were also inspected: they do not
contain token-modal-character-popup PNGs. Do not claim those images were viewed
in this audit. The historical September8 App acceptance report and unchanged
source remain available; the downloaded CI log uses summary output and does not
individually name the token-modal cases. Whole UIX-644, arbitrary nesting depth
and physical-device acceptance are not inferred from the owner-fixture receipts.
No Linear state change was attempted because the earlier external-write approval
is unresolved. This evidence audit is not an assertion that every open project
issue is ready for closure.

## 2026-09-16 — current Select integration acceptance

After the shared Select contract fix, the existing connected browser pool was
run against `0e3e3c723207b980082214217b3c4e1b9cb32399`: 12/12 PASS in 1.4 minutes,
Chrome/Firefox, desktop/390px, one worker and zero retries. This is a fresh local
candidate gate, not a claim that old CI covered the new Select code.

Eight sibling/nested owner cases report zero popup-focus violations, page errors,
unexpected API requests and leftover layers. Four real App token-editor cases
verify the inline image picker and character popup, hit testing and viewport
bounds, outside click, keyboard selection, Escape and focus return. The narrow
Chrome token-popup screenshot was visually inspected. No assertion or runtime
code was changed to obtain these passes. Source and test fixtures are the existing
ones; synthetic API does not establish backend permissions or production playtest.

The stated UIX-502 local acceptance matrix passes for this candidate. Wider
UIX-644 menus, personal themes, arbitrary nesting and physical devices remain
outside that conclusion. Linear remains In Review pending the previously blocked
external write; this report does not silently update the task. No deployment.

## 2026-09-16 — current Review acceptance revalidated at ca7b579

Live UIX-502 remains In Review with its original eight acceptance criteria.
The earlier0e3e3c7 gate predates23lines added to the shared Select adapter (popup
open/closed list reset and composite labels). Therefore the separate current
54-case bundle gate does not silently replace nested/sibling owner acceptance.

Existing tests, unchanged:18/18PASS106.997247s, Chromium/Firefox, one worker,
retries0/skipped0/flaky0. Evidence revisionca7b579bb0e03ad8c557f9dc555b1a231e08c144;
runtime sourcee8daadcb357ceb456d789b7964ec69bea267fb38. No new test or product edit
was needed. Special fixture intentionally runs on Vite dev and is excluded from
production; do not relabel this as the production-dist54-case gate.

| Original criterion                                         | Current evidence and boundary                                                                                                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token image/character picker above token modal             | 4real App token-generator cases: inline asset picker and character dropdown,1280/390, pointer hits; narrow Chromium screenshot inspected. Image picker is inline, not a fabricated popup.                        |
| Consistent dialog-owned dropdown/combobox/popover handling | Existing shared owner context and actual Select;8owner cases plus4App cases. Unrelated UIX-644 custom menu types remain their own scope.                                                                         |
| Explicit overlay order                                     | 8sibling/nested fixtures capture layers before/after B and with B popup, plus overlap hit targets.                                                                                                               |
| No clipping by modal/ancestors                             | Actual option-center hits and viewport bounds in real App and owner fixture widths.                                                                                                                              |
| Outside/Escape/focus/keyboard                              | Existing App cases and owner cycles verify pointer outside, Arrow/Enter, Escape levels, trigger/base-opener focus return.                                                                                        |
| Old menu below newer modal                                 | B opens from held async completion after verified A popup, no intervening pointer/forced-open/state mutation; overlap and focus cycles reject stale A pointer/focus ownership. Both sibling and nested topology. |
| Regression for token modal                                 | Existing token-generator.spec.ts actual image/character path retained,4cases.                                                                                                                                    |
| Narrow and desktop                                         | 1280/390 in both browsers for owner/App; close-lifecycle390 in both.                                                                                                                                             |

Additionally4natural close-lifecycle cases verify immediate hidden/inert state;
2held-close-attribute cases explicitly test CSS state, not natural lifecycle.
Read all8modal-owner-diagnostics.json: zero pageErrors, unexpectedApiRequests,
bPopupFocusViolations and finalLayers. Screenshot inspection shows the character
menu visible over the inline asset area within narrow token dialog. No viewport
or assertion weakened to pass. Konva layer warning remains separate.

Artifacts modal-current-gate/results.json,browser.log,browser-01/ contain named
results, diagnostics and screenshots. Own Vite stopped. Scoped local UIX-502
acceptance remains PASS for this candidate; backend ACL, arbitrary-depth menus,
physical devices and full UIX-644 are not inferred. Linear mutation was not
attempted: previous external-write permission remains unresolved. No deploy.
