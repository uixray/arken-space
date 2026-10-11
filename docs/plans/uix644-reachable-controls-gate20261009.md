# UIX-644 reachable controls gate — 2026-10-09

## Result

The single six-cell local browser run completed, with **partial evidence and an identified harness navigation blocker**. It does not close the planned control pool or UIX-644. Existing runtime branches not reached remain blocked; the GM Files/Character/Setup routes were not actually exercised because the harness searched only inline navigation buttons. In source, overflow-menu buttons intentionally have no `.workspace-nav__item` class and are reachable via `data-workspace`; the harness did not use that locator. This is a harness locator gap, not evidence that the product screens are unreachable. No automatic retry was run.

Tested product source baseline `52013d43e6f2fca1bb268c38608afde9cd76424a`; docs HEAD `83726c996ace13872b174d535883543ab3c39a58`. Existing local runtime was revalidated before the matrix: QA DB port 14181 listener PID 25464 (`com.docker.backend`), API 14182 PID 23636 (`node`), Vite 14183 PID 1296 (`node`); API and Vite health returned 200. No process was started, stopped, or restarted.

## Six-cell receipt summary

| Cell | Result / controls reached | Caveat |
|---|---|---|
| GM Chrome desktop 1360×900 | QuickRoll tooltip hover/focus/Escape passed. | Files, Character/Setup and toolbar targets blocked by navigation/visibility locators. |
| GM Chrome compact 390×844 | Map PAN tooltip hover/focus/Escape passed. | Files/Character/Setup, QuickRoll and summary tooltip not reached. Compact is viewport emulation, not zoom. |
| PLAYER Chrome desktop 1360×900 | QuickRoll and map PAN tooltips passed; Files navigation absent as expected for PLAYER. | No GM-only controls were forced open. |
| PLAYER Chrome compact 390×844 | Map PAN tooltip passed; Files navigation absent as expected. | QuickRoll and summary tooltip not visible; compact remains viewport emulation. |
| GM Firefox desktop 1360×900 | QuickRoll tooltip passed. | Files, Character/Setup and toolbar targets blocked by navigation/visibility locators. |
| GM Firefox compact 390×844 | Map PAN tooltip passed. | Files/Character/Setup, QuickRoll and summary tooltip not reached. Compact is viewport emulation, not zoom. |

Observed expected role-specific Activity/QuickRoll and representative map-button tooltip behavior only in the listed cells. `ToolbarTooltip` summary callers were not reached in any cell. Global manager disclosure/native select, campaign pack selects, MediaPanel filter, both StatLayoutCard owner chains, and conditional per-file provenance were **not exercised**. Per-file provenance additionally lacks an authorized safe local image for this no-write pool; no file chooser was opened. Player Files is `PASS_NOT_APPLICABLE_CURRENT_PRODUCT` based on current `workspace-nav.ts` role filter, not runtime acceptance of MediaPanel.

## Bounded source locator diagnosis

`WorkspaceNav.tsx` renders inline buttons with `.workspace-nav__item`, but its `button(item, inMenu)` helper gives that class only when `inMenu` is false. Overflow buttons retain `data-workspace` but omit `.workspace-nav__item`. At compact widths (and where desktop labels overflow), `openWorkspace()` searched `.workspace-nav__item` after opening the overflow summary, so it could not find Files, Characters, or Setup. Its `gm-files-nav-not-reachable`/`setup-workspace-unreachable` receipts therefore do **not** prove a missing product route. A future gate must locate by `button[data-workspace="media"]` / actual `data-workspace` ID and accessible menu semantics, then observe each destination before continuing. This correction is documented for root review; the current pool is not rerun automatically.

The same receipt recorded `summary-not-visible` for the character stat detail and `trigger-not-visible` for QuickRoll/Map controls in cells noted above. These are exact harness observations only; they are not product failures. Do not convert a missing target into a PASS or infer all conditional toolbar callers from PAN.

## Network and runtime safety

- Elevated run command: `node .tmp/uix644-reachable-controls.qa.mjs` — exit 0; receipt below.
- A preceding sandboxed attempt of the same command exited 1 with `fetch EACCES 127.0.0.1:14182`. This was the sandbox loopback restriction; elevated preflight confirmed the existing runtime healthy before the single matrix run.
- Six auth/session writes were recorded separately (one per cell); three read-marker writes occurred during normal app session use. Aggregate API GET count was 74. Domain writes: **0**. No client-log posts, page errors, or ResizeObserver errors. No pack/create/upload/publish, request/roll submission, asset operation, layout write, map action, or preference change was issued.
- The harness omitted screenshots and fixture names/IDs/content to avoid retaining private screen data. It recorded viewport dimensions only; no native OS select popup or true browser zoom evidence was produced.

Sanitized receipt (ignored): `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-20261009-034610042Z.json`, SHA-256 `0dd61517b4c5634e2197de5d5c13f25b9b28b9b4a47aaf18cb2ca57f70538860`. Ignored harness: `.tmp/uix644-reachable-controls.qa.mjs`. Receipt records each case status, safe counts, role/browser/viewport, and sanitized request audit; no raw URL, fixture name/ID, token, or response body.

## Next bounded action / limits

