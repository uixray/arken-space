# ArkenHar Soundpad residual controls inventory

Date: 2026-10-10  
Source revision inspected: `6d037dd057c15d6d8408a48cfcf666d6df41c4a9`

## Scope and evidence

Read-only source/test inventory of emergency stop, cooldown, local effects mute and volume, persistence, autoplay feedback, event deduplication, waveform, and trim. No application files changed in this pool. The already completed publication/reconnect browser proof was not repeated.

## Present in source

- **Stop controls:** GM has a campaign-wide “Остановить эффекты” action (`apps/web/src/SoundpadWorkspace.tsx:207`); server advances a stop generation and emits `soundpad:stopped` (`apps/server/src/realtime.ts:928-932`). Each client stops local voices when that event arrives (`SoundpadWorkspace.tsx:118`). There is also a local effects mute toggle that clears local voices (`SoundpadWorkspace.tsx:139`; `sound-effects-playback.ts:49-52`). There is no distinct local-only panic/stop button separate from mute.
- **Cooldown/rate ceiling:** server runtime applies a 2-second per-member and per-member-per-sound cooldown, plus a ceiling of four campaign events per rolling second (`apps/server/src/soundpad-runtime.ts:37-54`).
- **Mute/volume and persistence:** effects volume and mute are keyed by campaign and membership in `localStorage` (`SoundpadWorkspace.tsx:36-42,138-139`). The playback bus clamps volume and applies it independently of persistent music playback (`sound-effects-playback.ts:1-2,34,46-49`).
- **Autoplay feedback:** a user-gesture silent-audio unlock is attempted; rejection restores the locked state and shows a browser-blocked error (`SoundpadWorkspace.tsx:191-194`). A later effect-voice `play()` rejection is caught and disposes that voice, but does not surface a user-facing error (`sound-effects-playback.ts:40-44`).
- **Event dedupe/reconnect:** local event IDs are deduplicated, the seen set is bounded to 256, and pre-connect events are ignored (`sound-effects-playback.ts:20-29`). Server action IDs dedupe retries and stop-generation fences interrupted commands (`soundpad-runtime.ts:44-57,67-72`).

## Missing from current implementation

- **Primary trim / waveform:** no waveform rendering, trim-start/end state, or trim controls found in the soundpad workspace/playback path. Playback starts at `currentTime = 0` (`sound-effects-playback.ts:30`). Do not implement without a separate product decision; this inventory does not propose silently changing the upload/playback contract.
- **Separate local emergency-stop affordance:** GM-wide stop exists; for an individual listener, mute stops current voices, but there is no separately labeled local stop-all control.

## Test coverage and verification

One scoped test gate at source revision `6d037dd057c15d6d8408a48cfcf666d6df41c4a9`:

```text
pnpm exec vitest run apps/web/src/sound-effects-playback.test.ts apps/web/src/SoundpadWorkspace.dom.test.tsx apps/server/src/soundpad-runtime.test.ts apps/server/src/soundpad-routes.test.ts --reporter=verbose
Test Files  4 passed (4)
Tests       17 passed (17)
```

Coverage includes effect event dedupe and voice bounds; local mute/stop, volume isolation, and late-play cancellation; server duplicate action, cooldown/rate limit, GM-room routing, stop generation; DOM catalogue, reconnect, and playback flows. This gate does **not** directly verify campaign/member localStorage persistence, rejected browser unlock UX, actual GM stop-button interaction across clients, or real-device audio behavior.

## Residual assessment

The inventory found no missing implementation of the existing GM stop, cooldown, local mute/volume persistence, or event dedupe controls. Remaining implementation candidates are the distinct local stop-all affordance and any future trim/waveform feature; both need product scope approval before code. Remaining evidence gaps are persistence/rejected-autoplay/real-device assertions, not proof that the existing source paths are absent. Existing browser publication/reconnect proof is intentionally not repeated in this pool.

## Root scope correction
Trim/waveform is already an explicit UIX-512 acceptance requirement, not a new unrequested idea. It is unimplemented and belongs to a separate bounded implementation pool; no additional product approval is required merely to plan it. It is not silently a blocker for the currently approved friends-first release. A distinct listener-local stop button is optional scope; local mute already stops voices. Existing 6d ZIP remains immutable; this checkpoint-only change does not alter image bytes.

## Direct DOM evidence follow-up
At inspected source5409a96, added tests in apps/web/src/SoundpadWorkspace.dom.test.tsx for persisted volume/mute values, remount restoration and campaign/member isolation, plus rejected silent unlock alert/locked status/blob cleanup. Connected playback+DOM gate2files/13tests PASS; webtypecheck PASS. Source implementation unchanged, no live/device claim. Trim/waveform remains genuine unimplementedAC; late voice play rejection still silent disposal (bounded UX improvement candidate). Current software6d build inputs unchanged (test/docs excluded); immutable ZIP retained.

## Bounded playback failure UX implementation
Added optional playback-bus error callback and existing inline workspace alert for active voice play rejection; no automatic retry/modal. Consecutive errors suppressed until successful playback. Generation/active-voice guards prevent stale errors after stop/mute/disconnect/eviction/unmount; disconnect stops voices. Direct regressions cover notification rearm/suppression, stopped-promise rejection, voice rejection and user unlock retry. Connected2files/15tests + webtypecheck PASS; root reviewed source diff and diff-check. Changed files: sound-effects-playback.ts/test.ts, SoundpadWorkspace.tsx/DOMtest. Actual browser/device verification and new exact web image/package pending; current6d ZIP explicitly remains older accepted candidate, not containing this UX fix.
