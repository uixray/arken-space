# UIX-323 checkpoint ? 2026-08-01

## Decisions
- Short rest restores 25% of the maximum value of every recoverable resource, rounded up and capped at maximum.
- Long rest restores every recoverable resource to maximum.
- A resource can opt out through `recoverable: false`.
- `????????? ???` uses the same server-authoritative path but targets only Physical Power.
- Resource metadata stays inside the existing JSONB column, preserving stored-data compatibility and avoiding a migration.

## Revision
- Branch: `codex/manual-production-fixes`
- Base before this pool: `db27dc7`

## Changed files
- `packages/contracts/src/index.ts`
- `apps/server/src/routes.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `tests/pool-b-http.test.ts`

## Delivered in this pool
- Editable current/maximum Physical Power and Magic Power.
- Structured custom-resource form with required name, optional description, current/maximum, image and recovery toggle.
- Add, rename, edit and remove resource rows.
- Server-authoritative `SHORT`, `LONG` and `CATCH_BREATH` commands with CAS revision checks and audit payloads.

## Verification
- Typecheck ? PASS.
- Lint ? PASS.
- Source encoding ? PASS (4/4).
- Scoped short/long-rest integration ? PASS.
- `git diff --check` ? PASS.

## Remaining UIX-323 work
- Move Magic Power into its own characteristic category and Reaction beside Initiative.
- Replace the old campaign-clock ?????????? ????? UX with the approved rest wording without creating a partial cross-entity transaction.
- Verify skill/ability costs and actionable insufficient-resource errors.
- Add browser coverage for resource form persistence, stale revisions and rapid input.

## Next action
Implement the characteristic grouping and complete the atomic campaign-level long-rest boundary.