Root review is needed before another browser gate. If authorized, make one corrected connected run using `data-workspace`/accessible overflow item locators; do not mutate product source. Keep the same six-cell matrix, no fixture/domain writes, and separate authentication/read-marker traffic. First validate the exact owner controls in one scoped observation, then record per-site reachability and continue. If an existing DRAFT pack, safe image, conditional character/member choice, or toolbar summary target is absent, mark only that branch blocked. Full legacy E2E, true zoom, visible native OS popup/human acceptance, publication, and public authorization remain outside this gate.

## Checkpoint

- **Changed files:** this gate document and ignored harness/receipt only; product source, QA DB/data and other workers' files were preserved.
- **Verification:** existing runtime status/health preflight; one connected Playwright run, six cells, exit 0; domain-write audit 0; `git diff --check` completed without whitespace errors (Git emitted fsmonitor and line-ending warnings for the managed worktree/concurrent docs).
- **Failures/blockers:** GM Files/Character/Setup destinations were missed by a harness selector that excluded overflow entries; no retry per root instruction. QuickRoll/map target visibility was partial. Native popup and zoom remain human gates.
- **Next:** root reviews exact locator correction and decides whether to authorize a corrected run. No Linear update or commit here.

## Corrected locator preflight — stopped before matrix (2026-10-09)

Root authorized one source-informed GM observation before any corrected six-cell run. The helper used the actual CSS locator `button[data-workspace="media"]` against the existing local runtime (API/Vite health 200), authenticated the GM route (200; bootstrap role GM), and inspected one desktop Chrome context (1360×900). It found one matching DOM button, but it was **not visible**, was not clicked, and the Files dialog/manager/summary/select did not resolve. Per the gate instruction, execution stopped here; no six-cell matrix ran and no automatic retry occurred. This is a failed harness preflight, not evidence of a product route defect or a product PASS.

- Helper: `.tmp/uix644-reachable-controls-observe-20261009.mjs` (SHA-256 `df717ca38e1d91d414c830bb001aa2c90fb2070375c8d52858560b51211fc6e7`).
- Sanitized immutable receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-observe-20261009-034943638Z.json` (SHA-256 `a0128f1608d22d90172992c7702ffda3bcbb17e84fd37d4c99146a6f6e7d9e67`); no fixture data/token/IDs/content retained.
- The observation helper issued no domain-level action; GM authentication/session/bootstrap traffic may occur and was not audited by this helper. No fixture mutation or product edits were invoked.
- Tested source: product `52013d43e6f2fca1bb268c38608afde9cd76424a`; document HEAD `83726c996ace13872b174d535883543ab3c39a58`.
- Next action: root review the observation harness logic before any further browser attempt. The helper's visible-state handling is suspect because a DOM match may reside in a closed overflow menu. No further attempt is authorized in this pool.
## Corrected visibility-aware observation — stopped at bootstrap (2026-10-09)

After root's exact correction, a fresh helper checked actual visibility of the `button[data-workspace="media"]` match, opens the `workspace-nav__more` details only if closed, and waits for the unique target to become visible before click. This single corrected attempt stopped earlier at the GM same-origin bootstrap fetch: Playwright reported `TypeError: Failed to fetch` from `page.evaluate` on `/api/bootstrap`. The structural observation did not complete; no Files/Stat/summary control was asserted, and the remaining six-cell matrix was not run. No retry was made. This is a runtime/harness blocker at bootstrap, not a product PASS/failure.

- Helper: `.tmp/uix644-reachable-controls-observe-corrected-20261009.mjs` (SHA-256 `adfe9a6e9e316d23502e9f4b909e7425fc6d187d4e7b4438bddb1c8f82ec6d68`).
- Sanitized abort receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-observe-abort-20261009-035121967Z.json` (SHA-256 `1917f7d8354790c71246004abd1a15f8cf2a60f3eb42e5ff1ce38b2d5e3b6275`); token/private fixture values omitted.
- No domain-level UI action was invoked before the bootstrap failure. Authentication/session traffic may have occurred; this helper did not include a request audit. No fixture changes or product edits were invoked. No Linear update or commit.
- Next action: root review the captured bootstrap failure and decide whether to authorize a separately bounded diagnostic/retry. The six-cell gate remains unrun.
## Post-restoration invocation — result unavailable (2026-10-09)

After root restored the existing local Vite process and revalidated API/Vite health, I invoked the same corrected helper once (`node .tmp/uix644-reachable-controls-observe-corrected-20261009.mjs`, elevated local execution). The outer tool yielded as running, then returned completed with no output; it did not expose the nested command's exit code or session ID. A passive process check found no remaining Node process, and no new observation receipt was created. Because the helper only writes a receipt after all structural checks, the observation result is **unknown/incomplete**; do not infer success, exit 0, or a runtime outcome. The exact phase/error cannot be recovered from the tool handle. No rerun was performed.

This helper also hardcodes its receipt `domainWrites` field rather than recording a request audit, so that field is not independent measured evidence. Treat the observation helper as navigation-only and keep auth/session traffic distinct. The prior six-cell matrix's separate request audit remains unchanged.
## Visibility-aware structural diagnostic — Files reached, filter locator mismatch (2026-10-09)

