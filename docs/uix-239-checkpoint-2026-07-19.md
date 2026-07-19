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

## Visual correction pool

- Evidence: production screenshot showed token names overflowing their cards and the nested token editor behind the Tokens workspace.
- Token previews are now isolated to 72 px; initials are bounded; names use a stable 0.875 rem size and a two-line clamp with safe wrapping.
- Gravity modal portals now use the dialog layer (2000), above workspace windows (1200).
- Added an end-to-end assertion that the nested token editor has a higher computed layer than its parent workspace.
- Verification: web typecheck PASS; scoped lint and Prettier PASS; focused Playwright 1/1 PASS; diff check PASS.
- Production remains unchanged. Next action is publish, then repeat visual QA on the production-sized viewport after release approval.
