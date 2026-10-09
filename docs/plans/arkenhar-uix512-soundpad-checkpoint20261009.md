# UIX-512 Soundpad implementation checkpoint — 2026-10-09

## Scope / revision
- Isolated worktree: `C:\Users\UIXRay\.codex\worktrees\uix-512-soundpad\arken-space`.
- Initial implementation base: `bc6cec718f88d2169c293387bcf68afb1eb0ee13`; initial partial slice committed in `4be0aea17fb235a64596f551f58f86a9a42c8af2`. Search/favorites delta committed in `96032d10d5c08919affbeefb4ccb758997cc726f`; favorites-first acceptance fix committed in `d4deb6ce4cfc47118d1f52278e4f6d974637475c`.
- Release/publication worktree untouched; no merge, push, deployment, remote server, or Linear mutation.
- This is an initial bounded slice, not full UIX-512 acceptance.

## Decisions and implementation
- Campaign-owned sound packs/sounds and PLAYER playback setting; GM-only authoring and server-side published/audience filtering.
- Ephemeral one-shot trigger/stop realtime events, bounded process-local dedupe/cooldown/rate control; not a multi-replica exactly-once guarantee.
- Per-campaign+membership local Effects playback bus independent of MusicBar; maximum 4 concurrent local voices, oldest-first eviction; 10s sound limit.
- Only the two approved CC0 starter recordings are included with provenance: `evil-laugh.ogg` and `surprise-oh-my.wav`; no fake beep.
- WAV MIME support narrowly added to audio upload; existing quotas remain.
- Targeted review fixes: GM_ONLY trigger events go only to the GM room (public events go to campaign room); pack/sound mutations broadcast an invalidation-only event; clients refetch the role-filtered catalogue on invalidation and reconnect, and retry a trigger against a fresh filtered catalogue if it raced publication. Catalogue fetches coalesce invalidations but perform a trailing fetch if a change arrives during an older request. Client playback-session generations fence an unknown-trigger lookup across stop, disconnect, reconnect, and unmount, so late responses cannot start stale playback; a captured server stop-generation is also checked before emission. Playback no longer compares server wall-clock timestamps against client wall-clock time, avoiding positive-skew suppression.
- Canonical generated DB migration only: `0054_huge_spiral.sql` + matching `0054_snapshot.json`. Schema remains on unique indexes; generated indexes are placed before composite FK statements. No redundant follow-up migration or schema drift.

## Changed files
- Contracts: `packages/contracts/src/soundpad.ts` (new), `packages/contracts/src/index.ts`.
- DB: `packages/db/src/schema.ts`, `packages/db/drizzle/0054_huge_spiral.sql`, `packages/db/drizzle/meta/0054_snapshot.json`, `packages/db/drizzle/meta/_journal.json`.
- Server: `apps/server/src/soundpad-routes.ts` (new), `soundpad-routes.test.ts` (new), `soundpad-runtime.ts` (new), `soundpad-runtime.test.ts` (new), `audio-upload-format.ts` (new), `audio-upload-format.test.ts` (new), `asset-usage.ts`, `realtime.ts`, `routes.ts`, `storage.ts`.
- Web: `apps/web/src/SoundpadWorkspace.tsx` (new), `SoundpadWorkspace.css` (new), `SoundpadWorkspace.dom.test.tsx` (new), `sound-effects-playback.ts` (new), `sound-effects-playback.test.ts` (new), `App.tsx`.
- Static content: `apps/web/public/soundpad-defaults/evil-laugh.ogg` (28,146 bytes), `surprise-oh-my.wav` (74,690 bytes), `provenance.json` (719 bytes).
- This receipt: `docs/plans/arkenhar-uix512-soundpad-checkpoint20261009.md`.

## Verification
- Focused Vitest: 5 files / 16 tests PASS (`soundpad-runtime`, `audio-upload-format`, `soundpad-routes`, `sound-effects-playback`, `SoundpadWorkspace.dom`). Covers route auth/PLAYER mutation denial, foreign/non-audio/long media rejection, private/draft filtering, deletion blocking, private-room selection, stop-generation fencing, connected catalogue refetch/trigger recovery, mute/voice/gain behavior, and clock-skew tolerance. Tests use disposable PGlite/Fastify and DOM/socket mocks; no full live Socket.IO browser E2E claim.
- TypeScript PASS: contracts, DB, server, web (4/4).
- Server `tsup` build PASS (835.60 KB JS).
- Vite web build PASS (4,775 modules); existing main-chunk warning (1,190.04 kB JS).
- Built starter files present under `apps/web/dist/soundpad-defaults/`; earlier Chromium AudioContext decode was PASS for both (OGG 2.544229s mono/48kHz; WAV 0.846313s mono/48kHz).

## Remaining acceptance criteria / limits
- Owner/human listening and editorial/content acceptance remain open.
- Trim/waveform editor not implemented.
- No full live multi-client Socket.IO E2E, mobile/device, slow-network, broad performance/load, or production runtime test.
- Runtime dedupe/rate/cooldown is process-local; no multi-replica guarantee.
- No claim that the whole UIX-512 issue is done.

## Follow-up pool — search and favorites

- `apps/web/src/SoundpadWorkspace.tsx`, `SoundpadWorkspace.css`, `apps/web/src/SoundpadWorkspace.dom.test.tsx`, and this checkpoint are the only owned paths changed by the search/favorites pool; no server, contracts, schema, or migration changes. Favorite sounds are pinned before other authorized sounds, with the relative order of nonfavorites preserved.
- Search is case-insensitive substring matching over pack names and sound labels from the existing role-filtered API catalog.
- Favorites persist only in this browser's localStorage under a campaign+membership-scoped key; they are neither shared nor synced.
- Actionable cards derive only from the authorized catalog and currently available AUDIO assets with duration >0 and <=10s. Hidden/deleted/missing assets therefore cannot become playable through search or favorites.
- Follow-up source gate: focused Soundpad DOM Vitest 8/8 PASS after the favorites-first regression; web TypeScript PASS; final Vite build PASS (4,775 modules, existing main-chunk warning; final JS 1,192.21 kB). Browser interaction receipt: `.data/qa-prep/uix512-search-favorites-20261009/receipt.json`. Chromium headless exercised the actual Soundpad component in a temporary local Vite harness with a mocked authorized catalog API, not a live campaign/backend. Search/no-results/clear, favorites persistence after reload and campaign+membership isolation, pinned-first ordering, and missing-asset non-actionability passed; no sound was triggered, no autoplay bypass, no trace/screenshots. Harness removed; local server stopped.

Current isolated source pool is committed; no merge or release was performed. Whole UIX-512 remains open for human clip/copy acceptance, trim/waveform editing, and full live Socket.IO/browser, mobile/device, slow-network/performance acceptance. Keep release worktree untouched.