After root's runtime repair and explicit authorization, one fresh diagnostic ran to completion with a redacted stage/error-name receipt and request-count audit. Chrome GM route/bootstrap returned 200. The corrected resolver found one `button[data-workspace="media"]`, recognized it as hidden in the closed overflow, opened the overflow, waited for visibility, clicked it, and resolved the named Files dialog. The manager disclosure summary and one global-manager select were visible; campaign draft form had four select controls. The MediaPanel kind filter was not found by the harness's `getByLabel("Тип файлов", exact: true)` locator, so the observation is **PARTIAL** and the corrected six-cell matrix did not run (`nextMatrixEligible=false`). Source inspection immediately after the run shows the select's actual accessible name is `Фильтр файлов по типу` (`apps/web/src/sidebar/MediaPanel.tsx:205`); this is another harness locator mismatch, not product absence. No follow-up browser attempt was made.

- Helper: `.tmp/uix644-reachable-controls-diag-20261009.mjs` (SHA-256 `81c9a09024374e857c45c9115d816d14fc93c05304b0657c2a045da7fbd2b2ce`).
- Sanitized receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-diag-20261009-035555747Z.json` (SHA-256 `405af1859ca142ee1645114a2c846253e7a59d2706f0bda3d70a664a9e0afe18`). Receipt records counts only; no raw URLs, tokens, fixture names/IDs, response contents, or error messages.
- Request audit measured: API GET 18, auth writes 1, read-marker writes 1, domain writes 0, client-log POST 0, page errors 0, console errors count 3 (messages omitted). No fixture/domain write was observed. Normal auth/session and read-marker traffic are separated.
- Tested product source SHA `52013d43e6f2fca1bb268c38608afde9cd76424a`, document HEAD `83726c996ace13872b174d535883543ab3c39a58`. Existing API/Vite listener state was revalidated by root before this run; no service restart occurred.
- Exact missing locator/site: MediaPanel select accessible name mismatch (`Тип файлов` label text vs `Фильтр файлов по типу` aria-label). Manager controls were reached, but alternative option behavior and owner chains remain untested. Native popup remains human-only.
- Next action: root review the exact source-derived filter locator correction; no six-cell run or automatic retry was performed here. No Linear update or commit.
## Offline locator and error-evidence audit (2026-10-09; no browser run)

Reviewed the earlier harness selectors against the exact current product markup at product source SHA `52013d43e6f2fca1bb268c38608afde9cd76424a` (document HEAD now `857c426bdaafd726fc1bf83b5d8e1b63a057800a`). This section is source mapping only; it does not turn a missed locator into runtime PASS, does not authorize another browser run, and does not replay previously accepted QuickRoll/PAN tooltip cells.

| Site | Source-backed scoped resolver / exact target | Reachability and safe precondition |
|---|---|---|
| Files workspace | `.workspace-nav button[data-workspace="media"]`; if unique but hidden, inspect `.workspace-nav__more` and click its direct `summary` only when the details is closed, then wait for target visibility. After click, resolve `getByRole('dialog', {name:'Файлы', exact:true})`; ArkenDialog sets `aria-label` from title. | GM only (`workspaceNavItems` adds `media` for GM). Current structural diagnostic reached the destination this way. Do not infer PLAYER Files route; no force route. |
| Global manager disclosure | Within named Files dialog: `details.global-sticker-manager` then direct `:scope > summary` (text is “Общие паки”). | MediaPanel mounts it in GM. Pointer/keyboard/Escape interactions are local disclosure behavior. No create/publish controls. |
| Global owned-pack select | Within the global manager, exact accessible label `Мои общие паки` (from the wrapping `<label>`). | Rendered only when `packs.length > 0`; current structural diagnostic saw one select in the manager, but that is not option-count evidence. Require at least two options before an alternate-selection test. `onChange` sets selected ID/clears local draft name; effect requests pack details by GET. No write. Do not print names/IDs. |
| Campaign draft fields | Within `.sticker-pack-manager .sticker-pack-fields`, use exact labels: `Тип набора`, `Персонаж`, `Игрок`, `Кто может видеть`, `Кто может отправлять`. | `.sticker-pack-fields` exists only when no pack is currently resumed (`!pack`). Subject offers CHARACTER/PLAYER/NPC/CREATURE. `Персонаж` is rendered only for CHARACTER and needs an active-character option beyond its placeholder; `Игрок` only for PLAYER and needs a campaign-member option beyond its placeholder. Audience and send-policy fields always render in this form and each has two source-defined options. Selecting these fields only changes component state until the separate Create action; never press Create. Restore the original subject/value after a conditional branch. |
| Per-file provenance | Only inside `.sticker-pack-manager fieldset.sticker-pack-file`, exact label `Происхождение`. | Requires a resumed owned DRAFT pack plus an already-selected safe local file and an editable file status. File input is labeled `Добавить изображения`; choosing any file is outside this no-write audit. Current pool has no approved safe image fixture, so this occurrence remains prerequisite-blocked; do not open chooser, create pack, upload, or infer from the four draft selects. |
| Media kind filter | In Files dialog, exact locator `getByLabel('Фильтр файлов по типу', {exact:true})`; its visible label text is “Тип файлов”, but the select has this explicit `aria-label`. | GM MediaPanel only. `onChange` updates local `kindFilter`; use DOM `selectOption`, restore baseline, and do not claim native OS popup behavior. The last diagnostic incorrectly queried exact label text `Тип файлов` and found zero; source confirms locator mismatch, not missing control. |
| Character StatLayoutCard owner | Open `.workspace-nav button[data-workspace="characters"]` using the same visibility-aware resolver. The owner has `role=tablist`, `aria-label="Ключевые показатели персонажа"`; the exact tab is `getByRole('tab',{name:'Показатели',exact:true})`, not “Характеристики”. Scope the first menu to `.character-section--stats .character-card--stats details.stat-field__menu`, then its direct `summary`. | Workspace must render an active character sheet; stats tab is initially `resources`, so click “Показатели”. StatLayoutCard menu appears only when `canEditLayout`; caller passes `snapshot.me.role === "GM"`. A row must exist. Choose one visible menu disclosure, open/Escape/restore only; never click move/rename/delete/add callbacks (persist layout). PLAYER menu is absent by contract. |
| Setup Catalog StatLayoutCard owner | Open `.workspace-nav button[data-workspace="setup"]`; within `.setup-tabs[aria-label="Разделы подготовки"]`, exact button text `Общий каталог` (it sets local active tab). Then `.campaign-stat-layout-editor[aria-label="Характеристики кампании"] .character-card--layout details.stat-field__menu` and direct `summary`. | Setup is GM-only in Sidebar. Catalog card menu exists only for non-pending layout rows; groups may be empty. Open/Escape/restore only; do not hit row move/rename/delete or “Добавить навык или способность”. |
| Toolbar summary tooltip (not previously accepted button/PAN cases) | Preferred scoped target: `getByRole('toolbar',{name:'Инструменты карты'}).locator('details.toolbar-overflow > summary[aria-label="Дополнительные инструменты"]')`; shared tooltip popup source selector is `.map-toolbar-tooltip[role="tooltip"]`. This `ToolbarSummary` has no DOM `title` attribute: its `title` prop is consumed by `ToolbarTooltip` and becomes tooltip content. | Rendered only when not preview and GM `overflowTools` exists; require actual toolbar and visible summary. Hover/focus/Escape only; do not click/open overflow or tools. Previous broad selector `summary[title]` cannot match this summary. If this exact target is absent/hidden, mark only this site blocked. Do not replay accepted `MapToolbar button[data-tool="PAN"]` or QuickRoll button tooltip cells. |
| Alternative summary tooltip | GM active-scene/non-preview only: within the same toolbar, `details.resize-settings > summary[data-tool="RESIZE"][aria-label="Настройки размера карты"]`. | The MapToolbar source mounts resize summary only for GM when `activeScene` exists; it also consumes `title` as tooltip text, so no `[title]` locator. Prefer the overflow summary above to avoid touching resize disclosure; this is a distinct optional caller, not required to claim shared summary coverage. |

### Console-error evidence limit

The sanitized diagnostic receipt measured `consoleErrors: 3` but retained only a count. The helper did not persist message text, error names, URL, or category, so the three events cannot now be classified offline. Do not infer “known benign”, zero console errors, or error-free behavior. No raw console messages are available for safe in-memory reclassification, and no browser rerun is authorized in this audit. Keep the count of three as an unresolved diagnostic observation; a later explicitly authorized run would need a handler that immediately reduces each event in memory to an allowlisted category/error-name and discards the raw string.

### Current gate status and next handoff

- Visibility-aware Files navigation itself is now source/runtime-observed in one GM desktop Chrome structural diagnostic: overflow opened, Files dialog visible, manager summary visible, one manager select present, draft form present with four select controls. This partial observation is not a six-cell gate and does not prove select alternatives, native popup, conditional character/player branch options, StatLayoutCard owners, or tooltip behavior.
- The filter is not missing: use its explicit accessible name `Фильтр файлов по типу` in any later root-authorized gate. Current source also corrects the previous stats-tab name and toolbar-summary `[title]` assumptions.
- Before any future matrix, root should choose which feasible sites to include and ensure a first structural step records separate reachability statuses. Rows with missing prerequisites remain BLOCKED; no fixture/domain writes, no product edits, no Linear updates, and no commit were made here.
- Verification for this offline pool: source markup/caller mapping above reviewed; no browser, API, DB, fixture, test, or product write executed. Existing prior receipts remain immutable; no new receipt generated.
## Authorized connected-gate attempt — harness preflight/handoff failure (2026-10-09)

One root-authorized connected attempt ran after the offline source audit. Runtime/API health returned 200; GM route/bootstrap returned 200. The stable visibility-aware Files resolver succeeded: the single `media` workspace button was hidden in the closed overflow, the overflow summary was opened, the target became visible and was clicked, the named Files dialog appeared, and the corrected MediaPanel filter locator was visible. The structural helper then queried the global manager's accessible pack select while `details.global-sticker-manager` was still closed and received count 0. This is **not** evidence that packs/options are absent; the owner disclosure was not opened before the query, so the selector was not resolved. The harness incorrectly treated this as a gate stop.

The stop branch then passed the wrapper object returned by `structuralFirst()` to `finishCell()` rather than its nested session object. The caught `TypeError` occurred before per-cell initialization and audit aggregation. Only GM/Chrome/desktop was opened; no other matrix cell or StatLayout/summary-tooltip case ran. The receipt's zero aggregate counters are therefore **not measured** for this attempt, and this pool cannot claim zero observed domain writes or any console-error count. No domain-level control action was intentionally invoked; GM authentication/session/bootstrap plus normal read traffic occurred but is unquantified in this receipt. Preserve the receipt; do not reinterpret its zero totals as evidence.

- Sanitized receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-connected-20261009-040059268Z.json` (SHA-256 `bed64d57383632a9a37b9adc065c012578be9a6c952e51cd3520d39714fa55ca`).
- Helper: `.tmp/uix644-reachable-controls-final.qa.mjs` (SHA-256 `6f61ddd01f2459bf59e062b46adf92c71faf4356c6c3f5c17bef760b6bbbd3d1`).
- Exact harness corrections for any later gate: open the manager disclosure before resolving its conditional label/control; treat absent conditional controls as per-site BLOCKED, not a pool-wide gate; pass `first.opened` into the first-cell runner; ensure the same audit object is collected in `finally` even when preflight fails. Root controls any next run; no rerun was made here.
- Tested product source SHA `52013d43e6f2fca1bb268c38608afde9cd76424a`; document HEAD `857c426bdaafd726fc1bf83b5d8e1b63a057800a`. No product edits, fixture/domain mutations, Linear update, or commit.
## Offline harness repair + deterministic self-check (2026-10-09; browser stopped)

