# Production release candidate — 2026-07-19

## Release identity

- Candidate revision: `b8d612cb8bdc589b672555674a774cb6112d7102`
- Current production revision (last read-only inspection): `3d15ba777336c0053abfb0b179e01a42fdfb1c8f`
- Reviewed application candidate and release evidence are published on `origin/main` through revision `45b894e`.
- Database change since production: migration `0015_token_appearance.sql` adds persisted token base/border appearance.
- Application schema version remains `2`; migration identity and application schema version must be recorded separately.
- Production deployment performed: no.

## Included release pools

- `6e5fb30` + `178d345` — character stability, legacy rolls and beta access review fixes.
- `de47dbd` — responsive workspace shell and non-blocking dialogs.
- `18b2930` — unified chat/dice composer and readable roll totals.
- `d2b4653` — token transforms, image stability, drawing/ping behavior, stack labels, appearance and GM grid control.
- `ba4345f` — music continuity through scene/snapshot refreshes.
- `b8d612c` — browser regression for local and published scene changes while music is active.

## Combined local review

- UIX-227 token/canvas acceptance: automated regression and browser coverage PASS.
- UIX-231 GM grid preference: local-only behavior and desktop control coverage PASS.
- UIX-230 music continuity: transient media interruption regression plus local/published scene browser flow PASS.
- Lint: PASS.
- Typecheck: PASS.
- Unit/integration: 25 files, 155 tests PASS.
- Production build: PASS.
- Playwright: 22 PASS, 1 credential-dependent test skipped, including the added music/scene scenario.
- Known non-blocking output: mocked backend proxy refusals, Konva six-layer warning and web chunk above 500 kB.

## Local operational constraints

- Docker Desktop Linux engine is unavailable on the review machine.
- Isolated `test:multiplayer` and `restore:rehearse` cannot run here.
- No local `.env` exists; no production secrets were read or copied.
- These constraints block UIX-201/UIX-217 completion but do not invalidate deterministic unit/browser results.
- Production read-only check: DNS resolves to `51.250.26.16`, HTTPS returns 200, and `/healthz` reports database healthy at revision `3d15ba7`, application schema `2`.

## Blocking pre-deploy gates

1. Confirm production still runs the recorded rollback revision and inspect health/DNS/TLS/disk read-only.
2. Create or verify exactly one intended PLAYER grant and starter character for each of the six beta aliases.
3. Create a fresh restic snapshot and record its exact ID.
4. Rehearse that exact snapshot against candidate `b8d612cb8bdc589b672555674a774cb6112d7102` in the isolated restore environment.
5. Confirm checksums, counts, migration `0015`, application schema `2`, cleanup, disk and production health.
6. Run the isolated GM+6/recovery harness against the exact candidate.
7. Run the 30–45 minute human GM+6 rehearsal across Chrome, Firefox and Edge.
8. Record rollback revision and snapshot ID.
9. Obtain explicit production deployment GO. No deployment is authorized by this document.

## Post-deploy smoke

- `/healthz` reports the exact candidate revision and application schema `2`.
- GM exchange succeeds without exposing the secret.
- All six `/play/:handle` links create the intended HttpOnly player session; unknown aliases fail.
- Token resize/image/frame/stack, grid/fog controls, chat/rolls and character editing pass.
- Active music continues through GM-only scene viewing and group scene publication.
- WebSocket, image/audio upload and persistence across service restart pass.
- Any failed gate stops the release and triggers the documented rollback path.

## Security decision

Closed-beta nickname links intentionally have no PIN. Anyone with site access can impersonate a listed player. GM access remains separate. Remove this exception before broader access.
