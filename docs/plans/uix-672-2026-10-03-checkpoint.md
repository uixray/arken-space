# UIX-672 — checkpoint, 2026-10-03

## Decision and scope

- Fix all 39 browser-QA comments before restarting the existing local QA server or its PGlite database.
- Public landing roadmap shows only curated product plans, never a live dump of internal, technical or closed Linear issues.
- Voting uses server-persisted anonymous HttpOnly-cookie identity; deleting the cookie permits another vote. This is disclosed in the UI.
- No production deployment or merge at this stage.

## Revision and connected pool

- Base commit: `fd6f02d` on `codex/project-roadmap-2026-09-18`; current changes are uncommitted in `.worktrees/uix-421-scene-inputs`.
- Landing: navigation anchors, curated expandable list, real vote API and voting UI. Files: `apps/web/src/AuthGate.tsx`, `AuthGate.test.tsx`, `landing-data.ts`, `landing-public.css`, `apps/server/src/roadmap-votes.ts`, `routes.ts`, `roadmap-votes.integration.test.ts`, `packages/db/src/schema.ts`, Drizzle `0046` and metadata.
- Ability compatibility: legacy data normalization, canonical seed data, distinct `SHORT_REST` enum/trigger, frontend editor option. Files: `apps/server/src/entry-data.ts`, `entry-data.test.ts`, `campaign-clock.ts`, `seed.ts`, `packages/contracts/src/index.ts`, `apps/web/src/CatalogEntryForm.tsx`.
- Shell geometry: token window portal, character workspace width/close affordance, square token preview/upload spacing, collapsed-sidebar zoom placement. Files: `apps/web/src/App.tsx`, `Sidebar.tsx`, `sidebar/CharacterWorkspace.tsx`, `styles.css`.
- Resource layout in progress: `sidebar/ChatPanels.tsx`, `ResourceCounters.tsx`, `styles.css`.

## Verification

- Landing vote API integration tests: 3/3 against ephemeral PGlite; server typecheck passed (agent report).
- Ability normalizer tests: 6/6; contracts typecheck passed (agent report).
- Web typecheck passed after integrating `SHORT_REST` editor option.
- `AuthGate.test.tsx`: 4/4 passed; `git diff --check` passed.
- The prior remote CI revision `fd6f02d`: checks/multiplayer passed; E2E timed out and did **not** pass. New uncommitted changes have no full CI verification.

## Blockers and next action

- Existing QA server (`5173`/`4100`) and persistent PGlite are deliberately not restarted. Its old GM token does not match the newly generated link, so GM browser acceptance remains blocked until the final restart gate.
- Complete remaining character, journal/quick-roll, music/stickers/theme, scene and visual comments; wire short-rest recharge for a single character; test atomic denomination changes.
- Then run connected type/test/browser QA, preserve/back up persistent data, restart local QA once, issue a valid GM link, and request human acceptance. Do not deploy production without separate approval.

## Additional browser feedback pool (same date)

- Resource bars now share a fixed label/value column. Current points may exceed maximum; a distinct second-color layer fills the bar again for temporary excess. `DELTA`/`SET` no longer clamp to maximum, but still reject negatives/non-finite values. Changed `ResourceCounters.tsx`, `resource-regen.ts`, `character-counter-mutation.ts`, tests and `styles.css`.
- Both map zoom and personal music sliders use the active theme accent. The journal toolbar's top rule is removed; composer outer padding and its inner white border are removed. Changed `styles.css`.
- Map toolbar moves object list, token tray and cursor visibility together to a bottom quick-access group after the active tools, separated by a single divider. Changed `MapToolbar.tsx` and `styles.css`.
- Topbar music label shows current asset name or `Композиция 4'33`. Changed `MusicBar.tsx`.
- Border treatment: normal controls and badges rely on surface backgrounds instead of outlines; the general separator alias is softened without hiding focus outlines. Changed `styles.css`. This remains a visual QA candidate, not full acceptance across every theme and screen.
- Verification: web typecheck passed; targeted ResourceCounters, counter mutation, MapToolbar and MusicBar tests passed 71/71. Headless local browser confirmed equal resource bar widths (75.06px at 1200px viewport), bottom toolbar grouping, theme-colored map slider, no composer wrapper borders and music fallback label. No server/database restart.
- Follow-up: character-sheet maximum edits preserve existing temporary excess; server rest cannot accidentally lower an overfilled current resource. Web and server typechecks passed after these changes. Browser visual review at 1200×918 showed the bottom quick-access group and softer surface hierarchy; both chat composer wrapper border layers computed to zero.

## Narrow-sidebar correction pool

- Player activity feed no longer shows the redundant `ПЕРСОНАЖ ДЛЯ ДЕЙСТВИЙ` caption. Its name remains visible. The one-tab `События` bar is absent for players; GM tabs are unchanged. Journal filter control uses a settings icon rather than a visible text label, retaining its accessible name.
- The old absolute-position rule for map object list was overriding DOM order; the object, token and cursor shortcuts now occupy the same bottom group. Token summary matches button sizing/padding/background and keeps a focus-visible outline.
- Resource rows stay one line at 300px sidebar width (28px row height and equal ~42px bar widths in headless QA). Regen stops at maximum and is disabled when already full/overfull, while `+` and manual entry may still exceed it.
- Verification: web typecheck passed; 48/48 focused resource/toolbar/chat tests and 7/7 Sidebar tests passed. `ChatPanels.scope.test.tsx` could not load because Vitest encountered an existing external Gravity UI `.css` import issue; no tests in that suite executed. Headless QA confirmed no player tab bar/caption and equal aligned bottom buttons. No server/database restart.

## Sidebar regression and dice strip pool