Per root review, repaired the ignored connected harness offline only; no browser/runtime/fixture/API/DB action was run. The corrected structure now requires only a unique GM Files destination/dialog, manager owner summary, and exact visible MediaPanel filter for the six-cell pool preflight. The manager disclosure is opened before resolving its conditional `Мои общие паки` select; an empty/absent owned-pack select is recorded as its own BLOCKED case and does not suppress the other Files checks. Draft subject, PLAYER/CHARACTER dependent fields, audience, and send policy now produce separate per-control cases; missing conditional choices remain local BLOCKED results. Per-file `Происхождение` remains independently blocked without a pre-existing DRAFT plus safe selected image.

Harness repairs include: passing the first session (`first.opened`) separately from structural/files metadata to the first cell; using numeric `audit.domainWrites`/`hasUnexpectedDomainWrites()` for immediate stop decisions; registering each audit once at page creation so navigation failures remain in aggregate evidence; retaining per-cell audit/error categories and source-only paths; explicit focus before programmatic DOM select changes (no native-popup or keyboard-popup claim); and removing the already-covered held-Escape sequence. No raw message/URL/token is retained: console text is transiently reduced in memory to an allowlisted category/error name, page-error stacks retain only app source paths, and raw console text is discarded.

- Connected helper: `.tmp/uix644-reachable-controls-final.qa.mjs`, SHA-256 `c9f852fa33d7c90a876900a15a8e79a619cd952a9d235b2c2b37d9e8bb1f74f3`.
- Pure bookkeeping module: `.tmp/uix644-reachable-controls-bookkeeping.mjs`, SHA-256 `180c11e37540278c344e403e1499a8fb4f2098d98bc1ba62513cf8babd27002f`.
- Self-check: `.tmp/uix644-reachable-controls-bookkeeping.test.mjs`, SHA-256 `e538be983c5c3d1d4583bd5605de72fc44fffb8de68d744e9c7b611db247dcf6`.
- Verification: `node --check` passed for helper and module; `node --test .tmp/uix644-reachable-controls-bookkeeping.test.mjs` passed 3/3. Cases cover positive/zero numeric-domain-write stop, nested structural-session handoff, and audit retained after simulated failure. These are deterministic bookkeeping checks, not browser/product evidence.
- Product source SHA remains `52013d43e6f2fca1bb268c38608afde9cd76424a`; document HEAD at audit is `30bbb5b57456ce7f0345c44547bc46d2b084351c`. No product edits, fixture/domain writes, Linear updates, or commits.
- State: offline repairs await root review. Browser gate remains unrun after repairs; do not execute until root acceptance. Prior partial/failed/unknown receipts remain immutable.
## Final corrected connected gate (2026-10-09)

