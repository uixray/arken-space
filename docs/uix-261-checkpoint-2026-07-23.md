# UIX-261 checkpoint — 2026-07-23

## Decisions

- Reuse the existing server-authoritative character-entry roll endpoint and ROLLS stream.
- Store a versioned immutable `skillCard` snapshot alongside the existing DICE payload; no new table or migration is required.
- `EXECUTE` resolves the entry/action/result and optional use decrement on the server. `SHARE` is explicitly non-executed and never rolls or mutates uses.
- One accepted action creates exactly one ROLLS message. The former secondary TABLE consumption message is removed.
- PLAYER actions are PUBLIC only; GM may choose PUBLIC or GM_ONLY.
- MVP exposes uses and recharge information already supported by the model. Generic resources, cooldown timers, durations and automatic effects remain unsupported rather than simulated.
- Historical rendering uses the card snapshot and survives renamed/deleted catalog sources. Legacy/malformed payloads fall back safely to existing chat rendering.

## Changed files

- Contracts/projection: `packages/contracts/src/index.ts`, server dice normalization/chat/snapshot.
- Server execution: `apps/server/src/routes.ts` and focused integration coverage.
- Web: `apps/web/src/SkillCards.tsx`, character/chat integration and responsive styling.
- Tests: dice projection, server authorization/idempotency/concurrency, component parsing/rendering and Playwright flows.

## Verification

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS (existing bundle-size warning only).
- `pnpm test -- --maxWorkers=1` — PASS, 53 files / 276 tests.
- UIX-261 Playwright — PASS, 2/2.
- Combined security/integration review — no remaining P0/P1.
- `git diff --check` — PASS (line-ending warnings only).

## Blockers

- None for the UIX-261 MVP.
- Broader fantasy art direction/icons remain part of the parent visual-design work; no BG3 assets or proprietary visual elements were used.

## Next action

- Commit and publish the verified revision, close UIX-261, then select the next backlog task.
- Production deployment is not part of this pool.
