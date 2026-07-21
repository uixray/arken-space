# UIX-239 checkpoint — 2026-07-21

## Decisions

- A repeated starter placement at the same scene coordinates returns the existing
  character token with HTTP 200.
- Only a newly created placement returns HTTP 201 and broadcasts a snapshot.
- The legacy setup route serializes on the character; the definition placement
  route serializes on the token definition.
- Intentional placements at different coordinates remain allowed.
- Production was audited read-only; no provisioning mutation ran.

## Revision

- Local base: `1da238b`.
- Production revision: `abcb2ef`; health was OK.

## Changed files

- `apps/server/src/routes.ts`
- `tests/gm-access.test.ts`

## Verification

- Combined Vitest: 38/38 passed.
- Workspace typecheck: passed.
- Scoped ESLint and `git diff --check`: passed.
- Production duplicate `(definition_id, scene_id)` inventory: 0 rows.
- Active scene: Andrey, Irakliy, Lesha, Misha and Ed each have one controlled
  placement; Dasha has none. Ed has exactly one placement.

## Blocker

UIX-239 is not complete: Dasha lacks the required starter placement. Adding it
is a production mutation and requires explicit approval plus the normal backup
gate.

## Next action

Run the release gate, provision exactly one starter token for Dasha, reload, and
repeat the read-only inventory.