- New browser evidence reported a blank journal/sidebar. On the user's still-open `localhost:5173` tab, the accessibility tree currently contains the full resource controls, quick rolls, journal entries and composer; the browser error log is empty. The blank state could not be reproduced after the report, so it is not marked resolved and needs a post-restart regression check.
- Dice toolbar was wrapping its last visibility button because the tray was capped at half the map width. Changed `apps/web/src/styles.css` and `apps/web/src/mobile-foundation.css`: one non-wrapping row, up to 420px or available map width, horizontal scrolling only when narrower.
- Browser QA on the user's 1200px tab found all dice and mode controls on the same row (top 866–869px; no second row); the journal content was present. `DiceTrayPanel.dom.test.tsx` passed 3/3 and `git diff --check` passed. Local server and database were not restarted.
- Next: continue remaining quick-roll/character/journal pools, then verify blank-sidebar regression again during final QA gate.

## Theme and character-label pool

- Replaced the player's theme dropdown with an accessible radio list of the same server-published options; selection still previews without saving and retains apply/reset/cancel semantics. Changed `apps/web/src/design-system/PlayerThemeSettings.tsx`, `.css`, and its tests. GM's separate default-theme field is intentionally unchanged.
- Changed the character header chip label from `Казна` to `Кошелёк` in `apps/web/src/sidebar/CharacterWorkspace.tsx`.
- Web typecheck and `git diff --check` passed. The theme test suite could not load because of the existing external Gravity UI `.css` import issue (zero tests executed); this change still needs browser QA. No server/database restart.
- Roughly twenty-plus of the original detailed comments remain, concentrated in character-sheet restructuring, quick-roll groups/action metadata, roll history layout, stickers/music, and atomic wallet behavior. This is a pool estimate, not an acceptance claim.

## Quick-roll grouping pool

- `apps/web/src/sidebar/ChatPanels.tsx` now passes campaign layout group identity to quick rolls and wires catalog entry actions. `QuickRollPanel.tsx` separates ordinary stats, combat stats, legacy/catalog skills and abilities; catalog entries have an explicit information button that sends `SHARE` without execution or use consumption. `styles.css` gives groups restrained spacing/backgrounds. The main entry button keeps `EXECUTE` behavior.
- Added grouping/SHARE test to `apps/web/src/sidebar/panel-resize-placement.test.tsx`. Web typecheck passed; focused quick-roll tests passed 4/4; `git diff --check` passed. `ChatPanels.suggestions.dom.test.tsx` remains unable to load due the external Gravity UI CSS issue, so that suite has zero executed tests.
- Browser QA in the user's live tab showed all four headings, the ability's separate no-use information button, the complete journal sidebar, and no restart. Still need interaction QA for catalog execution against final restarted backend and broader responsive visual review.
- Next: character-sheet layout and atomic wallet behavior, then chat/roll rendering and media/theme QA.

## Wallet and character rail pool

- `apps/web/src/wallet.ts` now spends a silver or copper coin by breaking a higher denomination when needed (`10 gold, 0 silver` minus one silver becomes `9 gold, 9 silver`). Gold and advancement points remain independent; existing non-normalized amounts remain unchanged. `CharacterWorkspace.tsx` enables a decrement when exchange is possible and sends the resulting multi-field wallet as one absolute counters PATCH. It deliberately does not retry this exchange as a relative numeric delta after a revision conflict, which could otherwise mint coins if another editor spent the higher coin first. Added wallet unit coverage.
- With exactly one visible character, `CharacterWorkspace.tsx` omits the redundant character rail, keeps a one-column sheet, and places create/archive actions in the header. For multiple characters, rail items show name and state on separate lines. Changed `styles.css`.
- Verification: web typecheck passed; wallet/counter/character access tests passed 34/34; `git diff --check` passed. Live browser QA with one-character player showed `is-single-character`, no rail, one 743px column, and header create action. The workspace was closed again after inspection. No QA server or database restart.
- Next: roll/journal rendering and remaining character-sheet structure. Multi-character rail and wallet conflict behavior need final integration/browser QA.

## Roll journal presentation pool

- `apps/web/src/activity-roll-controls.ts` parses the existing stored physical-roll sentence into a compact presentation without altering persisted chat text; test covers ordinary and advantage modes. `ChatPanels.tsx` now shows a short physical-roll title and formula below rather than the full repeated instruction, keeps critical outcome beside the roll title, and shows a die-value polygon and summed modifier to the right of a computed total when those data are present. `styles.css` defines the compact layout and subtle status badge.
- Web typecheck passed, physical-roll tests passed 17/17, and `git diff --check` passed. Browser QA was not completed in this pool because the user's previously open in-app browser tab disappeared before inspection; this remains a visual candidate, not acceptance. No server/database restart.
- Next: inspect remaining character-sheet placement (portrait, backstory, resource duplicate), then broader responsive and runtime QA.

## Character hero and resource placement pool

- `apps/web/src/sidebar/CharacterWorkspace.tsx` places the backstory disclosure immediately under the character name, makes current/maximum resource values editable in the top vitals with progress (including a second color for excess), removes the duplicate lower primary-resource cards and duplicate short-rest button, and removes roll-mode selection from the hero. The two top combat chips (initiative/reaction) are roll buttons; melee is no longer in that summary. `styles.css` supports compact inputs and progress.
- Web typecheck passed; character access/counter tests passed 27/27; `git diff --check` passed. The action-feedback suite again failed to load because of the pre-existing external Gravity UI CSS import issue (zero tests executed).
- A fresh hidden in-app browser tab on the still-running QA server confirmed backstory inside hero, four editable resource inputs, zero old primary-resource cards, one short-rest button, and no hero roll-mode control. Visual inspection initially exposed number spinners obscuring 28/8 and 47/20; widening the fields and suppressing spinners made all numbers legible. No server/database restart.
- Next: portrait editor behind portrait click, skill-card layout, then full responsive/runtime QA and remaining comments.

## Portrait dialog and short-rest recharge pool

