# UIX-674 visual pool checkpoint — 2026-10-05

- Base revision: `27f1787`, draft PR #86. Twelve-comment pool remains local and uncommitted.
- Decisions: no production deploy; one connected UI pool and one CI candidate; preserve sticker accessibility labels; theme accent for overfilled resources; fog outline from the composited mask rather than individual operations.
- Changed files: `apps/web/index.html`, new white hat asset, map toolbar and tests, sticker picker and tests, music/roll avatar tests, mobile and main styles, fog renderer plus boundary helper/tests, chat panels and tests, multiplayer spec.
- Verification: typecheck; 88 focused Vitest tests; format check; diff check; production-mode local QA web build. Browser checks at desktop, 685px and 319px for logo, resource bars, toolbar, compact nav and fog outline. QA server, DB and media retained.
- Blockers: PR head `27f1787` CI red. `checks` has 2 stale assertions and `multiplayer` has 1, all repaired locally. Three E2E shards failed; final Firefox shard pending, so logs unavailable.
- Next: inspect terminal E2E failures, repair, run final connected validation, push one candidate, update Linear at stage gate, await CI. No production deploy.

## CI repair pool

- CI run `37287161143` finished red: 42 Chromium shard-2 failures (36 variants of one shell-icon contract plus 6 others), seven mirrored Chromium/Firefox shard-1 failures, and the remaining shard-2 failure set. This is the old PR head, not the local candidate.
- Fixed locally: opaque mode-button backing over map canvas; both icon-only mode buttons in Tab order; compact stat action grid reserves a 44px menu track; short-landscape section navigation is no longer sticky over controls. Updated obsolete player rail/create, scene-ready, and roll-mode-role assertions; quick-roll test now tolerates the formula tooltip in its accessible name.
- Verified locally: representative shell-icon Chromium case, GM-360 Firefox stat controls, compact player-sheet Firefox case, and three concept Firefox cases now pass (the last three after one accessible-name adjustment). No full CI claim.
- Next: classify remaining Chromium shard-2 E2E failures, run connected local checks, then commit/push one candidate and request new CI. Production remains untouched.

## Chromium shard-2 triage

- Six non-icon failures were classified: five stale music-label assertions and one scene-editor focus restoration regression. Updated E2E labels from `Меню музыки` to `Плейлист`; implemented focus return to the exact scene's Configure button after dismissing its nested editor.
- Verified: three representative music Chromium E2E tests, scene-editor Chromium E2E, and the previously failing narrow world-dropdown Chromium E2E pass locally. The world-dropdown failure did not reproduce on current local code, so no speculative change was made.
- Typecheck passed across workspace and E2E configs; diff check passed. Production remains untouched. Next: finish remaining targeted review and one candidate push/CI gate.

## Candidate 6fd33bc CI result

- `checks` and `multiplayer` passed. E2E passed on Chromium shard 2/2 and Firefox shard 2/2; both shard 1/2 jobs failed on the same outdated fixed-width assertion in `GM compact chrome keeps actions discoverable at release width`. No other E2E failures were reported.
- The map-toolbar overflow control is intentionally full width, matching adjacent map tools per browser comment 1. Updated the E2E contract to compare those widths rather than treating it as a 30px topbar icon. Targeted Chromium and Firefox cases pass locally.
- Next: push the focused assertion repair, require complete green CI on that exact new revision, then complete final browser/release gates. Production untouched.

## Candidate 443eafd CI result and select-keyboard repair

- `checks`, `multiplayer`, Chromium 2/2, Firefox 1/2 and Firefox 2/2 passed. Chromium 1/2 had one failure: gallery Category dropdown did not change after Home→Enter in the PLAYER 360px case. The E2E aggregate therefore failed; do not call CI green.
- CI trace frames show the popup closing around Home and reopening around Enter, leaving the old value selected. Eight repeated local runs on the old revision passed, so this is timing-sensitive; the trace, not the local pass, governs the repair.
- Added popup-level Home capture to focus the first enabled option before BaseSelect's item handling, and explicit unit/E2E focus assertions. Select unit suite 9/9 and the gallery/world dropdown E2E matrix 12/12 (Chromium + Firefox, narrow + desktop) pass locally.
- Next: format/typecheck, commit/push, require full CI on exact new SHA. Final browser and host release gates remain open; production untouched.

## Candidate 9bde217 CI result and connected repair — 2026-10-06

- CI: `checks`, `multiplayer`, and both Firefox shards passed; both Chromium shards failed. Shard 1: GM and PLAYER 360px gallery Home-focus assertions. Shard 2: compact GM 360px map-toolbar bottom exceeded the short viewport. Aggregate E2E red.
- Decisions: retain the intended whole-toolbar scroll, but bound its height by the actual compact viewport as well as its map container. Preserve Home keyboard selection; prevent ResizeObserver measurements from stealing option focus, and capture Home on the trigger before BaseSelect's own handler. The long map visual-contract case gets a 120s test timeout because its icon/hover matrix exceeds the previous 30s even on a local isolated run; this is not an assertion relaxation.
- Changed files: `apps/web/src/design-system/Select.tsx`, `apps/web/src/mobile-foundation.css`, `tests/e2e/map-tool-icon-states.spec.ts`.
- Verification: Chromium GM 360px map contract passed; gallery GM/PLAYER 360px repeated three times each (6/6), Select unit 9/9, workspace typecheck, Prettier and diff check passed. A combined first pass of the map matrix timed out after reaching later icon checks; with the focused 120s timeout, GM 360px completed in 34s. Browser QA and full CI on the next exact SHA remain required.
- Blockers: Docker engine for local full-stack QA is off; no production host action was taken. Release gates (green exact-SHA CI, GM/player acceptance, backup/restore, non-live media smoke, explicit deploy authorization) remain open.
- Next: commit/push this connected CI repair, update PR/Linear at stage gate, await complete CI; then perform remaining release checks. Production untouched.
