# Production release candidate вЂ” 2026-07-18

## Release identity

- Candidate revision: `a97df9aad56cb66b84b722f5c28566838461f821`
- Included commits:
  - `6e5fb30` вЂ” UIX-228 character stability and legacy roll compatibility
  - `a97df9a` вЂ” UIX-232 trusted beta player entry links
- Current production revision: `3d15ba777336c0053abfb0b179e01a42fdfb1c8f`
- Database schema changes: none
- Production deployment performed: no

## Local release gate

- Scoped profile matching regression: PASS (3 tests)
- Lint: PASS
- Typecheck: PASS
- Unit/integration suite: PASS (23 files, 145 tests)
- Production build: PASS
- Playwright: PASS (20 passed, 1 credential-dependent GM exchange skipped)
- Git worktree after commits: clean
- Repository-wide Prettier baseline: known pre-existing failure on unrelated files; release files are formatted
- Build warning: main web chunk remains larger than 500 kB (existing optimization debt)
- Mocked browser tests log expected backend proxy connection refusals because the test suite intercepts relevant API calls

## Production inspection (read-only)

- Host: `51.250.26.16`
- Application checkout exists and currently points to `3d15ba7`
- PostgreSQL, server and web containers are running; PostgreSQL and server report healthy
- Active player-access grants found: 2
- Existing identities: `РџСѓС‚РЅРёРє` and one unrelated legacy identity
- None of the six configured beta aliases currently has a matching production grant

## Blocking pre-deploy gates

1. Push candidate revision to the public GitHub `main` branch.
2. Create or rename six PLAYER memberships and active grants so display name or label matches:
   - Р­Рґ / `archinamon`
   - РСЂР°РєР»РёР№ / `IRAKLY123`
   - Р”Р°С€Р° / `DaryaSteel`
   - Р›РµС€Р° / `VeePeeK`
   - РњРёС€Р° / `Zheludock`
   - РђРЅРґСЂРµР№ / `uixray`
3. Confirm DNS, TLS, nginx config and at least 5 GiB free after the media reserve.
4. Create a fresh restic snapshot and record its exact ID.
5. Rehearse that exact snapshot against this exact 40-character candidate revision.
6. Confirm restore evidence: checksums, counts, schema 2, cleanup, disk and production health checks.
7. Record rollback revision `3d15ba777336c0053abfb0b179e01a42fdfb1c8f` and the fresh snapshot ID.
8. Obtain explicit production deployment GO.

## Post-deploy smoke

- `/healthz` reports the exact candidate revision and schema 2.
- GM secret-link exchange succeeds without exposing the token.
- Each of the six `/play/:handle` links creates the intended HttpOnly player session.
- Unknown aliases return `PLAYER_NOT_FOUND`.
- Character editing, legacy вЂњРќР°Р±Р»СЋРґРµРЅРёРµвЂќ, track switching and scene switching are smoke-tested.
- WebSocket, image upload, audio upload and persistence across service restart pass.
- If any gate fails, stop and follow the documented rollback procedure.

## Security decision

For this closed trusted beta, PINs are intentionally omitted. Anyone with site access can impersonate any listed beta player. GM access remains separate. This exception must be removed before broader public access.
