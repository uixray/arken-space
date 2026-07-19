# UIX-230 checkpoint — 2026-07-19

## Decisions
- Synchronized audio remains campaign-level and independent from viewed or broadcast scene state.
- Repeated snapshot renders no longer call `play()` when the existing audio element is already playing.
- Only browser permission failures revoke local audio consent. Transient media `AbortError` failures during scene/snapshot refresh are ignored so they cannot stop group playback.

## Revision
- Pending commit at checkpoint creation.

## Changed files
- apps/web/src/MusicBar.tsx
- apps/web/src/audio-playback.ts
- apps/web/src/MusicBar.test.ts

## Verification
- Format changed files: PASS
- Lint: PASS
- Typecheck: PASS
- Unit/integration: 155/155 PASS
- Production build: PASS (existing bundle-size warning)
- Playwright: 21 PASS, 1 credential-dependent test skipped
- git diff --check: PASS

## Blockers
- A real-browser production smoke with an uploaded track still belongs to the combined release gate; production was not changed.
- Existing mocked-backend proxy noise and Konva six-layer performance warning remain outside this pool.

## Next action
- Commit UIX-230, update Linear at the stage gate, then run the combined release-candidate review for UIX-227, UIX-231 and UIX-230.
