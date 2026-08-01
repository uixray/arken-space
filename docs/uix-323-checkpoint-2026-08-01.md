# UIX-323 checkpoint - 2026-08-01

## Decisions
- Short rest restores 25% of the maximum value of every recoverable resource, rounded up and capped at maximum.
- Long rest is a campaign-level atomic command: it advances the day, restores all recoverable character resources, and recharges due day/week catalog uses in one transaction.
- A resource can opt out through `recoverable: false`.
- Catch Breath uses the server-authoritative character path and targets only Physical Power.
- Resource metadata stays inside the existing JSONB column, preserving stored-data compatibility and avoiding a migration.
- Magic Power is presented as a separate special characteristic; Reaction is grouped with Initiative.

## Revision
- Branch: `codex/manual-production-fixes`
- First pool commit: `0fd0591`
- Base before the second pool: `0fd0591`

## Changed files
- `packages/contracts/src/index.ts`
- `apps/server/src/routes.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `tests/pool-b-http.test.ts`

## Delivered
- Editable current/maximum Physical Power and Magic Power.
- Structured custom-resource form with required name, optional description, current/maximum, image and recovery toggle.
- Add, rename, edit and remove resource rows.
- Server-authoritative short-rest and Catch Breath character commands with CAS revision checks and audit payloads.
- Atomic campaign-level `LONG_REST`, including day advance, resource restoration, catalog recharge, campaign CAS and audit payload.
- Campaign UI wording changed from Next Day to Long Rest; the redundant per-character long-rest control was removed.
- Main, special and combat characteristic grouping now places Magic Power separately and Reaction beside Initiative.
- Skill and ability costs remain server-authoritative and atomic; insufficient Physical/Magic Power now produces an actionable localized error with required and available values.

## Verification
- Typecheck - PASS.
- Lint - PASS.
- Source encoding - PASS (4/4).
- API error/telemetry unit tests - PASS (8/8).
- Scoped short-rest and campaign-long-rest integration - PASS (2/2).
- `git diff --check` - PASS.

## Remaining UIX-323 work
- Add browser coverage for resource form persistence, stale revisions and rapid input.
- Run the release regression gate before closing the issue.

## Next action
Add focused browser coverage for the resource editor and rest controls, including stale revisions and rapid input.
