# Multiplayer GM + 6 E2E — 2026-07-13

## Result

Passed from Git commit 1d907b21d6ac56bc760eb94c6c6291acab1b65c2 in the isolated Compose project arken-e2e-mriiq3t4-2703403.

- Playwright: 1 passed, 0 failed, 0 skipped.
- Browser scenario duration: 137.513s.
- Complete runner wall clock, including image builds and cleanup: about 22m 34s.
- Isolated health reported the exact tested commit.
- Production remained on build d6a224b, schema 2, with database status ok before and after.
- E2E containers and volumes after cleanup: none.
- Disk: 7.52 GiB before, 3.04 GiB immediately after project-image cleanup, and 7.6 GiB after pruning unused build cache.

## Coverage

The successful run verified:

- one GM plus six independent player browser contexts;
- six characters, one-time invitations and separately claimed memberships;
- five initial joins and one late join after a fog/scene transition;
- six simultaneous owned-token moves while the GM moved an ownerless enemy;
- FORBIDDEN acknowledgements for foreign, enemy and hidden-token moves by a player;
- active-scene fog delivery and exclusion of inactive-scene fog;
- scene switching and authoritative snapshots for connected and late clients;
- concurrent public chat and server-authoritative dice from all players;
- GM-only chat and dice remaining absent from every player snapshot;
- another character's private notes remaining absent from every player snapshot;
- hidden tokens and their assets remaining absent and returning 404 on direct content access;
- inactive scene tokens/assets remaining absent until that scene became active;
- one page reload with the same authenticated membership;
- a real 20-second browser offline interval followed by UI reconnection;
- an external backend container restart without mounting the Docker socket into Playwright;
- disconnect-to-reconnect authoritative snapshots for all seven Socket.IO clients;
- explicit game:resync after restart;
- one shared snapshotVersion and no duplicate IDs in members, characters, scenes, tokens, fog, messages or assets;
- persisted authoritative positions and revisions for all six player tokens and the GM enemy.

## Harness findings and correction

The first committed attempt, 7f96996, reached backend restart but failed for two test-harness reasons:

1. It required observing a very short health=false interval even though the external restart and Socket.IO recovery occurred.
2. Playwright retry reused the same isolated PostgreSQL volume while the test used static character names and message markers.

No product defect was established by those failures. Commit 1d907b2 changed restart proof to the required disconnect-to-authoritative-snapshot transition and tagged all retry-created data by attempt. Local typecheck, lint, 20 Vitest tests, build, formatting, Playwright list and resolved Compose config checks passed before the second upload.

Failure artifacts were retained before temporary images/cache were removed. Successful JSON/JUnit artifacts were also copied locally before server /tmp cleanup. No invitation token, session cookie or production secret was printed or committed.

## Remaining foundation gates

The automated seven-client realtime/security/recovery gate is complete. The following gates remain open:

- configure remote S3-compatible restic storage;
- restore PostgreSQL and media into a clean isolated environment;
- expand the server disk before restoring the original media allowance;
- reboot into the pending kernel and verify intended service recovery;
- run a 30–45 minute human rehearsal with six independent player profiles.

The amnezia-awg container was still observed in a restart loop after the test. It was recorded only and not modified.
