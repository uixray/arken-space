# UIX-382 client mixer checkpoint — 2026-10-09

## Decision

Owner-approved behavior: up to four active authorized audio tracks, independent GM transport/mix per track, player-local master and explicit mute, preserving autoplay consent. The client consumes canonical `audioTracks`; it never reconstructs tracks from the legacy singular `audio` field.

## Checkpoint

- **Revision:** working-tree base `530c1677c4c20196f472b1abba0b3c32d15929ee`; changes below are uncommitted. The checkout also contains unrelated root/parallel edits; preserve them.
- **Changed files owned by this pool:** `apps/web/src/MusicBar.tsx`, `apps/web/src/MusicBar.test.ts`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `apps/web/src/use-game-socket-subscriptions.ts`, `apps/web/src/audio-tracks-state.ts`, `apps/web/src/audio-tracks-state.test.ts`, `tests/e2e/uix382-audio-mixer.spec.ts`.
- **Implementation:** stable keyed media elements, maximum four; source replacement remounts/disposes old media; local gain changes do not restart playback; GM transport includes play/pause/seek/loop/mix/add/replace/remove; faders/seek commit on pointer/key release to avoid stale-revision command floods. Per-track realtime state/removal use independent sequence/revision cursors and remove tombstones. Bootstrap/canonical snapshot version seeds an audio-specific floor; unrelated entities do not advance it. Campaign/session closure prevents cross-campaign apply.
- **Verification:** `pnpm --filter @arken/web typecheck` passed. `pnpm --filter @arken/web exec vitest run src/audio-tracks-state.test.ts src/MusicBar.test.ts` passed **40/40** (2 files). `pnpm exec playwright test tests/e2e/uix382-audio-mixer.spec.ts --project=chromium --reporter=line` passed **4/4** desktop/compact GM and PLAYER cases. Browser transport is mocked; reconnect convergence here is fixture/reconciliation evidence, not true network reconnect.
- **Other evidence limits:** no authenticated backend/live campaign, real transport, or device autoplay acceptance was tested. Test DOM emits expected jsdom media-method “not implemented” notices; assertions are mocked.
- **Blockers / remaining:** Root to review concurrent App/subscription hunks and integrate. Actual network reconnect/device acceptance remains open. No backend/auth/deploy/push/merge/Linear change made by this pool.
- **Next:** root owns review/commit and stage checkpoint. App wiring to `audioTracks` is complete and its hunk is now available for the separately authorized account-auth frontend assignment.