- The hero portrait is now the sole entry point for portrait editing: clicking its accessible avatar button opens the existing picker/upload UI in a dialog. The duplicate full-height portrait card is removed from the sheet; the control closes and disables when character or edit permission changes. Changed `apps/web/src/sidebar/CharacterWorkspace.tsx`, `apps/web/src/styles.css`, and portrait access tests.
- A character-sheet `SHORT`/`LONG` rest now recharges eligible catalog ability uses in the same counters transaction, scoped to that character. Rest succeeds even when primary resources are already full. `SHORT_REST` restores only short-rest uses; normal day/other-character entries remain untouched. Changed `apps/server/src/campaign-clock.ts`, `apps/server/src/routes.ts`, and integration tests.
- Verification: character access tests 17/17; server catalog integration tests 8/8; web and server typechecks; `git diff --check`. The integration runner initially loaded stale built `@arken/contracts` and failed the new recharge assertion; rebuilding contracts, then rerunning passed. Hidden browser QA confirmed the avatar dialog opens and the duplicate card is absent. No existing QA server/database restart.
- Next: refine ability-card presentation and verify remaining character/journal comments, then connected browser and backend QA at the final local restart gate. Production deployment remains out of scope without explicit approval.

## Ability-card surface cleanup

- Removed the extra outline from character action/chat cards and the separating rule between each skill/ability row. Rows and cards now rely on layered surfaces and small radii, following the user's border-reduction request. Changed `apps/web/src/styles.css`.
- Verification: web typecheck and `git diff --check` passed. Visual browser acceptance for this exact change remains pending the final connected QA pass; no server restart.

## Roll clarity and rest semantics pool

- Browser QA of the existing roll history exposed misleading text for advantage/disadvantage: `poolTotals` include modifiers, while the selected die chip shows the raw face. Renamed the breakdown phrase to `Итоги попыток` so `1d20 (10) · +2` and `12/14 → 12` no longer appear to disagree. Changed `apps/web/src/dice-result.ts` and tests. Live localhost DOM confirmed the corrected wording without restarting the server.
- A long rest now restores `SHORT_REST` catalog uses as well as day/week uses, scoped to the resting character; short rest still leaves day uses untouched. Changed `apps/server/src/campaign-clock.ts` and the existing PGlite integration test. The test verifies short then long rest and isolation from another character.
- Browser inspection confirmed the ability card's computed border is `0px`, the layered surface is present, and the journal/sidebar is populated; this is a narrow check, not responsive/theme acceptance.
- Verification: 17/17 focused server and dice-result tests; server and web typechecks; `git diff --check`. Existing QA server and persistent database remain untouched. Next: finish remaining UI comment reconciliation, then the final local restart/QA gate.

## Connected test/build gate (same worktree, no QA restart)

- A full Vitest run exposed 35 failures. Corrected actual regressions rather than treating targeted passes as broad evidence: no-op rest now returns 400 and rolls back revision/journal unless an ability was recharged; portrait-dialog tests open the editor as users do; action-context tests supply the required provider and follow the removed player caption; roll-layout and icon guard expectations match the new markup.
- The new public voting table is now in both backup/restore count allowlists, the new global `:itemId` route has an explicit `PUBLIC_ROADMAP` isolation policy, and architecture counts/migration range reflect migration `0046`. The removed player theme popup is reconciled in the static overlay index and runtime ledger, with historical evidence kept separate. In-flow backstory is classified as a section, not a dismissible popup.
- `eslint.config.js` ignores only generated Storybook output and local `.tmp-*` probes, which were causing tens of thousands of irrelevant lint errors. One unused test variable was removed. Offline `pnpm install --frozen-lockfile` aligned the worktree's `@axe-core/playwright` dependency with `playwright-core@1.62.1`; no lockfile change or server restart.
- Verification after corrections: full Vitest **743 files / 2515 tests passed, 0 failed**; full `pnpm typecheck` passed; `pnpm exec eslint . --quiet` passed; `pnpm build` passed; `git diff --check` passed. ESLint still emits existing non-fatal warnings without `--quiet`. This proves structural/local automated gates only, not the 39-comment visual/browser acceptance or GM login.
- Changed additionally: `apps/server/src/routes.ts`, portrait/action-context/roll/icon/theme tests, `infra/backup/database-counts.sql`, `scripts/restore-rehearsal-core.mjs`, `tests/helpers/campaign-isolation-routes.ts`, `docs/architecture.md`, `docs/plans/uix-644-overlay-sites.json`, `docs/plans/uix-644-runtime-coverage.json`, `docs/plans/uix-644-menu-inventory.md`, `eslint.config.js`.
- Linear UIX-672 remains In Progress. Its Task wording was corrected to the user's explicit decision: only curated public product plans, not the internal Linear backlog. Next: reconcile remaining browser comments (especially music/stickers/media/scene and responsive layouts), then back up persistent local data and run the one final clean GM/PLAYER QA restart gate. No production deployment or merge.

## 2026-10-03 — connected pool: UIX-669 music consent recovery

- Decision: no saved preference means sound is eligible to play; only explicit `false` means personal mute. Browser NotAllowed/Security denial is transient UI state, never persisted as mute.
- Revision: branch `codex/project-roadmap-2026-09-18` (uncommitted, no deploy/restart).
- Changed: `apps/web/src/MusicBar.tsx`, `apps/web/src/MusicBar.test.ts`, `apps/web/src/styles.css`.
- Verification: `pnpm typecheck` passed; focused MusicBar Vitest 30/30; focused ESLint and `git diff --check` passed. Browser GM/PLAYER fresh/repeat and autoplay-policy QA remain unverified.
- Blockers: no known code blocker; final local QA server restart remains deferred until comment pool completion per user gate.
- Next: verify browser sound behavior with fresh and explicitly muted profiles, then reconcile remaining UIX-672 comments and run final full gate.

## 2026-10-03 — player sidebar recovery and music regression pool

- Browser evidence on the running local QA site at 1280×720 exposed the user-reported blank player sidebar: `.sidebar` reserved a 39px grid row for GM chat tabs even though player markup has no tabs, leaving its sole `.panel-scroll` only 39px tall. The DOM still contained journal/resources, so this was a geometry failure, not missing data.
- Changed `apps/web/src/styles.css` and `apps/web/src/mobile-foundation.css`: player sidebar now uses one `minmax(0, 1fr)` row in wide and compact modes. HMR browser verification: wide player content rect grew from 39px to full 676px; at 800×800 compact journal it grew from 44px to full 680px. Resources, rolls, journal and composer became visible. The map dice tray's 11 controls all shared one y-position at 1280×720 and 1200×918, confirming the one-line layout at those widths.
- Expanded `apps/web/src/MusicBar.test.ts` with blocked autoplay and ordinary-gesture retry cases. Focused MusicBar suite 32/32, focused ESLint and `git diff --check` passed. No local server/database restart, production change, or broad final acceptance.
- Next: check player/GM sidebar and music under final clean local restart, then continue unresolved comment reconciliation and full gate.

