# UIX-239 checkpoint — 2026-07-19

## Decisions

- Reuse an existing token definition linked to the character when creating another placement.
- Keep the legacy `/api/tokens` bootstrap only for a character without a token definition.
- Do not add a database uniqueness constraint: multiple token forms for one character may be valid.
- Do not modify or clean production data without a fresh inventory, backup gate, and explicit approval.

## Revision

- Base: `f70cca5`
- Production reference: `6627e2d426d80649969ca9ac265912eb05c2134c`

## Changed files

- `apps/web/src/App.tsx`
- `apps/web/src/token-placement.ts`
- `apps/web/src/token-placement.test.ts`

## Verification

- Focused Vitest: PASS, 2/2.
- Workspace typecheck: PASS.
- Scoped ESLint: PASS.
- `git diff --check`: PASS.
- Production/data writes: none.

## Blockers

- Read-only production visual QA needs an authenticated GM tab in the in-app browser.
- Existing production duplicates have not been inventoried or removed.
- A simultaneous first-ever double click can still race before the refreshed snapshot arrives; full protection needs server-side idempotency and a product rule for alternate token forms.

## Next action

1. Publish the local prevention fix.
2. Open an authenticated production GM session and perform read-only inventory plus visual QA.
3. If duplicates are confirmed, prepare an exact cleanup plan and request explicit approval before mutation.
