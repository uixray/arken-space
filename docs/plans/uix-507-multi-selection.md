# UIX-507 — предсказуемое множественное выделение

Текущая сверка исходных критериев: [19 сентября 2026](#closure-сверка--2026-09-19).

> Разделы «Замер», «План» и первоначальный checkpoint ниже — исторический
> срез, не текущий backlog. По решению владельца от 06.09 постоянные счётчики
> выбранных объектов запрещены; количество и типы остаются только в
> подтверждении массового удаления. Выпущенные Shift-жесты и permission-фильтры
> не нужно реализовывать повторно. Актуальные критерии и статус — в Linear.

## Замер

PR #58 восстановил рамку и групповой drag, но текущая реализация остаётся неполной:

- рамка запускается обычным drag вместо Shift+drag, поэтому empty-canvas pan недоступен;
- Shift+click token/drawing не добавляет и не снимает отдельный объект;
- drawing marquee обходит общий фильтр visibility, а MAP token можно включить в bulk через прямой click;
- нет счётчика, подтверждения bulk delete и группового Delete;
- массивы выбора не пересчитываются после удаления, resync или потери access;
- ошибка группового перемещения не имеет явного UI rollback/resync-контракта.

## План

1. Вынести pure модель selection: toggle/replace, пересечение рамки и prune по текущим editable объектам.
2. Привести жесты к контракту Linear: обычный empty drag — pan, Shift+drag — marquee, Shift+click — toggle, обычный click — replace.
3. Строить selection и movable targets только из видимых редактируемых token/drawing; исключить pending, locked, MAP и чужие объекты.
4. Добавить счётчик типов, подтверждение bulk delete и Delete для группы; очищать выбор только после успешной мутации.
5. Пересчитывать selection при authoritative props/access changes; на group-move failure откатывать transient drag и запрашивать resync.
6. Закрепить pure unit и два связанных browser flow для GM/PLAYER; выполнить адресные диверсии.

## Зависимость

Ветка stacked на PR #58, где находятся базовая marquee-модель, queued bulk move и пользовательский Ctrl+click ping. Merge и production publication отложены до отдельного scope; production-сервер выключен.

## Чекпоинт

- Решение: обычный empty-canvas drag снова панорамирует; Shift+drag создаёт рамку, Shift+click добавляет/снимает token или drawing, обычный click заменяет выбор.
- Доступ: выбор, keyboard/group move и delete используют текущие видимые редактируемые объекты; pending, MAP, locked, скрытые и чужие объекты исключены.
- UI: показаны общее количество и типы; Delete/кнопка открывают подтверждение, выбор очищается только после успешного bulk delete и пересчитывается после authoritative access/visibility changes.
- Ошибка move: `MapMoveQueue` сообщает terminal failure ровно один раз; App выполняет authoritative recovery, renderer remount откатывает transient Konva positions.
- Изменённые файлы: `App.tsx`, `Orthographic2DRenderer.tsx`, `SceneRenderer.ts`, `map-selection.ts` и тест, `map-move-queue.ts` и тест, `canvas-token-regressions.spec.ts`, этот план.
- Проверка: unit 39/39 PASS; web typecheck PASS; targeted ESLint и Prettier PASS; browser GM+PLAYER Chromium/Firefox 4/4 PASS.
- Диверсия: принудительный marquee без Shift адресно уронил GM browser test — camera handle не сместился на ожидаемые 40 px; renderer восстановлен.
- Диагностика: первые E2E-падения были ошибками координат fixture (drag попадал в token или вне hit-plane), не дефектами продукта; после привязки к измеренному world-to-screen transform оба браузера зелёные.
- Блокеры: отсутствуют для review. Полный CI выполняется в PR; production не используется.
- Следующее действие: commit, push, stacked PR и Linear In Review.

## 2026-09-16 — mixed move recovery pool

Local implementation now projects queued mixed token/drawing moves over the canonical snapshot, rather than applying the delta after HTTP success. Rejection removes the failed intent and unsent tail; earlier acknowledged moves remain until authoritative state arrives. Exact revision and scene checks prevent double application and resurrection of removed objects.

Verification: full web TypeScript check passed; 18 focused unit tests passed across projection and queue suites (10 queue + 8 projection). Chrome and Firefox passed all 8 isolated real-App cases: drag from token, drag from drawing, rapid queued acknowledgement, and deletion pruning. These tests use synthetic API/socket boundaries, not live backend permission acceptance. Existing two App hook lint warnings remain; no lint errors. No full suite or existing GitHub CI restarted.

The recovery browser spec remains deliberately untracked and excluded from publication. This pool does not close all original UIX-507 criteria: GM/PLAYER permission, fog/locked layers, full tool-conflict matrix and device acceptance still need their original gates. No new production deployment.

## 2026-09-16 — empty-map deselection and zoom separation

Re-read live UIX-507 In Review criteria. Extended the existing GM browser flow
with token Shift-toggle (alongside its drawing toggle), ordinary-click replacement,
and empty-map click followed directly by Delete, without visiting another picker.
The preserved untracked recovery spec was not edited or added to Git.

Two product failures were reproduced:

1. The group-delete button overlapped the actual zoom panel by roughly 2px: its
   fixed right offset did not account for the current panel width. The panel now
   has a positioning wrapper; the action sits 8px beyond its actual left edge,
   outside normal flow, so selection cannot change zoom geometry. Compact short
   screens keep the horizontal panel and put the action below it.
2. Plain empty-map pan/click cleared selection arrays but not the interaction
   model's selected object. Delete could reopen confirmation for the old token.
   That same empty-pan branch now dispatches clear-selection as well. Group and
   single-object deletion confirmations remain distinct; the test cancels both.

Verification: 16/16 PASS, Chromium/Firefox, workers1, retries0: eight GM/PLAYER
1280/390 selection-and-zoom cases, four original UIX-507 GM/PLAYER cases, four
640x360 compact action-target cases. The extended GM flow checks no bulk mutation
until deliberate group move/delete. Web TypeScript, scoped ESLint, Prettier and
Git whitespace checks passed. Desktop screenshot inspected: visible 8px gap.
The short-screen action-target cases do not create a selected group; short-screen
bulk-action hit-testing remains a distinct gap. Fixtures do not prove live server
ACL or multiplayer recovery, and no full CI/build/publication was performed.

UIX-507 remains In Review pending the rest of its original acceptance matrix.
The unrelated intermittent token-popup ResizeObserver gate remains unresolved;
these map fixes do not turn that gate green.

### 2026-09-16 — selected group survives short-landscape rotation

The earlier compact action-target tests had no selected group. Extending the
existing real-App selection/zoom flow to rotate 390x850 -> 640x360 with a mixed
four-object group reproduced a real failure: the dice tray intercepted the group
Delete button placed below zoom. The new unforced center hit-test failed.

The short-screen group action now sits above the zoom anchor, leaving the lower
map lane for dice. Production change is CSS-only; selection and deletion behavior
are unchanged. Chromium GM screenshot inspected: action, objects trigger, zoom,
dice and bottom navigation are separate at 640x360.

Final connected selection/zoom matrix: **8/8 PASS**, Chrome/Firefox, GM/PLAYER,
1280/390. Four narrow cases additionally rotate with the group, require a fully
in-viewport 44px action with real center hit, open the confirmation for 2 tokens
and 2 drawings, cancel without API writes, retain zoom bounds and restore portrait
geometry before completing the existing owner/popover checks. ESLint, Prettier,
Git whitespace checks PASS. Original red output and screenshots retained.

This proves the 640x360 emulated viewport scenario, not physical-device touch,
every possible short viewport, live ACL, the full tool-conflict matrix, or the
unrelated intermittent token-popup observer error. No build, push, deploy or
Linear completion. The untracked recovery test remains unchanged.

### 2026-09-16 — Escape cancels an unfinished selection rectangle

The tool/gesture audit found that Escape cleared selected IDs but retained the
active marquee rectangle. A real-App regression reproduced the consequence:
Shift-drag across the token/drawing, Escape before releasing the mouse, then
pointerup selected the cancelled group again. The original test failed because
`Удалить выбранное` reappeared (expected zero, received one).

The map-state Escape branch now also clears the marquee. The object-list-first
Escape branch stays unchanged. The same GM test then draws the same rectangle
without cancellation as a positive control and continues through token/drawing
Shift-toggle, ordinary replacement, empty-click/Delete, group move and deletion.

Connected verification: **6/6 PASS** Chromium/Firefox: extended GM flow, existing
PLAYER permission/pruning flow and existing DRAW-to-PAN Escape flow. One worker,
no retries; web TypeScript, scoped ESLint, Prettier and diff checks passed.
No speculative tool-mode change, full suite, build, push or deploy. This resolves
Escape cancellation, not the entire Draw/Fog/Ruler/SCENE_REGION/context-menu
conflict matrix, live permission/recovery acceptance, or the separate token-popup
observer error. Untracked selection-recovery test preserved unchanged.

### 2026-09-16 — Shift fog gestures and cancelled fog drafts

Two new actual-App scenarios cover FOG and COVER with Shift held. Each cancels an
80px rectangle via Escape before pointerup, asserts PAN and zero writes, then
repeats it without Escape and requires exactly one fog API request with the
intended REVEAL/COVER operation and nontrivial bounds. No bulk-delete action may
appear. HTTP boundaries are mocked; no live campaign was changed.

RED on the original FOG scenario: cancelled gesture still POSTed a REVEAL rectangle
to `/api/fog-reveals`. Cause: Escape cleared the selection marquee but left
`fogStart`/`fogDraft`; pointerup unconditionally finalized that retained draft.
The clear-map-state Escape branch now clears both fog fields. This is not an error
filter or a change to the completed fog operation, permissions or server contract.

Final connected browser gate: **10/10 PASS**, Chromium/Firefox, one worker, no
retries: four new FOG/COVER cases plus existing GM/PLAYER selection and DRAW Escape
cases. TypeScript, scoped ESLint, Prettier and diff checks passed. Original red
request evidence retained. This covers rectangular fog, not every brush/polygon,
Ruler or SCENE_REGION lifecycle; UIX-507 remains under its original acceptance
criteria. The separate popup observer error remains unresolved. No build, push,
deploy or Linear completion. Untracked recovery test unchanged.

### 2026-09-16 — Escape cancels fog brush strokes too

Extended the existing fog matrix with FOG_BRUSH/COVER_BRUSH. The original
FOG_BRUSH run reproduced the same unsafe outcome through a different state path:
Escape then mouse release still submitted a BRUSH REVEAL payload. Rectangular
fog cleanup alone could not cancel `brushActiveRef`/`brushPointsRef`.

Escape now resets brush activity, stored points and visible draft points before
any late release handler can submit them. Completed stroke behavior is unchanged.
The new positive controls require BRUSH geometry, multiple distinct points,
positive radius and the correct REVEAL/COVER operation; cancel still requires
zero writes. An initial new-test expectation mistakenly treated COVER_BRUSH as
REVEAL; the application correctly returned COVER, so only that expectation was
corrected. That intermediate failure is not reported as a product defect.

Final connected **14/14 PASS** Chromium/Firefox, workers1/retries0: eight fog
rectangle/brush cases plus six existing selection/DRAW Escape cases. Web types,
scoped lint, formatting and diff checks passed. No full suite/build/publication.
Polygon, Ruler, SCENE_REGION and interrupted-device gestures are not thereby
accepted. Existing Review criteria and unrelated popup observer failure remain
open; the preserved untracked selection recovery test is unchanged.

### 2026-09-16 — Shift remains a ruler gesture for GM and PLAYER

Added an actual-App/socket-boundary regression for both roles. With Shift held,
the ruler sends a two-point measurement with distinct endpoints in the current
scene instead of starting marquee selection. Ordinary release and Escape both
end in `ruler:clear`; a later hover does not restart updates. Escape restores PAN.
No map ping, bulk-selection action or HTTP mutation occurs.

Verification: **4/4 PASS**, Chromium/Firefox x GM/PLAYER, one worker, no retries.
The socket server is a test boundary, so this proves emitted gesture messages,
not cross-client delivery or live multiplayer authorization. Scoped ESLint,
Prettier and Git diff checks passed. Product source unchanged.

Negative control: temporarily allowing the Shift marquee outside PAN caused the
GM Chromium scenario to fail on missing `ruler:update` (0, expected >0). The
production source was restored byte-for-byte in `finally` and its diff is empty.
This verifies that the new test detects the relevant tool conflict. No dependency,
full suite, build, publication or Linear completion; recovery spec unchanged.
Remaining Draw/polygon/SCENE_REGION/context-menu and live acceptance criteria are
not replaced by these four cases. The separate popup observer error remains open.

### 2026-09-16 — Shift drawing keeps its own gesture

Added an actual-App DRAW regression for GM and PLAYER. With Shift held, Escape
before release must emit no write and return to PAN. Repeating the same stroke
without cancellation must send exactly one `/api/drawings` request with finite,
nontrivial points and positive stroke width, then reconcile the returned drawing
into the actual object list. No bulk-selection action or page error is allowed.

**4/4 PASS**, Chromium/Firefox x GM/PLAYER, workers1/retries0; lint, formatting
and diff checks passed. Product source unchanged. This is a mocked HTTP boundary
and client reconciliation check, not live backend persistence/authorization.
No additional mutation-control run, full suite, build or publication was needed.
Untracked recovery test is unchanged.

Remaining SCENE_REGION criterion was inspected without enabling dormant UI:
current App.tsx has neither SCENE_REGION selection nor region commit callbacks;
MapToolbar.tsx has no SCENE_REGION entry. The renderer and optional SceneRenderer
callback contract remain, and the shortcut type explicitly excludes SCENE_REGION.
Therefore current actual-App acceptance for that path is not established by
these tests. Do not enable an old encounter workflow simply to turn a test green
or silently mark that original criterion accepted. Context-menu interference and
other outstanding original criteria still need their own evidence. The separate
popup observer error remains unresolved.

### 2026-09-16 — context menu Escape preserves the selected group

The existing GM mixed-selection flow now right-clicks the selected token with
map keyboard focus, verifies its real context menu, then closes it with Escape
and checks the original two-object confirmation without a mutation. The original
code failed: Escape closed the menu and also cleared the entire group, leaving
no group-delete action to click. The failing trace is retained.

`resolveMapEscapeIntent` now models `close-token-menu` before object-list closure
and general map-state clearing. The renderer supplies actual token-menu state and
closes only that top layer. Default callers without a token menu keep their prior
behavior; unrelated keys remain ignored. No menu styling or mutation logic changed.

Verification: **8/8 browser PASS** Chromium/Firefox: extended GM flow, PLAYER
permission/pruning flow, existing DRAW Escape and token-condition menu actions
including server rejection. **6/6 pure Escape tests PASS**, web types, scoped lint,
format and diff checks PASS. These do not establish keyboard focus restoration
from inside the menu, all narrow menu geometry, native Shift-right-click behavior
or live server authorization. UIX-507/UIX-644 and unrelated observer failure remain
open under their full criteria. No build, full CI restart, push, deploy or Linear
completion. The untracked recovery spec is unchanged.

### 2026-09-16 — Context-menu focus restoration (local gate)

- On top of `63ae4ec`, reproduced Escape losing keyboard focus when a token-menu item was focused. Returning to the map must preserve the selected group.
- Restore focus only for keyboard dismissal originating inside this menu and only to a visible, non-inert map owner. Outside pointer dismissal does not steal focus from the clicked control.
- Extended the existing GM mixed-selection flow with focused-menu Escape and outside-click focus assertions; original group confirmation, toggle, move and delete assertions remain.
- Verification: original RED retained; final 8/8 Chromium/Firefox cases passed, no retries, one worker (57.7 s). Web typecheck, scoped lint/format and diff checks passed. No full-suite rerun or build.
- Evidence: local artifact folder `context-focus-gate` in the current session visualization directory. Natural Tab/arrow entry, narrow-menu geometry and native Shift-right-click remain unverified. The independent token-popup ResizeObserver acceptance failure remains open; this is not whole UIX-507/UIX-644 acceptance.
- Untracked `tests/e2e/selection-recovery.spec.ts` unchanged and excluded. No push, deployment, Linear write or status closure.

### 2026-09-16 — Invalidate stale single-token delete confirmation

- Reproduced through the actual App socket handler: `game:snapshot` changes placement revision while the delete dialog stays open. The header proves the new snapshot reached the UI before the failed assertion.
- A confirmation now requires the same selected-scene token id/revision and current deletion permission. Invalid dialogs are hidden immediately and the request cancelled, never silently retargeted or resurrected when eligibility returns. Confirm also checks the current validity flag. Backend authorization remains unchanged and authoritative.
- Four socket cases: GM revision change; PLAYER locked; PLAYER controller revoked while owner id and revealed visibility remain; GM token removed. Lock/revoke intentionally keep placement revision unchanged so permission protection is not merely a revision check.
- Each case then restores an eligible token at revision2: stale confirmation stays closed, explicit new selection/menu confirmation issues exactly one mock DELETE with revision2. Eight decoded receipts (Chrome/Firefox) have no additional writes/pageerrors.
- Final connected24/24 PASS128.9s, one worker/no retries: lifecycle8 plus GM/PLAYER selection, player menu permissions, GM/PLAYER Tab-exit confirmation. Unchanged resize, DRAW and dice pools were not repeated. Web types/scoped lint/format/diff PASS. Artifacts: current-session delete-lifecycle-gate; RED retained.
- Limits: single-token confirmation, not full bulk-delete lifecycle or live server/physical-device acceptance. Dynamic open-menu focus/role changes and fresh GM layer/appearance after snapshot update remain separate checks. No publication, build, CI rerun, Linear closure or new cards. Preserved untracked selection-recovery.spec.ts excluded.

### 2026-09-16 — Exact mixed-group delete intent

- Reproduced: a token revision changes through game:snapshot while the mixed token+drawing confirmation stays open. Initial test setup incorrectly expected Shift multi-selection in the object list; corrected to the existing real canvas marquee before recording the genuine RED (red-02).
- Confirmation now stores scene and cloned exact TOKEN/DRAWING id+revision targets. Its scope includes actor/role/scene and target identities/revisions (order-independent). Any changed eligible selection invalidates the dialog; opening refuses a partial eligible subset. Counts come from the stored intent, not mutable selected arrays.
- App submits those confirmed targets directly. It no longer resolves newer revisions or drops missing objects while assembling DELETE. Server authorization/revision checks are unchanged.
- New socket cases: token revision, drawing revision, drawing removed, PLAYER control revoked without token revision bump. Old approval closes without writes; after restore, a fresh real marquee and confirmation send exactly both revision2 targets. Eight Chrome/Firefox receipts have zero extra writes/errors.
- Final connected20/20 browser PASS119.0s, workers1/retries0: bulk lifecycle8, single lifecycle8, GM/PLAYER selection/move/delete4. Unit scope6/6 PASS; web types PASS after explicit fixture-array guard. Lint exit0 with two warnings in unchanged App effects (359/513, missing snapshot dependency); formatting/diff PASS. No full-suite/build/CI rerun/push/deploy.
- New source files map-delete.ts and map-delete.test.ts; changed SceneRenderer callback contract, App bulk handler and renderer. Evidence in current-session bulk-delete-gate. selection-recovery.spec.ts remains untouched/untracked.
- Limits: mocks prove browser/socket/HTTP intent, not full live multiplayer/physical-device acceptance. Role/scene scope changes covered by pure tests, not all runtime permutations. Open-menu dynamic focus and fresh GM appearance/layer actions remain; independent token-popup ResizeObserver gate remains open. No Linear closure or new cards.

### 2026-09-17 — bulk approval invalidates on eligibility changes

Live UIX-507 remains In Review. Extended the existing exact-target confirmation
scenario, without touching the preserved untracked recovery test or product code.
New cases: GM token lock / MAP-layer transfer; PLAYER visibility revoked /
GM-layer transfer. Each explicitly keeps token and drawing revisions unchanged,
so an incidental version change cannot substitute for permission revalidation.

Actual App receives the changed snapshot over the synthetic Socket.IO boundary;
the scene title confirms consumption before asserting that the old confirmation
has disappeared and no deletion was sent. Restoring eligible revision2 objects
does not revive that approval. A fresh marquee and confirmation then delete
exactly the original token and drawing with their new revisions. The cases retain
zero unexpected-write/pageerror assertions and original confirmation counts.

Connected gate: 16/16 PASS, Chrome/Firefox desktop1280, one worker/no retries:
eight new eligibility cases plus eight existing version/removal/control cases.
E2E types, scoped ESLint, formatting and diffcheck PASS. Evidence:
`bulk-eligibility-gate/final-results.json` and its attached receipts/checkpoint.
Own hidden Vite child stopped after the terminal result. No source fix was needed.

This proves client approval invalidation/reconfirmation, not real-server ACL,
physical touch, scene/actor switch permutations or whole UIX-507 acceptance.
No full suite/build/CI, publication, Linear writes or status closure.

### 2026-09-17 — bulk approval is bound to actor, role and scene

Added three remaining scope transitions to the same actual-App scenario:
GM→PLAYER with unchanged owned/controlled targets, GM membership replacement,
and replacement of the active scene. Target data and revisions are asserted
unchanged before the snapshot arrives. Old confirmation closes without a write;
restoring the original scope does not restore approval. Fresh marquee/confirmation
still sends exactly the two revision2 targets.

Six new cases PASS32.9s, Chrome/Firefox desktop1280, worker1/retries0; the preceding
sixteen eligibility cases were not replayed. E2E types, scoped lint, format/diff
PASS. Product code unchanged. The first test attempt mistakenly initialized the
role case as PLAYER and changed it to PLAYER, so its retained failure is a harness
error, not a product bug. The corrected test asserts its starting GM role.

Evidence: bulk-scope-gate/{final-results.json,corrected-results.json,checkpoint.md}.
Synthetic snapshot scope changes are not authentication/handoff or real server
role-change proof; the separate real shared-browser gate remains the evidence
for handoff. Scene replacement proves renderer-scope cleanup, not every scene
picker workflow. No whole-issue closure, build, full suite, CI or publication.

### 2026-09-17 — polygon fog cannot commit from rapid distinct vertices

Closed the previously untested FOG_POLYGON/COVER_POLYGON tool-conflict branch.
The original source failed before Escape: three rapid clicks at distinct vertices
already sent a REVEAL polygon. Konva synthesizes dblclick on the shared hit plane
without requiring the same coordinates; the unconditional completion handler
therefore mistook adding vertices for finishing the shape. The failure was not
an Escape cleanup regression. Separate pre-Escape assertion retained the red proof.

Completion now requires a repeated final vertex within4 CSS pixels and Konva's
double-click window; this tolerance is screen-space, independent of camera scale.
Such a repeat does not add a degenerate edge. Cancel/completion/tool departure
reset the remembered click. A deliberately separate nearby vertex after the
double-click interval still adds a point. Enter completion remains unchanged.

Final gate:8/8PASS45.0s, Chrome/Firefox × REVEAL/COVER × Shift/plain clicks.
Each case checks no write from rapid distinct vertices, Escape/right-click
cancellation of a three-point draft, correct scene/operation/geometry on Enter,
exact double-click and a2px/1px jittered double-click, plus an intentional nearby
fourth vertex after450ms. No selection delete control or page errors. All writes
are captured synthetic API requests; this is not connected server/fog persistence
or physical-device acceptance. One intermediate test accidentally sent three
clicks via clickCount2 and left a new draft vertex; corrected to exactly two
down/up pairs, without hiding that failed receipt.

Web/E2E types, scoped lint, formatting and diff checks pass. Protected untracked
selection-recovery.spec.ts remains unchanged. No full suite/build/CI, production
or Linear write. Original connected backend rejection/recovery and multiplayer
acceptance remain open. SCENE_REGION stays dormant, not enabled just for a test.

### 2026-09-17 — connected mixed-move rejection and retry

The real isolated GM/PLAYER gate exposed a renderer defect missed by canonical
API assertions: a rejected mixed drag retained the dragged token's local
position at its unchanged revision. Remounting the Konva Stage did not clear
that renderer state, so a fresh gesture at the canonical position missed the
visually displaced token. The same gesture also relayed a single-token preview
to the observer without a compensating token:moved after bulk rejection.

The bulk handoff now deletes the single-token drag override; App's group
projection owns acknowledgement and rollback. Mixed/group drags do not relay
the unrelated single-token preview. Ordinary single-token dragging is unchanged.

New opt-in selection-authority-live.spec.ts uses a fresh isolated database and
two real browser sessions. Only request dispatch is delayed to create a genuine
revision conflict; responses and snapshots are not mocked. It checks atomic409,
fresh mixed retry at the original location with the updated drawing revision,
GM rendered position and live convergence, then controller revocation, UI
selection pruning and atomic403 on an explicit unauthorized mixed request.
The protected untracked selection-recovery.spec.ts is not part of this change.

Initial native worker crash and test's incorrect bootstrap wait are retained
as harness failures, not product failures. Corrected retry reproduced the
stale-position defect; the first fixed run passed both Chrome and Firefox.
Final strengthened gate: 2/2 PASS30.5s, Chrome/Firefox, one worker. Targeted queue,
drag guard and projection tests: 34/34 PASS1.30s. Web/E2E types, scoped lint,
format and diff checks pass. Receipts are recorded in selection-live-gate/
checkpoint.md under the current visualization artifact root.
No production, full suite, CI, Linear write or whole-issue closure is implied.

### 2026-09-17 — original-criteria coverage reconciliation

Read live UIX-507 again: still In Review. Extended the same connected scenario
to both drag initiators (token and drawing), then GM cancellation and confirmed
mixed deletion. The player's already-open object list loses the drawing through
the live connection without reload; both authenticated snapshots lose both
objects. Cancellation leaves both objects unchanged. Confirmation names exactly
one token and one drawing; access revocation and atomic rejection remain checked.

Final: **4/4 PASS58.2s**, Chrome/Firefox × token/drawing, worker1/retries0.
The first extended run wrongly expected a drawing-initiated delta to snap to64;
drawings intentionally use freehand coordinates. The corrected test bounds the
pointer-rounding error below1 CSS pixel and requires both canonical positions
to equal their original positions plus the exact submitted delta. Token-initiated
movement still requires exactly64. No product change in this pool.

Tracked evidence against the original criteria (not a new full-suite run):

| Original criterion                                                  | Evidence                                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Toggle, intersecting marquee, plain replace/clear/pan               | map-selection.test.ts; existing GM/PLAYER canvas-token-regressions flows                                                |
| GM/PLAYER visibility, fog, layer, lock and control policy           | map-objects.test.ts; PLAYER selection and bulk eligibility/lifecycle browser cases; connected403                        |
| Draw, rect/brush/polygon fog, ruler, pan and context-menu conflicts | tracked canvas-token-regressions tool matrix and the checkpoints above                                                  |
| No permanent selection counters; stable zoom; Escape                | current renderer structure, selection/zoom desktop and rotated compact matrix, counts only inside deletion confirmation |
| Drag either group element; queued move and rollback                 | map-move-queue.test.ts and canvas-bulk-move.test.ts; connected token/drawing409, retry and GM live convergence          |
| Count/type confirmation and exact bulk deletion                     | map-delete.test.ts; exact-target and stale-confirmation browser cases; connected cancellation/delete/peer convergence   |
| Delete, scene, authoritative resync and access pruning              | reducer tests, snapshot/reload and scope/eligibility browser cases, connected revocation/deletion                       |

All reachable criteria now have tracked evidence; this does not revalidate every
historical permutation on the current HEAD. SCENE_REGION remains an explicitly
named but unreachable criterion: App passes no encounters/selection callback and
no toolbar/shortcut activates it. Do not silently delete the criterion or enable
obsolete gameplay for acceptance. Its disposition remains open. Physical-device
acceptance is not an original UIX-507 criterion and is not invented as a blocker.
The unrelated menu observer failure belongs to its existing gate, not this one.
No Linear status change: external-write gate remains unresolved. No publication.

## Closure-сверка — 2026-09-19

Источник критериев: read-only Linear UIX-507, все десять исходных пунктов,
с учётом отмены постоянных счётчиков владельцем. Linear пока **In Review**;
запись ранее отклонена и не повторяется через другой канал.

Runtime baseline: released main `cce56397a6b1e91fcf2fc6951e506d64b62647cb`.
Exact-main E2E [35388600465](https://github.com/uixray/arken-space/actions/runs/35388600465)
содержит 58 PASS selection-cases и отдельно 8 PASS HUD/zoom-cases.
Четыре opt-in live cases в этом CI пропущены, а не приняты.
Их отдельный изолированный gate завершился **4/4 PASS**, 0 skipped/flaky/errors,
76.311 s: Chromium/Firefox × token/drawing initiator, worker 1, retries 0.
Тестовый HEAD `51a3cf9c5f6cef4ce97199475639bb9c29ef34df` отличается от released
main только документацией в relevant runtime paths: перед gate Git diff для
`apps/web/src`, `apps/server/src`, `packages` и live spec был пуст.
Это **source-equivalent evidence**, не ложная маркировка запуска как exact cce.

| №   | Исходный критерий                                   | Итог и достаточное доказательство                                                                                                         |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Shift-toggle токенов и рисунков                     | PASS: pure selection helpers + exact-main GM/PLAYER flows; повторный Shift снимает объект.                                                |
| 2   | Shift-marquee, пересечение объектов                 | PASS: geometry/reducer и browser marquee/cancel/repeat.                                                                                   |
| 3   | PLAYER: visibility, fog, control, GM/locked/foreign | PASS: permission/eligibility/pruning tests; live revoke даёт 403 без частичной мутации.                                                   |
| 4   | GM: editable targets, исключение MAP/locked         | PASS: map-objects, bulk eligibility и stale-confirmation browser cases.                                                                   |
| 5   | Нет конфликтов с другими инструментами              | PASS: pan, token drag, Draw, rect/brush/polygon Fog, Ruler и context прошли exact-main; SCENE_REGION production-handler fixture 4/4 PASS. |
| 6   | Нет HUD counters; стабильный zoom; clear/Escape     | PASS: 8 exact-main GM/PLAYER × 1280/390 × Chromium/Firefox; 0/1/mixed, +/−/slider/fit, rotation 640×360, Escape/empty clear.              |
| 7   | Drag любого члена группы, queued move/recovery      | PASS: queue/projection units + live token/drawing 409, fresh retry и rendered GM convergence.                                             |
| 8   | Подтверждение bulk delete с количеством/типами      | PASS: exact targets/stale confirmation + live cancel без изменения, подтверждение 1 token + 1 drawing и atomic delete.                    |
| 9   | Prune после delete/scene/resync/access              | PASS: reducer, reload/snapshot/scope browser cases; live revoke и peer deletion convergence.                                              |
| 10  | Unit geometry/permissions + GM/PLAYER E2E           | PASS: перечисленные tracked suites и receipts; protected recovery spec не использовался.                                                  |

SCENE_REGION недоступен из actual App: нет toolbar/shortcut/callback wiring.
Для исходного требования «не конфликтует» достаточно проверки production
renderer pointer handlers через component fixture; это не требует включать
будущую функцию в продукт. Такой тест не доказывает Konva hit-testing,
публикацию regions или backend persistence и не будет выдаваться за них.
Physical-device и ручная партия не были исходными AC UIX-507; общий остаток
UIX-644 не превращается в дополнительный критерий этой карточки.

Локальный receipt: `selection-closure-2026-09-18/source-equivalent-main-results.json`
под artifact base текущей сессии; environment receipt фиксирует HEAD, loopback
origin и отдельную БД. API/Vite/PostgreSQL остановлены, порты 15439/14109/5189
освобождены. Никаких production-записей или повторного release gate.

Следующее действие: принять один SCENE_REGION component fixture, затем
зафиксировать closure-ready отдельно от формального статуса Linear. Не
повторять 58/8/4 зелёных неизменных cases ради нового чата.

### Адресный gate и ограничение ресурсов

Новый fixture `apps/web/src/renderers/Orthographic2DRenderer.scene-region.test.tsx`
вызывает реальные renderer handlers через mocked Konva transport. Он проверяет
plain/Shift region drag, PLAYER denial, запрет token drag и реальные изменения
camera position при middle/right pan, открытие token context menu. Геометрия
элементов и `matchMedia` — jsdom stubs, не browser evidence.

- Runtime продукта не менялся. Первый старый fixture падал на неполном token;
  типизированные `TokenDto`/`SceneDto` это исправили.
- Первый gate после resume: 21/21 bookkeeping/documentation PASS; 4 component
  cases упали на отсутствующем `matchMedia` jsdom. Этот browser API добавлен
  в fixture, production не менялся.
- Следующий прогон: 2/4 PASS (PLAYER/pan/context), 2/4 FAIL (GM callback).
  Причина: тест проверял callback до продолжения async pointer-up после
  `await handleFogUp()`. Добавлен `await act(...)` перед всеми positive и
  negative assertions, без изменения ожидаемых результатов.
- Финальная попытка **не стартовала**: preflight показал 595.95 MiB свободной
  памяти при минимуме 1024 MiB. Не считать исправленный fixture зелёным.
  Типизация/линт нового файла также ещё не подтверждены.
- Числовой лимит gate: один worker, 180 s, 896 MiB суммарного working set;
  остановка при системной свободной памяти ниже 512 MiB. Владение процессами
  и cleanup записаны локальным bounded runner; активных jobs после gate нет.

После восстановления ресурсов повторить **только этот fixture**, затем его
type/lint/format gate. Старые зелёные 21/58/8/4 не перезапускать без изменения
их scope. Пока критерий 5 остаётся PENDING; это не найденный дефект production.

### Завершение acceptance gap — 2026-09-19, 00:27 MSK

Память восстановилась до ~1800 MiB; тот же bounded runner выполнил финальный
SCENE_REGION fixture: **4/4 PASS**, 18.34 s. Проверены GM plain/Shift normalized
region, PLAYER denial, отсутствие selection/fog/drawing/ping mutations,
недоступность token drag, реальный pan middle/right и token context menu.
Async pointer-up дожидается завершения до всех assertions; mount baseline
проверен отдельно. Production path не менялся и dormant tool не включался.

Web TypeScript gate нашёл только два недостающих обязательных поля тестового
SceneDto.grid (`color`/`opacity`). Они добавлены при `enabled: false`, затем
полный web typecheck и адресный ESLint нового файла завершились exit 0.
Предыдущие красные fixture runs и resource refusal сохранены как история,
не скрыты и не превращены в зелёный production defect fix.

**Все 10 исходных AC имеют evidence: UIX-507 closure-ready.** Это заключение
по реализации и проверкам, не автоматическая смена Linear In Review. Новый
регрессионный тест остаётся локальным до отдельной публикации; существующий
production runtime уже содержал проверенный обработчик. Ни один новый
человеческий/device/SCENE_REGION gameplay критерий не добавлен. Следующий
продуктовый пул — оставшиеся touch targets UIX-624, а не повторение UIX-507.

Финальный объединённый повтор трёх suites (`closure-final-frozen`) остановлен
resource guard при свободной памяти ниже 512 MiB, exit 1. Он **не PASS** и не
заменяет раздельные receipts 4/4 и 21/21. Между зелёным component run и этим
повтором изменены лишь два обязательных поля выключенной grid fixture и
форматирование; production handlers идентичны. Новый локальный regression
test перед публикацией всё равно должен пройти обычный CI; релизные workflow
не перезапускались. Все собственные процессы bounded gate остановлены.