## 2026-10-03 — music single-attempt correction

- A new regression test showed explicit unmute caused two immediate `HTMLAudioElement.play()` calls: one in the click handler and another in the enabled-state reconciliation effect. Changed `apps/web/src/MusicBar.tsx` to share one in-flight playback attempt for automatic play and direct gesture retries; consent rejection still shows the inline action, and AbortError remains transient.
- Changed `apps/web/src/MusicBar.test.ts`: explicit mute/unmute expects exactly one direct play. Focused MusicBar 33/33, web typecheck and focused ESLint passed. Browser sound-policy behavior still needs final GM/PLAYER QA with an actual selected track.
- No server/database restart or production change. Next: reconcile remaining QA comments and finish the local gate before backend optimization.

## 2026-10-03 — media/source audit and ability formula presentation

- Read-only local QA: player sticker picker opens and its general/own-character categories currently have no available stickers. This is not evidence the saved pack is deployed. UIX-649 remains separately gated for approved art/name/category mapping; no asset import or Figma access was performed.
- The local manual sticker source still contains 106 PNG / 34,826,821 bytes; all 106 SHA-256 values match the saved manifest. PNG headers show all 512×512; 105 are RGBA and one indexed PNG has `tRNS` transparency. This proves file integrity/basic format only, not visual approval, naming, or in-app availability.
- Browser QA of an existing ability result showed raw `2d6 + modifier_0` in the journal despite a saved resolved breakdown `2d6 +17`. Changed `apps/web/src/SkillCards.tsx` to prefer the resolved breakdown for internal modifier placeholders, with a readable fallback when no breakdown exists. Added two regression cases in `SkillCards.test.ts`.
- Verification: focused SkillCards 10/10, web typecheck, focused ESLint, `git diff --check` passed. HMR browser now shows `2d6 +17` in the existing journal card. No server/database restart or production change.
- Next: item-by-item comment reconciliation, clarify approved sticker mapping if this pack is in current scope, then final clean local GM/PLAYER gate.

## 2026-10-03 — consent-error hardening and comment traceability

- `MusicBar.tsx` now also catches a synchronous `HTMLAudioElement.play()` exception, not only a rejected promise. Both paths preserve explicit mute and show the same unobtrusive retry when policy denies playback. Added a synchronous `NotAllowedError` regression case: focused MusicBar 34/34, web typecheck and focused ESLint passed.
- Created `docs/plans/uix-672-comment-reconciliation.md` to separate 12 explicit follow-up comments from original selected-element markers 19–37. It links candidate code/evidence but deliberately does not mark image-only markers accepted: their requested wording and other original markers are unavailable in the current checkpoint. This is a concrete acceptance gap before the promised 39/39 claim and restart gate.
- Next: obtain the missing original comment text, complete reconciliation, then preserve local DB and run clean GM/PLAYER QA. No production deployment.

## 2026-10-03 — character-sheet visual/readability pool

- Browser QA of the player sheet exposed bright borders around four major cards, a duplicated «Характеристики» heading, and a legacy roll button whose name/formula shared one line because Gravity's inner `.g-button__text` overrode the outer flex direction.
- Changed `apps/web/src/styles.css` and `apps/web/src/sidebar/CharacterWorkspace.tsx`: cards now use layered backgrounds without colored outlines, their headings retain category color, the duplicate outer heading is gone, and Gravity's inner button text stacks the roll name above the formula.
- HMR browser check: card computed border `0px`; skill name/formula occupy separate rows; at 800×800 compact the cards stack without horizontal overflow. Focused RollButton/action-feedback tests, web typecheck, focused ESLint, and `git diff --check` passed. Revision remains `fd6f02d` plus uncommitted changes; no server/database restart or production change.
- Blockers: original 39 comment texts remain unavailable, so this is not final visual acceptance. Next: continue responsive/theme and GM/PLAYER checks, then the agreed single clean local restart gate.

## 2026-10-03 — mobile resource geometry regression

- At 390px browser width, the player journal and composer were present, and all dice-tray controls stayed in one horizontally scrollable row. Visual QA exposed a real regression in resource rows: an old compact six-column grid override applied to two current DOM children, squeezing both bars to near-zero width.
- Changed `apps/web/src/mobile-foundation.css`: compact resource rows now use two columns matching the DOM; touch controls use 36px minimum to reserve legible, equal-length bars. Browser HMR verified 85px bars at 390px and 41px bars at 320px, each on one row without horizontal item overflow. At 320px the long «Выносливость» label wraps, but the bar remains visible.
- Verification: browser player viewport 390×844 and 320×720; `git diff --check` passed. Original 1280×720 viewport restored. Revision remains `fd6f02d` plus uncommitted edits; no restart/deploy. Next: check theme and GM variants, then final clean local gate.

## 2026-10-03 — resource-control border reduction

- Changed `apps/web/src/styles.css`: resource decrement/increment/regeneration buttons and the progress track no longer add decorative borders; buttons use the raised surface and hover background instead. Input borders remain to indicate editability; focus treatment is not removed.
- Browser HMR at 390×844 confirmed computed border widths `0px` for all three control types and 85px equal progress widths, with visible button backgrounds. Restored 1280×720 viewport. `git diff --check` passed. Revision `fd6f02d` plus uncommitted edits; no server/database restart or deploy.
- Next: inspect remaining button/badge outline hotspots in player and GM themes, then clean local QA and broad automated gate.

## 2026-10-03 — vital-chip and public-badge surface pool