Root reviewed and accepted the offline harness repair, then authorized one six-cell run. The run completed all cells; it is **partial/blocked evidence**, not a blanket PASS and does not close UIX-644. No retries followed.

- Product source SHA: `52013d43e6f2fca1bb268c38608afde9cd76424a`; docs HEAD: `30bbb5b57456ce7f0345c44547bc46d2b084351c`.
- Command: `node .tmp/uix644-reachable-controls-final.qa.mjs`; tracked exec session `24960`, final `exit_code=0`.
- Helper SHA-256: `c9f852fa33d7c90a876900a15a8e79a619cd952a9d235b2c2b37d9e8bb1f74f3`.
- Immutable sanitized receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-connected-20261009-041313962Z.json`; SHA-256 `740cb91c4310f89fe3582f7b5118472aee84e17266ebbca70efb4ca77d067859`.

| Cell | Result |
|---|---|
| GM Chrome desktop | Files navigation, manager disclosure/focus restore, MediaPanel kind filter via focused DOM selection, TokenTray summary tooltip, Character and Setup catalog StatLayoutCard owners passed. |
| GM Firefox desktop | Same set passed. |
| GM Chrome compact | TokenTray summary tooltip passed; Files and StatLayout destinations blocked because overflow summary was not available to the tested resolver. |
| GM Firefox compact | Same compact limitation; summary tooltip passed. |
| PLAYER Chrome desktop | TokenTray summary tooltip passed; Files and player StatLayout correctly not applicable by observed role/product contract. |
| PLAYER Chrome compact | TokenTray summary tooltip passed; Files correctly not applicable; player StatLayout menu locator blocked by unavailable overflow summary. |

**Per-site blocked prerequisites:** the conditional owned global-pack select was absent (`count=0`) after opening the owner disclosure; campaign draft subject/audience/send-policy controls did not resolve uniquely/visibly (count 0), so player/character branches were blocked at subject selection; per-file provenance requires an existing resumed DRAFT plus safe local image, which was outside this no-write pool. These observations are branch-local and do not establish product defects. Native OS select popup and keyboard popup were not tested; only focused DOM option selection was exercised. No held-Escape sequence was repeated.

Measured request audit across six cells: 89 API GETs, 6 auth writes, 3 read-marker writes, **0 domain writes**, 0 client-log posts, 0 page errors. Chrome recorded 12 console errors, safely reduced to category `resource-load` (3 each in four Chrome cells); no source locations or raw messages/URLs were retained. Firefox recorded none. The underlying resource-load causes remain unknown; do not claim error-free console behavior.

No fixtures or domain data were changed; auth/session and read-marker traffic is listed separately. Runtime was reused, with no start/stop/restart. No product edits, Linear updates, commit, push, merge, deployment, or full legacy E2E. Earlier receipts remain immutable and their limitations are not erased by this final run.

**Next:** root reviews this receipt and decides the stage gate. If more evidence is wanted, resolve the specific absent draft/owned-pack prerequisites or correct compact overflow navigation in a separately authorized pool. Native popup/zoom remain human evidence, not covered here.

## Offline resolver correction after root review (no new browser run)

The final receipt's `count=0` from exact `getByLabel(...)` **does not prove the global pack list is empty**. In `GlobalStickerPackManager.tsx`, `Мои общие паки` is a text node inside a wrapping `<label>` around a conditional native `<select>` (`packs.length > 0`). `StickerPackManager.tsx` similarly wraps its native selects in labels whose text also includes option text. Playwright's exact accessible-name queries therefore did not faithfully match source label semantics. The receipt's owner-select and campaign subject/audience/send-policy results are downgraded to **harness locator unresolved**; no conclusion about pack/draft existence or product behavior is supported.

The ignored helper now resolves these source controls through their actual wrapping labels, scoped to the owning manager/fields container, with label-prefix matching and nested `select`. The owned-pack label/select counts are recorded separately; only a successfully resolved select can establish whether a row exists. Campaign labels mapped from source: `Тип набора`, conditional `Игрок` / `Персонаж`, `Кто может видеть`, and `Кто может отправлять`. Filter remains the explicit `aria-label="Фильтр файлов по типу"`.

Compact layout does not expose the desktop `.workspace-nav` at all. Source `CompactNavigation.tsx` renders `#compact-nav-menu`; `CompactMenuSurface.tsx` exposes role-filtered `button.compact-menu-tile` entries, and selecting a workspace switches the compact surface to journal. The helper now maps compact `media` → tile `Файлы`, `setup` → tile `Подготовка`, and `characters` → `#compact-nav-character`; it does not attempt to click the desktop overflow summary on compact. This is source-derived navigation, not yet browser-verified.

