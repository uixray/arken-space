# Arken Space — bounded execution packets, 2026-09-18

Назначение: дать слабой модели исполнимые, ограниченные пакеты, а не новый
roadmap. Источник статусов и **полных исходных AC** — read-only Linear project
`4e9edd5a-0507-464d-8ba6-10756104373e`; сохранённый снимок —
[`remaining-work-2026-09-18.json`](./remaining-work-2026-09-18.json). Этот файл
не заменяет Linear и не объявляет ни один пункт принятым.

## Неподвижные границы

- Начать с Git/checkpoint/точных CI handles; проверить, к какому SHA относится
  evidence. Один connected pool за раз, затем closure строго против исходных AC.
- Не создавать карточки, не менять gameplay/permissions ради теста, не включать
  недостижимый UI. `tests/e2e/selection-recovery.spec.ts` оставить untracked и
  исключённым.
- Полный gate выполняет GitHub Actions после заморозки пула. Адресные локальные
  тесты разрешены владельцем 18 сентября; один browser worker и отсутствие
  параллельной тяжёлой нагрузки обязательны. Перед командами ниже прочитать
  `docs/development-resource-policy.md` и настройки окружения в `docs/testing.md`.
- Текущая release-граница и статус находятся только в `docs/current-state.md`;
  не копировать сюда устаревающее «CI идёт» или «production старый». Этот пакет
  не является самостоятельным разрешением на merge/push/deploy или Linear write.
- Не решены и не выбираются здесь: уровень владения темой
  account/profile/campaign/membership; трактовка `story media` между asset catalog
  и private journal attachments.

## Общий шаблон checkpoint и stop rule

Перед правкой: `git status --short --branch`; `git rev-parse HEAD`; последние
коммиты затрагиваемых файлов; актуальный plan/checkpoint; существующие workflow
URL/run IDs. После пула записать decisions, revision, files, verification,
blockers, next action и rollback. **Стоп:** обязательный AC не доказан; SHA
изменился; найден ACL/privacy/data-loss риск; требуется продуктовый выбор;
диверсия не роняет нужный тест; CI красный/не завершён; evidence относится к
другому build. Нельзя продолжать микрофиксы ради зелёного счётчика.

## P0 — закрывать Review/In Progress до новых backlog-пулов

### Пакет R1 — UIX-502 (In Review): modal-owned overlays

**Результат для GM/PLAYER:** picker/select в диалоге виден, кликабелен и доступен
с клавиатуры, не перекрывает более новый диалог. **Полный AC:** Linear UIX-502 и
`uix-502-modal-popovers.md` (8 пунктов). Уже есть scoped evidence, включая owner
fixtures и narrow/desktop; это не автоматически текущий acceptance.

- Читать: план → `overlay-owner.ts`, `GravityFormControls.tsx`, `ArkenDialog.tsx`,
  `gravity-foundation.css` → только соответствующие fixture/E2E.
- Шаги: сопоставить 8 AC с exact candidate; повторно использовать неизменные
  receipts; на текущем build одним connected browser gate проверить token asset
  picker, sibling/nested owner, outside/Escape/focus return и keyboard в Chromium
  Firefox, desktop + narrow. Реальные клики, без `force`.
- Focused gate: `pnpm exec vitest run apps/web/src/ui/overlay-owner.test.ts tests/form-select-controls.test.ts`;
  `pnpm exec playwright test tests/e2e/modal-owner-contract.spec.ts tests/e2e/modal-owner-close-lifecycle.spec.ts --project=chromium --project=firefox`.
  Эти явные paths не подхватывают protected recovery spec. Если source изменился:
  `pnpm typecheck`, затем один remote checks/e2e. Ожидание: exit 0, все 8 AC имеют
  receipt, 0 page errors/unexpected writes; count брать из нового output.
- Негативные случаи: popup под modal; popup A над новым modal B; invisible portal
  перехватывает клик; focus уходит в inert background; viewport clipping.