- Removed decorative strokes from the character vitals container and wallet/resource/combat chips; category color remains in surfaces/text. Also removed outline declarations from landing, capability, roadmap, and guide badges, giving otherwise transparent badges a raised background where needed. Changed `apps/web/src/styles.css` only.
- Browser HMR on the player character sheet confirmed vitals container and all five visible chips compute to `0px` borders and remain distinct/readable. The production web build passed (4746 modules), as did `git diff --check`; the first sandboxed build hit Windows child-process `EPERM`, then passed with the approved unsandboxed retry. This does not verify unseen landing/guide screens or GM themes.
- Revision stays `fd6f02d` plus uncommitted edits. No local server/database restart or production deploy. Next: finish remaining screen/theme QA and reconcile original comments, then the clean local restart and full gate.

## 2026-10-03 — slider theme-matrix browser verification

- Used the player's non-saving theme preview and checked computed `accent-color` on both map-scale and personal-volume range inputs against the active `--accent` in all nine offered themes (Forest, Dragons, Ice, Fire, Gold, Silver, Light, Legacy, System). All nine matched; canceled preview and confirmed the saved Forest accent `#77ad78` returned.
- No code changed in this pool. This closes the computed-style part of explicit comments A2–A3, not actual pixel-level thumb/track acceptance. Revision remains `fd6f02d` plus uncommitted changes; no server/database restart or production deploy.
- Next: visual GM/PLAYER check with the final local restart, plus the still-missing original comment wording and full release gates.

## 2026-10-03 — resource overfill persistence regression

- Found a client-side save bug: manual character-sheet resource edits above maximum were silently clamped in `applyResourceMapPatch`, although quick sidebar edits and the server contract allow overfill. Regeneration remains capped at maximum.
- Changed `apps/web/src/character-counter-mutation.ts` to preserve nonnegative finite current values, including fractional custom resources; updated `apps/web/src/character-counter-mutation.test.ts` and added persisted PATCH/GET PGlite regression in `tests/pool-b-http.test.ts`.
- Verification: focused client tests 39/39, targeted server integration 1/1, web typecheck, focused ESLint and `git diff --check` passed. Revision `fd6f02d` plus uncommitted edits. No local server/database restart or production deploy.
- Blockers: original 39 comment texts remain unavailable; final clean local GM/PLAYER and broad release gates still open. Next: continue comment/theme reconciliation, then agreed local restart and full validation.

## 2026-10-03 — integrated automated validation pool

- Ran the current worktree's default full Vitest suite after the overfill fix: 298 files and 2525 tests passed. Root `pnpm typecheck` and `pnpm build` passed across the workspace; root `pnpm lint` exited 0 with 22 warnings (0 errors). `git diff --check` passed in the prior pool.
- The production web build reports a >500 kB chunk advisory (main JS 1,079.10 kB, gzip 319.26 kB); this is a performance follow-up, not a failed build. The 22 lint warnings include a newly visible `MusicBar.tsx` effect-dependency warning and older warnings elsewhere; neither is silently treated as clean lint.
- No code or runtime data changed in this pool. Revision `fd6f02d` plus uncommitted edits. No local server/database restart or production deploy.
- Next: finish comment/browser acceptance and the agreed clean local QA restart, then security/backup/performance release gates. Original 39 comment wording remains missing, so automated green alone does not prove acceptance.

## 2026-10-03 — music retry effect dependency cleanup

- The broad lint run exposed a new `MusicBar.tsx` effect-dependency warning in the blocked-autoplay gesture handler. Inlined the gesture retry at the listener site so its captured conditions stay explicit while the existing direct enable action continues to use `retryPlayback`.
- Verification: focused MusicBar tests 34/34 (including ordinary pointer gesture retry), web typecheck, direct ESLint of `MusicBar.tsx` with zero warnings, and `git diff --check` passed. Changed `apps/web/src/MusicBar.tsx` only. Revision `fd6f02d` plus uncommitted edits; no local server/database restart or production change.
- Next: final browser GM/PLAYER/music acceptance after the agreed clean local QA restart, then release gates. Other repository-wide lint warnings and the large bundle advisory are still open follow-ups.

## 2026-10-03 — isolated browser regression pool

- Ran Chromium Playwright on a separate Vite port (`E2E_PORT=5174`) with API-mocked fixtures; the running QA server/campaign was not restarted or mutated. Initial failures exposed stale test expectations, not evidence of a new UI defect: backstory moved from `.subsection` to the hero, the resource disclosure gained an icon, manual plus now intentionally allows overfill, and compact controls use 36px targets to keep the bars on one row.
- Updated `tests/e2e/compact-player-sheet.spec.ts` and `tests/e2e/resource-counter-icons.spec.ts` to assert the current intended UX without dropping their keyboard/focus, hit-testing, GM/PLAYER, wide/narrow, or draft-persistence checks. All 5 Chromium scenarios now pass (1 compact sheet + GM/PLAYER at 1280/360). E2E typecheck, focused ESLint, and `git diff --check` passed.
- Revision `fd6f02d` plus uncommitted edits. This is isolated browser evidence, not the final live QA restart or production acceptance. Next: live post-restart GM/PLAYER/theme/music gate once comment reconciliation is ready; full E2E and release/security/backup gates remain.

## 2026-10-03 — cross-browser and map/theme browser pool

- Repeated the compact sheet and resource control matrix in Firefox: all 5 scenarios passed, complementing 5/5 Chromium. GM/PLAYER and 1280/360 resource geometry, keyboard focus, hit targets, and pending backstory persistence now have isolated cross-browser evidence.
- Additional isolated Chromium run initially found stale E2E contracts: the map's `MAP_OBJECTS` panel shortcut has `aria-pressed` but is not an active map mode, and theme settings now use inline radios rather than a portal combobox. Updated `tests/e2e/map-tool-icon-states.spec.ts` and `tests/e2e/player-theme-surfaces.spec.ts` to scope active modes to `.toolbar-group` and assert visible/checked/hittable radio rows. Added a geometry/divider assertion that the object shortcut sits below active tools. Map/theme 8/8 passed; music/pause icon scenarios 2/2 also passed in the initial run. E2E typecheck, focused ESLint and `git diff --check` passed.
- The browser emitted repeated Konva 6–7 layer performance advisories; no measured latency regression was established. Revision `fd6f02d` plus uncommitted edits. No current QA-server restart, campaign mutation, or production deploy.
- Next: final live QA and the remaining release gates; investigate map layer/bundle performance only after the bug/comment gate. Original 39 comment wording still needed for complete acceptance.