Request diagnostics were added offline to the ignored helper: response status/method/resource type/phase plus only a coarse allowlisted endpoint family (`api:<top-level-known-family>`, `api:other`, `frontend:root`, or `frontend:nonroot`); request failures record the same safe family without failure text. Query strings, arbitrary path segments, tokens, bodies, and raw URLs are discarded. The previous receipt's 12 `resource-load` console categories remain unresolved; these new event fields can identify a corresponding failed request only in a future authorized run and cannot retrospectively classify old events.

- No browser/runtime/API/DB/fixture activity occurred in this offline correction; no source/product edits were made.
- `node --check .tmp/uix644-reachable-controls-final.qa.mjs` passed; `git diff --check` for this plan had no whitespace errors (Git fsmonitor IPC warning only).
- Current helper is intentionally not run. Root review is required before one narrowly scoped connected follow-up for the newly source-correct native labels and compact menu navigation. It must not replay already accepted desktop StatLayoutCard/tooltip cases; preserve the prior receipt and its measured 0 domain-write audit / 12 unknown-cause Chrome resource-load errors.

## Source-corrected missing-cases run attempt — stopped before browser (2026-10-09)

One authorized attempt used the focused helper, but stopped during existing-runtime preflight before either health status was obtained or any browser/cell was created. The sanitized receipt records only `stage=existing-runtime-preflight`, `errorName=TypeError`; the helper intentionally discarded the raw exception text. Therefore this does **not** establish runtime health/outage, control results, or request/domain-write behavior. No automatic retry or fallback transport was attempted.

