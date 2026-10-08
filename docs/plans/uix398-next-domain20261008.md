# UIX-398 character actions pool — 2026-10-08

## Decision / revision
- Base a1fef813, current parent2989381. Existing A0 mutation-runners and scene-actions extraction already implemented; did not repeat them.
- Extract coherent character mutation domain from App to useCharacterActions, not broad state/context rewrite. Function-only stable actions; state/refs/setters injected explicitly, transport remains existing API. No measured performance improvement claimed.

## Changed files
- apps/web/src/App.tsx (character controller, optimistic patch/counter queue calls delegate to hook)
- apps/web/src/use-character-actions.ts (controller/patch/counter operations, per-character queue, latest snapshot ref, canonical recovery/rebase)
- apps/web/src/use-character-actions.test.tsx (real hook with transport mock)
- this checkpoint. Other sticker/metadata/root dirty files preserved.

## Verification
- Independent source review finds behavior structurally equivalent: endpoints/payloads, optimistic queue/rebase/conflict recovery, latest snapshot and unchanged DOM/selectors. Controller recovery structurally compared, not directly exercised in new hook tests.
- Supplement first gate found invalid partial snapshot fixture and BodyInit JSON parsing type error. Fixed test fixture to canonical gmSnapshot and runtime string guard; production behavior unchanged.
- Root connected4suite19/19 and official webtypecheck0 passed after fixture fix.
- Final test additions retain explicit stable function-only identity across snapshot replacement/rerender and prove second character write completes while first transport is pending. Final connected gate currently live session90684; acceptance awaits actual final result.
- Not browser/performance/production evidence. No state/selective subscription stage C changes, no full E2E/server/deploy/push.

## Next
- Capture final gate, freeze explicit4file manifest and stage-gate Linear UIX398. Separate backend route-family boundary proposal in read-only review; avoid giant dependency bags or moving recent lock semantics blindly.

## Final accepted gate
- Root finalconnected4files20/20 PASS; official webpackage tsc --noEmit exit0, session90684 finalexit0. Stable interface identity and separate-character completion cases retained. Independent structural/test review accepted prior production paths; final additions straightforward invariant assertions.
- Freeze scope4 files only; no performanceclaim, browser acceptance or controller-failure test claim.