## 2026-10-03 — sidebar/dice layout regression gate

- Added `tests/e2e/comment-layout-regressions.spec.ts` for the two explicitly reported regressions: visible full-height GM/PLAYER journal/sidebar content and one-row map dice controls at 1200px and 1280px. The mock is read-only and runs on the separate Vite port, so it does not restart or mutate the existing QA campaign.
- Chromium 4/4 and Firefox 4/4 passed. Also ran the existing compact action-target matrix across GM/PLAYER, 360×850, 360×640, 640×360, and both browsers: 12/12 passed. E2E typecheck, focused ESLint, Prettier, and `git diff --check` passed.
- Changed only the new regression spec and this checkpoint. Revision `fd6f02d` plus uncommitted edits. This is isolated browser evidence, not final live QA acceptance. Next: final post-restart GM/PLAYER checks and release gates; original 39 comment texts are still needed to claim full reconciliation.

## 2026-10-03 — compact sidebar/dice extension

- Extended `tests/e2e/comment-layout-regressions.spec.ts` from desktop 1200/1280 to compact 320×720 and 390×844. The test checks the map dice row before switching compact navigation to journal, then confirms the sidebar content has meaningful height and the composer is visible.
- Added compact cases passed in Chromium 4/4 and Firefox 4/4; desktop cases had passed 4/4 in each browser in the prior pool. Prettier, E2E typecheck, focused ESLint and `git diff --check` passed. Revision `fd6f02d` plus uncommitted edits; no local QA-server restart, data mutation, or deploy.
- This directly covers the previously pending smaller-width part of C1–C2 in isolation. Final live post-restart acceptance and original comment-text reconciliation remain open.

## 2026-10-03 — repository formatting gate audit

- Root `pnpm format:check` initially identified seven current-pool files plus two unchanged historical plans. Formatted only the seven touched files (`MusicBar.test.ts`, `MusicBar.tsx`, `SkillCards.tsx`, the UIX-672 checkpoint/audit, `map-tool-icon-states.spec.ts`, `pool-b-http.test.ts`) and confirmed `git diff --check` passes.
- Re-ran the root gate: it now fails **only** on unchanged `docs/plans/uix-405-keyboard-token-move.md` and `docs/plans/uix-507-multi-selection.md`. An attempted write to those unrelated historical docs was rejected by auto-review as out of scope; no workaround or mutation was performed. Asked the user whether to authorize that separate formatting-only diff.
- Revision `fd6f02d` plus uncommitted edits. No runtime or production change. Next: proceed with unaffected QA/release checks while awaiting the formatting scope decision; do not report the root format gate green.

## 2026-10-03 — production dependency security pool

- A fresh read-only `pnpm audit --prod --audit-level high` found 21 production advisories (13 high, 8 moderate) in current locked Fastify, fast-uri, Sharp, ip-address, engine.io and @fastify/busboy versions. Checked patched versions against package registry and upstream Fastify/fast-uri advisories before changing dependencies.
- Changed `package.json` (Fastify dev dependency and transitive overrides), `apps/server/package.json` (Fastify/Sharp) and `pnpm-lock.yaml`; installed with frozen lockfile. Resolved versions: Fastify 5.12.5, fast-uri 4.2.1, Sharp 0.35.4, ip-address 10.7.3, engine.io 6.6.11, @fastify/busboy 3.2.2.
- Verification after update: `pnpm audit --prod --audit-level high` reports no known vulnerabilities; full Vitest 298 files/2525 tests passed; root typecheck and production build passed; lint exited 0 with 21 warnings/0 errors; Sharp native PNG create/read smoke passed; manifest Prettier and `git diff --check` passed. These are local/library checks, not production deployment or live environment acceptance.
- Revision `fd6f02d` plus uncommitted edits. No local QA-server/database restart or production change. Next: finish live GM/PLAYER and full E2E/release gates, and await the user's decision about the two unrelated historical Markdown files that keep root format:check red.

## 2026-10-03 — compact composer edge regression

- Extended `tests/e2e/comment-layout-regressions.spec.ts` to assert the journal-toolbar has no top border and the single-message composer has no textarea border/shadow or extra inset between the form and input. Isolated Chromium initially failed all four compact cases: `mobile-foundation.css` restored an 8px padding via `.app-shell--compact .chat-compose`, overriding the intended flush `.chat-compose--single` styling.
- Added a compact-specific zero-padding rule in `apps/web/src/mobile-foundation.css`. Re-ran GM/PLAYER at 320/390/1200/1280: Chromium 8/8 and Firefox 8/8 passed. Focused Prettier, E2E typecheck, ESLint, and `git diff --check` passed. This closes an actual responsive bug in explicit comment A5; final live visual acceptance remains.
- Revision `fd6f02d` plus uncommitted edits. No local QA-server/database restart or production deploy. Next: remaining comment/live gate and release checks.

## 2026-10-03 — overfill bar browser contract

- Added `tests/e2e/resource-overfill-layout.spec.ts` with a read-only API fixture containing both stamina and mana above maximum. It verifies equal progress-track widths, a full base fill with fractional second-color overlay (14/10 and 8/6), ARIA overfill text, disabled regeneration, and enabled manual plus across GM/PLAYER at 320/390/1280.
- Chromium 6/6 and Firefox 6/6 passed on the separate Vite test port. E2E typecheck, focused Prettier/ESLint and `git diff --check` passed. This strengthens explicit A1/B4/B5 acceptance evidence without mutating campaign state; live post-restart visual check remains.
- Revision `fd6f02d` plus uncommitted edits. No QA-server restart or production deploy. Next: remaining browser comments and release gates; original 39 comment wording and the unrelated historical-format decision remain pending.

## 2026-10-03 — map shortcut interaction gate