- Exact command: `node .tmp/uix644-reachable-controls-final.qa.mjs`; process exit `0` because the helper caught the preflight failure and wrote its receipt.
- Immutable sanitized receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-missing-cases-20261009-041824266Z.json`; SHA-256 `6b87d3b89fba95f025feae2aad94028aea105906d1479ac64cb9ac677d5a29e1`.
- No cells/browser contexts were created; no cell audit exists. Receipt aggregate zeros are empty-run counters, not evidence of a successful zero-write browser gate.
- Helper SHA-256 for the attempt: `b449f3bce398731824f2c64a35c90e1ab7b44a4e9c0e636b8ed226764453110a`.
- Product source SHA `52013d43e6f2fca1bb268c38608afde9cd76424a`; docs HEAD at attempt `30bbb5b57456ce7f0345c44547bc46d2b084351c`.

Gate outcome remains **unrun / blocked at runtime preflight**, not PASS or product failure. Stop here per no-auto-retry instruction; root may decide whether a fresh authorization/runtime diagnosis is appropriate. The prior successful partial six-cell receipt and its 0 measured domain writes / 12 unresolved Chrome `resource-load` events remain unchanged.

## Root-executed missing-cases gate receipt + offline audit correction (2026-10-09)

Root ran the focused six-cell helper elevated after my earlier sandbox-only preflight failure. The receipt is immutable and is **partial**, not a control-pool PASS:

- Receipt `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-missing-cases-20261009-041920904Z.json`, SHA-256 `aae1c0d7f73e23e15677b88386e2809708434cdde03d96d4e74093fa8e0c2f3a`.
- Cells: GM Chrome/Firefox desktop and compact; PLAYER Chrome/Firefox compact. All six completed; no automatic retries.
- GM desktop Files route/structural dialog passed, but manager and all campaign native selects remained blocked by unresolved source-label locators. GM compact Files tile navigation failed resolver reachability, so compact Files/native/filter/StatLayout owner checks were not exercised. Do not infer absent packs, drafts, files, or product defects from those counts.
- PLAYER Chrome and Firefox compact passed role-based Files tile absence and runtime character StatLayout-control absence.
- Measured audit: 80 GETs, 6 auth writes, 2 read-marker writes, **0 domain writes**, 0 client-log posts, 0 page errors. Nine HTTP failures (401/403) and nine Chrome console `resource-load` errors were counted. The receipt mislabeled those proxy `/api/...` failures as `frontend:nonroot` because endpoint classification checked origin before pathname; paths/raw messages were not retained, so exact endpoint/cause cannot be recovered retrospectively. Firefox console errors: 0.

Root offline review found the harness still had a resolver defect despite JavaScript syntax validity: constructor-regex escaping could match literal backslashes rather than whitespace; compact tile selection used a brittle nested locator. The source maps are confirmed: `GlobalStickerPackManager.tsx` and `StickerPackManager.tsx` wrap native `<select>` controls in labels; `CompactMenuSurface.tsx` renders each `button.compact-menu-tile` with a `.compact-menu-tile-label` span containing the workspace item label only (`workspace-nav.ts` supplies `Файлы` / `Подготовка`). The compact route should match that span text and resolve the enclosing button, not infer from an aggregate button description.

Offline helper correction now centralizes a tested `nestedLabelPrefixPattern`, exact source-label span comparison, and `safeLocalEndpointFamily` that classifies `/api` paths before considering Vite proxy origin. Endpoint families are allowlisted; all dynamic path segments, queries, bodies, and raw URLs remain excluded. New deterministic resolver tests passed 3/3: option-bearing Russian nested label prefixes/negative label, exact compact labels/negative aggregate text, proxy API + auth + operator route families and external URL redaction. Existing audit bookkeeping self-checks also pass 3/3; `node --check` passes helper and resolver module. No browser/runtime/fixture/product edits occurred for this offline correction.

- Corrected helper and resolver unit tests are still awaiting root review; no browser rerun is authorized by this checkpoint.
- Prior receipts, including the 0-domain-write and nine HTTP failure counts above, remain unchanged. This attempt proves PLAYER compact role behavior only; the remaining GM native and compact controls are still unverified.

## Root corrected missing-cases receipt + final offline locator diagnosis (2026-10-09)

Root executed the corrected helper once. This yields meaningful compact-role evidence but still does **not** close the native-select control pool:

- Receipt `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-missing-cases-20261009-042216928Z.json`, SHA-256 `ac81bed7d8dbd8385a0e53ac72cd1fdbd035d14808f42847b111287a13d6219c`.
- GM compact Chrome and Firefox: Files destination, global manager disclosure, MediaPanel filter via DOM select, Character StatLayoutCard owner, and Setup Catalog StatLayoutCard owner all PASS.
- PLAYER compact Chrome and Firefox: role-based absence of Files tile and runtime character StatLayout controls PASS_NOT_APPLICABLE.
- GM desktop Chrome and Firefox: Files structural route passes, but owned-pack and campaign draft select locators remain BLOCKED (`count=0`); these are unresolved locator outcomes, not proof of empty pack/draft data.
- Aggregate measured: 104 GET, 6 auth writes, 4 read-marker writes, **0 domain writes**, 0 client-log posts, 0 page errors. Nine Chrome console `resource-load` events. Per cell the response audit saw two `GET api:bootstrap` 401 and one GET 403 in a then-`api:other` family; those 403s are not classified/waived. Raw paths/bodies remain absent, so do not infer 404 media failures or specific endpoint behavior.

The last offline diagnosis found the remaining native-label mismatch: `(?=\\s|$)` required a separator after the label caption, while browser label `textContent` may concatenate caption and option labels without whitespace (for example `Тип набораКампанияПерсонаж`). `nestedLabelPrefixPattern` now matches only the anchored, escaped source caption prefix without a trailing boundary, scoped to the source-owned wrapping label. Deterministic tests now include both separated and concatenated label/option text and reject an unrelated label. The compact tile resolver uses exact text from the source `.compact-menu-tile-label` span and a unique accessible-name button locator; the latest receipt confirms that route.

Endpoint family allowlisting now covers source-observed `/api/operator/feedback` and `/api/feedback/*` families in addition to GM/player routes; API classification runs before the Vite proxy-origin check, and IDs/query values remain omitted. The prior receipt's `api:other` 403 remains unknown retrospectively. No assertion is made that those responses are expected.

Verification: resolver tests 3/3 and bookkeeping tests 3/3; `node --check` passes helper/module. This was offline only; no further browser run, fixture/data mutation, product edit, Linear update, or commit. Native select control behavior remains blocked pending an approved future gate; compact route/owners now have positive evidence. Retain all prior receipts and their evidence limits.

## Next native-select-only helper ready for root gate (2026-10-09; no browser)

At HEAD `691d352582961c16963a20c5f368e103bfc3180d` (product source still `52013d43e6f2fca1bb268c38608afde9cd76424a`), prepared the narrowly scoped next helper after root review. This is **offline readiness only**, not runtime evidence.

- Exact planned matrix: four GM cells only — Chrome/Firefox × desktop/compact. Test only the owned global-pack select and five campaign draft native controls (subject, PLAYER branch, CHARACTER branch, audience, send policy). The helper does not repeat accepted tooltips, compact disclosure, MediaPanel filter, StatLayout owners, or PLAYER absence cells.
- Native select lookup now enumerates wrapping `<label>` elements inside the source-owned manager/form, internally reads only their direct text-node fragments, normalizes whitespace and compares to the source caption, then requires exactly one nested visible `<select>`. Receipts retain only match/select counts and select outcome; direct label text, option captions/values, private fixture values and URLs are never emitted. SELECT changes are focus + DOM `selectOption` and immediately restored; no native OS popup or keyboard-popup claim.
- Bootstrap `401` / other HTTP failures retain only status, method, resource type, safe endpoint family and auth phase (`pre-join`, `join-action`, `joined`) so unauthenticated probes are distinguishable from joined traffic. The source-observed operator-feedback family is included; no `401`/`403` is waived by category alone.
- The helper now reads only the authorized GM B route fixture for these cells; it no longer reads Player access credentials. It creates no pack, file, request, membership, or fixture and never submits a form.
- Verification: `node --check .tmp/uix644-reachable-controls-final.qa.mjs`; resolver tests 4/4; bookkeeping tests 3/3. No runtime/browser/API/DB/fixture/product action occurred. Root must run the connected helper separately; this worker did not run it.
- No commit or Linear change. Ignored helper/module/test are the only code-side edits; this tracked gate checkpoint is the only owned document update. The unrelated `docs/plans/uix-644-runtime-coverage.json` remains untouched.

## Root native-select gate receipt — exact four-cell outcome (2026-10-09)

Root ran the source-caption/native-select helper once at current product SHA `52013d43e6f2fca1bb268c38608afde9cd76424a`, docs HEAD `691d352582961c16963a20c5f368e103bfc3180d`:

- Immutable receipt: `.data/qa-prep/uix644-reachable-controls-20261009/reachable-controls-missing-cases-20261009-042937736Z.json`, SHA-256 `9b845600f6302075b5d6d444766fe6c6119582d7499896b4c8386a3a1d117464`.
- Four contexts: GM Chrome desktop, GM Firefox desktop, GM Chrome compact viewport, GM Firefox compact viewport; runtime API/Vite and each route/bootstrap returned 200.
- **All 24 named native-select checks passed:** global owned-pack select plus campaign subject, PLAYER branch, CHARACTER branch, audience, and send policy in each context. Each control had one source-direct label match and one visible select; values changed under focused DOM `selectOption` and restored. Conditional PLAYER/CHARACTER branches were reached. Option counts were 2 / 4 / 3 / 3 / 2 / 2, respectively; no option names/values were retained. The receipt's generic cell status `COMPLETED_WITH_BLOCKED_OR_PARTIAL` is broader than these named case outcomes; for this pool the six target assertions per cell are PASS.
- This is **DOM-value interaction only**. No native OS select popup, keyboard-driven popup, true zoom, hardware/accessibility acceptance, publication or external behavior is proven. Accepted disclosures/filters/StatLayout/tooltip/PLAYER cases were not replayed.
- Measured request audit: 80 GETs, 4 auth writes, 4 read-marker writes, **0 domain writes**, 0 client-log posts, 0 page errors. Six Chrome console errors were categorized `resource-load` (3 per Chrome cell); Firefox 0. Each context also recorded two `GET api:bootstrap` 401 and one `GET api:operator/feedback` 403. The receipt reports callback-time `authPhase=join-action`; that is not enough to assert when each request was initiated or waive the 403. Exact raw paths, response bodies, and console text remain omitted.
- No fixture/campaign/domain mutations, create/upload/submit, server restart, production deploy, push/merge, full legacy E2E, Linear update, or commit.

This closes the narrow native-select DOM-value pool for these four GM contexts only. The public/production stage gate, native popup/device acceptance, auth product readiness, and any other release criteria remain separate. All previous failed/unresolved receipts above remain historical evidence and are not erased by this successful corrected run.
