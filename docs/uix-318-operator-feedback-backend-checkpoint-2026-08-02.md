# UIX-318 operator feedback backend checkpoint — 2026-08-02

## Decisions

- Dedicated operator access uses an environment allowlist of existing membership UUIDs layered over the existing HttpOnly session.
- Anonymous users, ordinary GM sessions and PLAYER sessions are denied unless the exact membership is allowlisted.
- API queries use explicit column projections; list responses omit report text and all sensitive/internal identifiers.
- Contact and diagnostics require an explicit reveal request. `reveal=false` never reveals them.
- Attachment bytes are served through an authorized report/attachment route; storage keys and internal paths are never returned.
- Linear linking validates an existing-looking `UIX-N` key and matching `https://linear.app/.../issue/UIX-N...` path, but never creates an issue.
- Export applies conservative line-level redaction for credentials, private-chat markers, internal paths and private/local infrastructure addresses.
- Audit records contain only audit/report/operator IDs and an action code.

## Revision

Base: `def3d0a`.

## Changed files

- `apps/server/src/env.ts`
- `apps/server/src/operator-feedback.ts`
- `apps/server/src/routes.ts`
- `packages/db/src/schema.ts`
- `packages/db/drizzle/0024_feedback_operator.sql`
- `packages/db/drizzle/meta/_journal.json`
- `tests/feedback-operator.test.ts`
- `docs/uix-318-operator-feedback-backend-checkpoint-2026-08-02.md`

## Verification

- focused operator and migration tests: 13/13 PASS
- workspace typecheck: PASS
- `git diff --check`: PASS

Broad regression, lint, production build, Docker multiplayer and browser QA are deferred by user request until a later combined gate.

## Blockers

- The operator inbox UI has not been implemented.
- Production SSH host identity must be verified independently before any known-host update or read-only discovery.
- No production access, deployment or external Linear issue validation was performed.

## Next action

Commit the backend foundation as a bounded pool, keep UIX-318 In Progress, then implement the minimal operator-only inbox UI in a separate commit.
---

## Minimal operator inbox UI pool

### Decisions

- Operator capability is probed through a dedicated authenticated endpoint; GM role alone never exposes the inbox.
- Capability failure is fail-closed and closes an already open operator workspace.
- Sensitive contact and diagnostics are absent until an explicit reveal action and are cleared on selection, close, reload and status change.
- Status actions follow the backend transition graph. Linking requires a matching `UIX-N` key and strict Linear issue URL.
- Clipboard copy always fetches the server-redacted export and never uses revealed state.
- Attachments require an explicit action and are rendered only as allowlisted PNG/JPEG/WebP blobs; server responses use `nosniff`, private no-store caching and a safe inline filename.
- UI styling is isolated; shared `styles.css` and `WorldMapsWorkspace.tsx` remain untouched.

### Revision

Base: `3937647`.

### Changed files

- `apps/server/src/operator-feedback.ts`
- `tests/feedback-operator.test.ts`
- `apps/web/src/operator-feedback.ts`
- `apps/web/src/operator-feedback.test.ts`
- `apps/web/src/OperatorFeedbackWorkspace.tsx`
- `apps/web/src/OperatorFeedbackWorkspace.css`
- `apps/web/src/App.tsx`
- `apps/web/src/Sidebar.tsx`
- `docs/uix-318-operator-feedback-backend-checkpoint-2026-08-02.md`

### Verification

- focused frontend, backend and source-encoding tests: 13/13 PASS
- web typecheck: PASS
- server typecheck: PASS
- `git diff --check`: PASS

Broad regression, lint, production build, Docker multiplayer and browser QA remain deferred by user request.

### Blockers

- Browser QA with a real allowlisted operator session remains open.
- Independent production SSH identity verification and production discovery remain open.
- No deployment or production mutation was performed.

### Next action

Commit this UI pool and keep UIX-318 In Progress until browser QA and external production trust gates are completed.