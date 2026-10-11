# UIX-676 character archive extraction checkpoint — 2026-10-08

- Scope: extracted the archived roster, archive, and restore endpoints from `routes.ts` into `character-archive-routes.ts`; archive/restore CAS transactions and side effects moved to `character-archive-service.ts`.
- Decisions preserved: replay lookup remains before current-row/revision lookup; campaign-scoped reads and event writes; archive/restore transactional side effects; same HTTP status and body mapping; only updated transitions broadcast after commit; DTO construction remains at route edge.
- Revision: implementation based on `d5b5dba`.
- Changed files: `apps/server/src/routes.ts`, `apps/server/src/character-archive-routes.ts`, `apps/server/src/character-archive-service.ts`.
- Verification: pending the connected `character-archive.integration.test.ts` and server typecheck gate; not run as a separate micro-gate.
- Gate repair: use the actual `game_events` key (`sequence`) via the original full-row existence query. The schema has no `id` column; the earlier selected-column query caused endpoint 500s before writes. Replay lookup semantics remain unchanged.
- Blockers: rerun the connected gate after repair.
- Next: review complete diff and run the one focused integration/typecheck stage gate; confirm no registration/behavior drift before freezing.
- Explicitly not done: broad E2E, server startup, production, deployment, push, or Linear mutation.

## Final source acceptance / gate
- Corrected replay projection independentlyrechecked againstactualschema (sequence PK,noid), allnewservice/routecolumn references checked. Noadditionalfinding.
- Rootrepairedgate actualfullapplication registration HTTP/PGlite16/16 PASS; officialserverpackage tsc--noEmit exit0, session30469 finalexit0. Existingintegrationexpectationsunchanged.
- Service transport/domain separation accepted; no migration/APIbehaviorchange/performanceclaim/browserproductioncheck. This boundedsource task criteria satisfied after explicitreview+runtimeintegration/typecheck.
