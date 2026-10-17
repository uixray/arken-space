# UIX-221 wallet aggregation checkpoint — 2026-08-01

## Decisions

- Preserve every authoritative wallet mutation and its `character.counters` game event.
- Aggregate only the public SYSTEM chat projection for consecutive wallet-only changes by the same membership and character.
- Use a five-second rolling burst window; any intervening chat message, resource/rest mutation, actor change, character change, or expired window starts a new audit message.
- Store structured `WALLET_AUDIT` metadata so aggregation does not parse localized body text.
- Keep the optimistic client queue sequential; do not debounce or discard clicks.

## Revision

- Base: `08fdd0a` (`fix(input): harden editable keyboard handling`)
- Delivery commit: `10eccdc` (`fix(chat): aggregate rapid wallet audit messages`).

## Changed files

- `apps/server/src/routes.ts` — wallet-only audit aggregation while retaining one game event per mutation.
- `packages/db/src/schema.ts` — nullable structured SYSTEM-message metadata.
- `packages/db/drizzle/0023_wallet_audit_metadata.sql` — additive nullable JSONB migration.
- `packages/db/drizzle/meta/_journal.json` — migration journal entry.
- `tests/pool-b-http.test.ts` — server regression for one chat audit plus three authoritative events and idempotent replay.
- `tests/e2e/concept.spec.ts` — delayed-response regression proving optimistic UI reaches the final value while requests remain serialized.

## Verification

- PASS: full workspace typecheck.
- PASS: scoped ESLint for all changed TypeScript files.
- PASS: source-encoding and migration suites (`11` tests).
- PASS: focused server wallet aggregation regression.
- PASS: Chromium wallet queue regression.
- PASS: `git diff --check` (line-ending notices only).
- Known unrelated baseline: the legacy combined wallet/clock test still searches for mojibake text and fails against correct UTF-8 server output; it is not used as the acceptance gate for this pool.
- Non-blocking browser output: Vite websocket proxy `ECONNREFUSED` and existing Konva six-layer performance warning.

## Blockers

- None for UIX-221 scope.

## Next action

- Commit the connected pool, post the verification stage gate in Linear, and close UIX-221 if its current acceptance criteria contain no additional unresolved item.