- Budget: один build, 8 owner + 4 actual-App cases максимум; без полного UIX-644.
  Rollback: revert только UIX-502 commit, без данных/миграций.
- Stage gate: Review→Done только когда каждый исходный AC доказан на одном SHA;
  иначе компактный blocker, статус не менять.

### Пакет R2 — UIX-507 (In Review): multi-selection closure

**Результат:** GM/PLAYER предсказуемо выделяют, двигают и удаляют разрешённую
группу без утечки скрытого. **AC reference:** Linear UIX-507; coverage map —
`uix-507-multi-selection.md:392-409`.

- Читать: план → `map-selection.ts`, `map-move-queue.ts`, renderer selection path,
  focused reducer/browser tests. Не читать весь `App.tsx` до выявленного провода.
- Шаги: подтвердить toggle/marquee/plain clear; visibility/layer/lock/control;
  conflicts Draw/Fog/Ruler/pan/context; queued move rollback/resync; exact delete
  confirmation; pruning after delete/scene/resync/access. Для недостижимого из
  App `SCENE_REGION` проверить existing renderer contract компонентно, не
  включать будущую функцию в продукт ради покрытия non-conflict критерия.
- Focused client gate: `pnpm exec vitest run apps/web/src/renderers/map-selection.test.ts apps/web/src/renderers/map-move-queue.test.ts --maxWorkers=1`;
  `pnpm exec playwright test tests/e2e/canvas-token-regressions.spec.ts --project=chromium --project=firefox --workers=1 --retries=0`.
  Явный список исключает `selection-recovery.spec.ts`. Не повторять неизменные
  exact-main receipts: текущая сверка и оставшийся gap — в UIX-507 плане.
- **Live gate — отдельно, не обычная команда выше.**
  `selection-authority-live.spec.ts` пропускает все случаи без
  `ARKEN_SELECTION_LIVE_GATE=isolated-loopback`; exit 0 со skipped не PASS.
  Перед opt-in нужны отдельная одноразовая БД с миграциями, API и web на
  `127.0.0.1`, отдельный media root и сгенерированные тестовые credentials.
  `DATABASE_URL` теста и API должны указывать на одну эту БД, `E2E_BASE_URL` —
  на изолированный web, а web proxy — на этот API. Не загружать production `.env`.
  Только после проверки loopback/health/build revision выполнить
  `pnpm exec playwright test tests/e2e/selection-authority-live.spec.ts --project=chromium --project=firefox --workers=1 --retries=0`.
  Ожидание: ровно 4 PASS, 0 skipped/flaky/errors, rejection/retry/peer convergence.
  Сохранить SHA/JSON receipt и остановить только свои процессы в `finally`;
  проверить закрытие своих портов. При отсутствии изоляции остановиться, не
  устанавливать opt-in ради зелёного exit. Готовый результат 18 сентября уже
  подтверждён; менять среду или повторять gate без изменения runtime не нужно.
- Негативные: PLAYER foreign/GM/MAP/locked; stale confirmation после role/scene/
  actor change; rejected move возвращает canonical state; Escape не коммитит
  draft. Budget: один connected matrix, без physical-device (не исходный AC).
- Stop/rollback: любая утечка или server/client divergence; revert feature commit,
  cleanup только изолированных fixtures. Stage gate — AC-by-AC review, не число
  тестов.

### Пакет R3 — UIX-644 (In Progress): единый menu registry gate

**Результат:** все достижимые раскрывающиеся controls имеют честный
PASS/FAIL/BLOCKED и общий lifecycle/overlay contract. **AC:** Linear UIX-644 (9
чекбоксов). Текущий `uix-644-runtime-coverage.json` помечен `INCOMPLETE`; 208-case
run без финального результата не PASS.

- Читать: `uix-644-menu-inventory.md`, `uix-644-applicability.md`, runtime JSON,
  overlay sites JSON, затем только FAIL/BLOCKED owners.
