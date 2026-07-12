# Multiplayer smoke test — 2026-07-13

## Result

Passed on the server from Git commit `19e281d` using an isolated Docker Compose project. Production containers, PostgreSQL and media were not reused or modified.

The scenario verified:

- a GM and two players enter through three independent browser contexts;
- the GM creates characters, one-time invitations, player tokens and an ownerless enemy token;
- each player claims a separate character;
- a player can move their own token;
- the same player is rejected when moving another player's token or the GM-only enemy token;
- the GM can move the enemy token;
- public chat and a dice roll are submitted concurrently and reach the GM client;
- an active-scene switch reaches connected clients as an authoritative snapshot;
- a disconnected player reconnects and receives the current scene state.

Playwright result: `1 passed (29.3s)`. The complete command, including image builds, took about nine minutes on the current server.

## Infrastructure findings

- `uixray` cannot access `/var/run/docker.sock`; the runner currently requires `sudo`.
- The edge healthcheck must use `127.0.0.1`, not `localhost`, in the Alpine nginx container.
- The internal browser origin is `http://edge`; the test backend must use that exact `WEB_ORIGIN` for CSRF/origin validation.
- The Playwright image temporarily consumes several gigabytes. Unused build cache was pruned after the run, returning the server to 7.6 GiB free.
- `amnezia-awg` was observed repeatedly restarting during the run. This is an independent server issue and was not changed.

## Remaining mandatory coverage

This smoke test is narrower than Session 3. Still required:

- one GM plus six independent player clients;
- simultaneous movement by several players;
- fog edits and visibility/adversarial payload checks;
- late join, page reload and a 20–30 second network outage;
- backend restart during the scenario and authoritative recovery;
- a timestamped defect report from the full production-like run.