- Extended `tests/e2e/map-tool-icon-states.spec.ts` to check the token shortcut's ordinary button geometry, nontransparent surface, horizontal padding, accessible count, and open/close interaction. The object shortcut's position below active modes and separator were already asserted in this spec.
- Isolated Chromium and Firefox GM/PLAYER at 1280/360 passed 8/8. E2E typecheck, focused ESLint, Prettier, and `git diff --check` passed. Konva still reports 6–7 layers during these tests; no measured latency or safe layer-reduction hypothesis yet.
- Revision `fd6f02d` plus uncommitted edits. No current QA-server/database restart or production deploy. Next: clean local QA restart and live visual acceptance after preserving campaign data, plus missing original comment text. Backend optimization should be measurement-led using an isolated database copy; the existing broadcast measurement script explicitly can write while reading, so it must not run against live data.

## 2026-10-03 — complete shortcut-group ordering check

- Extended `tests/e2e/map-tool-icon-states.spec.ts` to assert that the bottom shortcut group contains exactly Objects, Tokens and Cursors in that order, separate from the active mode group. The prior pool already covered the token button's appearance and tray interaction.
- Isolated Chromium GM/PLAYER at 1280/360 passed 4/4; focused ESLint, E2E typecheck, Prettier and `git diff --check` passed. Firefox 8/8 passed for the preceding group/interaction contract, but the newly added exact-order assertion has not yet been rerun there.
- Revision `fd6f02d` plus uncommitted edits. No local QA data or production change. Next: stop adding narrow toolbar checks; move to broader live release QA only after the original comment-text gate and safe local-data preservation.

## 2026-10-03 — character ability formula presentation bug

- Read-only AX inspection of the currently open character sheet still exposed the technical key `2d6 + intelligence` in the ability card, while the journal renderer already humanized stat keys. `CharacterActionCard` was rendering the stored `dice` string raw despite being inside `CampaignStatLabelsProvider`.
- Changed `apps/web/src/SkillCards.tsx` to humanize the action formula for display only; added a regression to `apps/web/src/SkillCards.test.ts` proving the localized label appears and the raw stored formula remains unchanged for execution. Focused Vitest 11/11, web typecheck, focused ESLint, Prettier and `git diff --check` passed.
- The still-running `localhost:5173` tab continued to show the old raw text after this edit, so it is **not** live acceptance evidence for the current worktree; its process/build provenance must be checked at the final clean local restart. Revision `fd6f02d` plus uncommitted edits. No local QA data or production change. Next: verify this in isolated current-build browser QA, then final preserved-data restart and GM/PLAYER acceptance once the original comment-text gate is resolved.

## 2026-10-03 — current-build ability-card browser gate

- Extended `tests/e2e/skill-cards.spec.ts` with a real rendered ability-card formula fixture at 1280/360. The isolated current-worktree Vite browser shows `2d6 + Интеллект`, not the stored technical key. Chromium passed both widths; the read-only mock did not touch the QA campaign.
- The broader Chromium skill-card suite revealed stale E2E expectations after shell/journal changes. Updated `tests/e2e/workspace-nav-helper.ts` for the direct compact character tab and `tests/e2e/skill-cards.spec.ts` for the always-visible journal and accessible roll-total label. Localized-formula, execute/reload, and passive-share cases then passed 6/6; E2E typecheck, focused ESLint, Prettier and `git diff --check` passed.
- The first broad run was interrupted after repeated failures in the remaining catalog conditional-dropdown cases (some took 1.5 minutes each). They were **not** green; one failure measured a menu at the wrong vertical position, and other catalog cases need focused diagnosis before a full E2E gate can pass. Revision `fd6f02d` plus uncommitted edits; no QA-server/database restart or production deploy. Next: diagnose those catalog popup cases as one connected pool, not more isolated toolbar checks, then final preserved-data restart and acceptance.

## 2026-10-03 — catalog dialog and E2E recovery pool

- The six catalog dropdown scenarios exposed two real form defects: the catalog description stayed a tiny fixed-height textarea, and its usage checkbox was wrapped in an outer label around the design-system checkbox's own label. Changed `apps/web/src/CatalogEntryForm.tsx` to auto-grow description to its content (capped at half the viewport, with scrolling thereafter) and give the checkbox one proper label. The 12-line growth and shrink checks now pass at 1280/360.
- Updated `tests/e2e/skill-cards.spec.ts` to activate the checkbox through its visible custom label, plus current journal/roll-total selectors and a localized-formula browser regression. Updated `tests/e2e/workspace-nav-helper.ts` for current compact navigation: direct character tab, other sections through the campaign menu. Did not weaken the catalog dropdown assertions.
- Full isolated Chromium `skill-cards.spec.ts` passed **12/12** after the fixes (edit, picker, setup at 1280/360; execute/reload; passive share; formula). Web and E2E typechecks, focused ESLint, touched-file Prettier and `git diff --check` passed. The broader repository E2E suite and Firefox catalog matrix have not been run, and Konva still warns about 6–7 layers. Revision `fd6f02d` plus uncommitted edits; no current QA-server/database restart or production deploy. Next: Firefox catalog/ability matrix, then wider release QA and the preserved-data live restart gate.

## 2026-10-03 — Firefox catalog gate and test isolation

- Full isolated Firefox `skill-cards.spec.ts` initially passed 11/12. The one compact reload failure was a real 401 toast from an **unmocked** API call reaching the separately running, stale local backend; the toast covered the journal tab. This was test-fixture leakage, not proof that the current backend rejects the player.
- Added a fail-closed `**/api/**` fallback to `tests/e2e/skill-cards.spec.ts` before its specific mocked routes, so the scenario cannot hit the existing backend. The focused Firefox reload then passed, followed by the full Firefox matrix **12/12** without retries. E2E typecheck, focused ESLint and Prettier passed; no user campaign mutation.
- Combined current evidence: Chromium 12/12 (before the fallback, same product code) and Firefox 12/12 (after it). Revision `fd6f02d` plus uncommitted edits. Broader E2E and final live restarted-server acceptance remain open; production untouched. Next: broaden isolated UI suite and prepare the local data-preservation/restart gate, while still awaiting original comment wording.

## 2026-10-03 — broader isolated browser and local-data discovery