- Шаги: заморозить manifest; удалить только доказанные недостижимые сценарии с
  объяснением, не код; воспроизвести unresolved shared-Select ResizeObserver и
  отдельно классифицировать native Firefox popup; чинить только общий root cause;
  прогнать единый matrix page/scroll/modal/nested, GM/PLAYER, desktop/compact,
  edge/scroll/resize/browser zoom, Chromium/Firefox.
- Проверка: JSON schema/format, registry tests, runtime smoke каждого unique use,
  pointer hit-testing + keyboard. Негативные: clipping, stale position, invisible
  interception, wrong owner, lost focus, stale reopen. Budget: один frozen matrix,
  без повторов после каждого fix.
- Paths/gate: `docs/plans/uix-644-runtime-coverage.json`,
  `docs/plans/uix-644-overlay-sites.json`, `tests/form-select-controls.test.ts`,
  `tests/activity-filter-menu.test.ts`, `tests/e2e/workspace-select-escape.spec.ts`,
  `tests/e2e/select-element-resize.spec.ts`; выполнить
  `pnpm exec vitest run tests/form-select-controls.test.ts tests/activity-filter-menu.test.ts apps/web/src/ui/overlay-owner.test.ts` и
  `pnpm exec playwright test tests/e2e/workspace-select-escape.spec.ts tests/e2e/select-element-resize.spec.ts tests/e2e/modal-owner-contract.spec.ts tests/e2e/modal-owner-close-lifecycle.spec.ts --project=chromium --project=firefox`.
  Ожидание: exit 0 **и** ни одного достижимого ledger-case без evidence.
- Stop: хотя бы один достижимый пункт без receipt, observer FAIL, ambiguous native
  applicability. Rollback systemic CSS/component commit. Done только при полном
  реестре и документации подключения нового меню.

### Пакет R4 — UIX-645 (In Progress): Lucide completion

**Результат:** UI-иконки — SVG с именами и стабильной hit-area, без Unicode/
emoji stand-ins. **AC:** Linear UIX-645, 9 пунктов; сейчас лишь foundation и
sampled built-shell evidence.

- Читать: `uix-645-lucide-foundation.md`, `icons-migration.md`, icon registry/
  guard и только оставшиеся checklist consumers.
- Шаги: freeze inventory; мигрировать connected surface pools; не заменять
  настоящий текст (`/`) и контент; проверить currentColor/stroke/alignment,
  decorative vs named SVG, desktop/compact GM/PLAYER, focus/disabled/contrast;
  затем anti-regression diversion с одним запрещённым glyph.
- Проверка: icon inventory/AST guard + component; scoped browser; typecheck/build
  и bundle audit (нет CDN/whole catalog). Негативные: SVG tab stop, пустое имя,
  hit-area shrink, disabled still actionable, theme invisibility.
- Paths/gate: `tests/ui-icon-policy.test.ts`, `apps/web/src/map-toolbar-icons.test.ts`,
  `apps/web/src/ui/ArkenDialog.icons.test.tsx`, `tests/e2e/icon-shell-contract.spec.ts`,
  `tests/e2e/compact-action-targets.spec.ts`; выполнить
  `pnpm exec vitest run tests/ui-icon-policy.test.ts apps/web/src/map-toolbar-icons.test.ts apps/web/src/ui/ArkenDialog.icons.test.tsx` и
  `pnpm exec playwright test tests/e2e/icon-shell-contract.spec.ts tests/e2e/compact-action-targets.spec.ts --project=chromium --project=firefox`.
  Ожидание: exit 0; policy diversion адресно FAIL до восстановления.
- Budget: один surface pool и checkpoint; не совмещать с UIX-317 theme rollout.
  Rollback per-pool commit. Stage gate только после полного migration checklist.

### Пакет R5 — UIX-624 + UIX-316 boundary: mobile P1 closure

**Результат:** responsive вход/навигация и три главные области в утверждённом P1,
без заявления «весь mobile готов». **AC:** Linear UIX-624 (5), parent UIX-316
(17); `uix-624-mobile-foundation.md` — historical evidence.

