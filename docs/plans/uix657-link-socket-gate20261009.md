# UIX-657 link-provenance Socket.IO gate — 2026-10-09

## Checkpoint

- **Revision:** `3146a96` (shared checkout; no commit created by this pool).
- **Owned files:** `apps/server/src/account-link-realtime.integration.test.ts` (new), this checkpoint.
- **Test receipt:** `& .\node_modules\.bin\vitest.cmd run apps/server/src/account-link-realtime.integration.test.ts` — **4 passed / 4**, actual loopback Socket.IO, fresh synthetic PGlite DB per case, all migrations applied. No persistent stand was stopped or used.
- **Typecheck receipt:** `pnpm.cmd --filter @arken/server typecheck` completed after fixing initial test argument errors; no diagnostics were returned. (An earlier direct `tsc -p apps/server/tsconfig.json` invocation was not the workspace command and surfaced duplicate Drizzle dependency resolution noise; use the official workspace command.)
- **Source path exercised:** actual `registerRealtime` handshake middleware (`authFromSessionToken`) and per-event active-session middleware (`sessionIsActive`), with production defaults rather than an injected fake session guard.

## Coverage and boundary

Four already-connected sockets were invalidated by synthetic DB provenance changes, then sent a harmless event and attempted a fresh handshake with the old session token:

1. PLAYER grant revoked.
2. PLAYER grant revision rotated.
3. GM credential revision rotated.
4. Claimed legacy invite revoked.

Each connected socket disconnected at the next event authorization check; the event-specific listener did not run; reconnect returned `AUTH_REQUIRED`. Fixtures use synthetic IDs and opaque random session tokens; tests emit no token values to logs. These are provenance-boundary tests, not HTTP route tests: DB updates stand in for the corresponding endpoint transaction. They do not prove that each management endpoint performs its room-disconnect call, nor do they exercise `index.ts`'s exact-Origin `allowRequest`, account reset/change, campaign switch, or a separate protected room broadcast. No broad socket matrix is claimed.

## Blockers / next action

- Root should review and integrate the new test at the next backend stage gate. Keep it out of any already-frozen baseline commit until this pool is reviewed.
- A follow-up endpoint-level test should exercise actual GM rotation, player revoke/rotate and legacy invite revoke HTTP routes, including immediate room disconnect and cross-member non-broadcast assertions. Preserve the current focused tests as event/reconnect provenance checks.
- Account-auth public activation, durable mail/provider acceptance, PostgreSQL multi-connection race evidence, and human/runtime acceptance remain separate gates; this pool does not close them.