- The shared navigation helper was exercised beyond skill cards: isolated `navigation-completion.spec.ts` and `character-stat-controls.spec.ts` passed 20/20 across Chromium and Firefox (GM/PLAYER, wide/compact). This is not the full repository E2E suite.
- Read-only process inspection found current listeners on `5173` (Vite PID 26660) and `4100` (tsx server PID 5552), both launched from this worktree. `createPgliteDatabase()` uses a relative `./.data/pglite`, resolved for this server to `apps/server/.data/pglite`; the directory currently contains about 1,305 files / 61 MB. `apps/server/media` also contains campaign media. The local UI remains an old-running process and must not be treated as post-restart backend acceptance.
- Do **not** copy the live PGlite files as a purported consistent backup. At the eventual approved local restart gate: stop the identified server gracefully, cold-copy both PGlite data and media into a dated workspace backup, checksum/verify the copy, then start the current code once and run GM/PLAYER acceptance. No process was stopped, data copied or user state changed in this pool. Revision `fd6f02d` plus uncommitted edits; production untouched. Original 39 comment wording remains the gate before the agreed restart.

## 2026-10-03 — full local validation after browser fixes

- Re-ran the full Vitest suite after the catalog form and browser-test changes: **298 files / 2526 tests passed**. Root `pnpm typecheck` and production `pnpm build` also passed. `git diff --check` passed. The build still warns about large client chunks; this is an optimization item, not a build failure.
- A fresh production dependency audit could not reach the npm audit endpoint (`ECONNREFUSED`), so its earlier clean result was **not reverified** in this pool. Root formatting remains blocked by the same two unchanged historical Markdown files; no scope expansion was made.
- Revision `fd6f02d` plus uncommitted edits. No current QA-server/database restart, campaign mutation, or production deployment. Next: final preserved-data local restart and GM/PLAYER browser acceptance only after the original 39 comment wording/gate is resolved; then measure backend/client performance on isolated data before optimization.

## 2026-10-03 — measured client split experiment, rejected

- The production build's entry JS is 1,079.40 kB (319.40 kB gzip); source-map inspection identified React DOM, Base UI/Floating UI, contracts, and large always-imported app/workspace modules as major contributors. Tried lazy-loading only the GM feedback and world-content workspaces. Their direct chunks were small, but Vite moved shared dialog/picker dependencies into **initially preloaded** chunks: entry became 807.49 kB (233.25 kB gzip) while initial JS across entry and preloads remained about 1,059 kB (roughly 320 kB gzip). The apparent entry reduction did not prove a meaningful initial-transfer win and introduced loading states/requests.
- Reverted that experiment rather than keep a cosmetic bundle-size improvement. `Sidebar.tsx` and its role-access test are back to their pre-experiment behavior; focused role-access 2/2 and Prettier passed. No production or QA-server change. Next optimization should measure total initial transfer/runtime, not only entry-file size, and prioritize a real bottleneck after the unresolved bug/restart gate.

## 2026-10-03 — combined isolated browser regression gate

- Ran the current worktree's comment layout, resource overfill, map shortcut, skill-card/catalog, and operator feedback suites together on isolated Vite port `5174`, Chromium and Firefox, `--retries=0`: **64/64 passed** in 7.2 minutes. These suites use API fixtures/mocks rather than the current QA campaign, so they verify integrated browser behavior without touching its PGlite data. Konva still emitted 6–7-layer performance warnings; no measured interaction regression or safe reduction has been established.
- This is wider than separate focused runs, but not the whole repository E2E suite and not post-restart live QA. Existing `5173`/`4100` services and production were not changed. The original 39 comment text was requested again; selected-element screenshots alone do not close that acceptance gate. Next: reconcile that text, preserve local data and restart once, then GM/PLAYER live acceptance and measurement-led backend optimization.

## 2026-10-03 — backend optimization and restore prerequisites (read-only)

- Confirmed the current player `GET /api/assets/:id/content` path still invokes a full `buildSnapshot` solely to test whether `snapshot.assets` contains one asset (`apps/server/src/routes.ts`, around line 8782). The current asset projection depends on scene, fog-hidden tokens, character control/media/identity, music, world maps and published world content; replacing it with an ad-hoc single query could leak private assets. No unmeasured ACL rewrite was made. This remains a concrete backend performance candidate for an isolated baseline and equivalence tests.
- Local restore tooling is not ready: `docker.exe` exists, but `docker info` returned permission denied on the Docker Desktop Linux pipe; `restic` and `psql` were not found on PATH. This does not establish the status of the production backup; it blocks a local restore rehearsal on this host until Docker access and snapshot credentials/tools are available. The release gate stays open.
- Re-read Linear UIX-672 and its comment: it contains acceptance criteria and a local Validate checkpoint, not the text of all original 39 browser comments. Asked the user for their export/screenshots. No Linear stage change, QA data mutation, or production action. Next: obtain original wording and reconcile item by item; in parallel, design a safe asset-visibility equivalence benchmark on an isolated database rather than guess at optimization.

## 2026-10-03 — audio source replacement regression fixed

- Fresh isolated audio browser matrix exposed an actual player bug: after replacing the URL/version of the currently playing file, the `<audio>` element paused and stayed paused in both Chromium and Firefox, GM and PLAYER. `MusicBar`'s unrelated-snapshot guard compared revision/asset ID/play state but omitted the media URL, so the source-change effect returned before resuming playback.
- Added `sourceUrl` to the playback synchronization identity in `apps/web/src/MusicBar.tsx`. Also repaired the old E2E fixture in `tests/e2e/asset-replacement-audio.spec.ts` to explicitly set personal opt-out before mounting; the app now defaults to enabled, so its former assumed initial pause was invalid. The test still asserts no server audio command, preserved mute/volume, same audio element and resumed playback after URL replacement.
- Full isolated audio suites (`asset-replacement-audio` and `asset-catalog-audio`) passed **12/12** across Chromium/Firefox without retries; web typecheck, `MusicBar` unit tests **34/34**, focused Prettier/ESLint and `git diff --check` passed. Root lint also exited 0 with 21 non-fatal warnings. Revision `fd6f02d` plus uncommitted edits; no current QA server/database restart or production action. Next: browser-comment reconciliation and final preserved-data live QA; release gate remains open.