- Prerequisite: подтвердить ownership пересечений UIX-317 (styles/theme) и
  UIX-214 (tools). Читать discovery → P1 plan → responsive shell/navigation/
  state tests; не начинать P2–P6.
- Проверить no horizontal overflow в согласованной matrix; map/journal/character
  reachability; 44×44 только в заявленном P1; hidden/tab order; focus/return/
  retained state; desktop non-regression; real-server A→B privacy.
- Негативные: hidden surface получает focus/read side effect; keyboard/viewport
  закрывает composer; stale workspace; PLAYER скрытые данные. Remote quality +
  E2E + multiplayer по AC; physical iOS/Android остаётся parent/P6 UNKNOWN.
- Stop при неутверждённой IA/width/ownership. Rollback P1 feature commits, без
  БД. UIX-624 может закрыться отдельно; UIX-316 не Done до P2–P6/device gate.
- Paths/gate: `apps/web/src/mobile-foundation.css`,
  `tests/e2e/mobile-foundation.spec.ts`, `tests/e2e/compact-landing.spec.ts`,
  `tests/e2e/compact-player-sheet.spec.ts`, `tests/e2e/compact-journal-budget.spec.ts`,
  `tests/e2e/details-responsive-lifecycle.spec.ts`; выполнить
  `pnpm exec playwright test tests/e2e/mobile-foundation.spec.ts tests/e2e/compact-landing.spec.ts tests/e2e/compact-player-sheet.spec.ts tests/e2e/compact-journal-budget.spec.ts tests/e2e/details-responsive-lifecycle.spec.ts --project=chromium --project=firefox`.
  Ожидание: exit 0 в согласованной viewport matrix; это не device acceptance.

## P1 — следующие connected implementation pools

### UIX-317 — themes/design system

Сначала продуктовый blocker: владелец выбирает persistence identity level
(account/profile/campaign/membership). До решения разрешены только token/contrast
foundation и migration inventory, не server adapter. После решения: один surface
pool, auth save/reset, published-only projection, safe fallback/no-flash/shared-PC
cleanup, затем GM/PLAYER desktop/mobile/focus tests. Негативные: чужая preference,
late response, private profile in catalog, unreadable portal. Rollback generated
theme + consumer commit; не менять gameplay colors/fog/drawing semantics.

### UIX-293 — asset lifecycle acceptance

AC — 7 строк в Linear и `uix-293-acceptance.md:8-18`. Большинство asset-backed
paths имеют scoped evidence. До closure нужен продуктовый ответ: относится ли
`story media` к world-content assets, private journal attachments или обоим.
Не расширять API до private attachments без решения. После него одним pool:
usage/replace/delete ACL, relation preservation, atomic rollback/audit, mounted
map/token/portrait/gallery/audio consumer. Негативные: foreign campaign/direct
URL, used DELETE, conflict retry, audit failure rollback. Focused HTTP/PGlite/temp
files + connected browser; production не трогать.

### UIX-405 + UIX-214 — input/map authority

UIX-405 можно закрывать узко: WASD grid/gridless, input guard, key-hold one
request, Ctrl+click peer-visible ping; PLAYER permission denials и ruler conflict.
UIX-214 — отдельный более широкий pool и blocked by UIX-212/UIX-213: persistent
drawings, permissions, undo/redo, ephemeral ruler, safe grid, bounded shared zoom,
reconnect/multi-client. Не смешивать closure: UIX-405 evidence не закрывает
UIX-214. Команды: focused interaction/unit, two-client browser, multiplayer; stop
при authority divergence. Rollback input commit отдельно от persistence schema.

### UIX-318 — secure operator inbox

Сначала независимая проверка host identity вне production mutation; причина
host-key change записывается приватно. Затем dedicated staff auth, paginated/
bounded/rate-limited/audited list/detail, explicit sensitive reveal, protected
attachments, state machine and Linear-link metadata. Негативная матрица anonymous/
PLAYER/GM, path/key/token/chat redaction, late auth loss. Focused API/auth tests +
operator browser; production read-only, deploy отдельный gate. Rollback UI/API
commits и миграция по release runbook.

### UIX-407 → UIX-398 — measure before refactor

UIX-407 выполняется строго по существующему
`docs/measurement-runbook-2026-08-24.md`: не придумывать fixture, thresholds или
команды. Выполнить prerequisites и команды runbook, сохранить названные там raw
artifacts на одной revision/environment и не выдавать extraction MapToolbar за
performance proof. Только после этого gate UIX-398:
A0 stable run helpers → A stable handlers/ref → B actions-only domain context;
этап C только по данным. Structural tests фиксируют stable refs, Sidebar prop
reduction и отсутствие mutable values. Каждый domain — отдельный commit/full
remote gate; zero behavior change. Rollback domain commit; при изменении gameplay
немедленный stop.

### UIX-411 — external production monitor

Repo foundation существует, но AC требует живого доказательства: external host,
notification within minutes и явное RPO decision. После merge запустить manual
workflow: healthy → заведомо неверный URL → deduplicated alert → restore/recovery;
не опрашивать private data. Владелец выбирает accepted daily RPO или pre-game
backup; агент не выбирает. Stop при noisy repeats/secret exposure. Rollback
workflow; мониторинг не равен deployment.

## P2 — human/release gates, не implementation shortcuts

### UIX-585 / UIX-642

Исторические release issues нельзя закрыть новым локальным тестом. Сверить exact
included heads/base/main, immutable candidate, existing CI handles; затем exact
quality/E2E/multiplayer, migration and non-live media; restic check + snapshot +
isolated restore + rollback image IDs; только при отдельном GO двухфазный deploy
и postflight health/auth/logout/socket/GM+PLAYER persistence. В текущем контексте
`cce5639` ещё проверяется, production считается `7f28ca3`: release не завершён.

### UIX-217 — human GM + 6

Backlog и blocked by UIX-210/211/214/215/216/218–222. После их закрытия и deploy
точного SHA выполнить `docs/uix-217-rehearsal-runbook.md`: backup/restore/build/
schema/rollback entry gate, 7 чистых профилей, 30–45 минут, Chrome/Firefox/Edge,
adversarial ACL, restart/reconnect. Немедленный stop при leak, foreign mutation,
loss/duplicate или ambiguous identity. Результат — human go/no-go, не тест-count.

## Активные отдельные owner/playtest-пулы

Это In Progress, не backlog, но они не перехватывают основной VTT P0 без выбора
владельца.

- **UIX-289:** требует разрешённых Eagle/visual sources; интеграции выключены.
  До opt-in только сверить AC и `docs/plans/uix-289-result-boundary.md`; не
  генерировать замену. После opt-in составить отдельный executable visual packet.
- **UIX-364:** страницы реальных игроков требуют согласия и их материалов. До
  получения — только read-only inventory; не публиковать и не заполнять от себя.
- **UIX-647:** отдельная Karlyuza beta имеет automated evidence, но ждёт owner
  playtest/balance/content iteration. Начать с original AC и exact deployed SHA;
  не смешивать с VTT release и не называть automation human acceptance.
- **UIX-572:** отдельная Misha Dispatch. До явного выбора читать только Linear AC
  и существующий brief, определить module ownership и создать executable packet;
  не реализовывать по одному названию.

Общий stop: нет owner opt-in/materials/scope — `BLOCKED`, без нового кода,
публикации и Linear write вне stage gate.

## Остальной инвентарь

Не изобретать пакеты из названий. Полный перечень, status/priority/relations,
исходные AC и предлагаемые зависимые пулы ведутся в
[`remaining-work-2026-09-18.md`](./remaining-work-2026-09-18.md) и JSON рядом.
Выбирать следующий пакет только после closure текущего Review/In Progress и
проверки, что inventory не изменился в Linear.
