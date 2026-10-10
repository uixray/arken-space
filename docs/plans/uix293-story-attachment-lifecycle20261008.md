# UIX-293 story attachment lifecycle checkpoint — 2026-10-08

- Revision: 66300f5024d39faa061c9a49c77c419714facf7c (working-tree changes uncommitted).
- Decision: story media remains separate from generic campaign assets. Replacement stages a new chat upload/contentId and uses existing story PATCH to create a new revision; existing storage objects and old story/chat references are never overwritten.
- Backend: GM-only `/api/story/attachments` lists the authenticated campaign's story-linked uploads and the GM's own STAGED/EXPIRED candidates. Each story reference carries postId, immutable revision title/lifecycle, derived historical visibility, and current/history state. It omits story body, GM notes, direct identifiers/participants, and storage keys; direct chat is represented by an opaque count only.
- Visibility evidence: `story_post_revisions` stores lifecycle but not a separate visibility column. Story transitions persist lifecycle and visibility together; `story_posts_shape_check` enforces DRAFT/ARCHIVED => GM_ONLY and PUBLISHED/CORRECTED => PUBLIC. Reference DTO derives visibility from immutable snapshot lifecycle under that invariant.
- Delete: only own unused candidates; row lock/recheck blocks every story revision and chat reference. Upload is marked EXPIRED before blob cleanup; pending cleanup remains listable/retryable. Exact same actionId resumes pending cleanup and updates its existing audit event; completed replay returns the exact saved response; conflicting actionId reuse returns ACTION_ID_CONFLICT. Duplicate same-action requests recheck the action event after row lock and do not create duplicate audit rows.
- UI: library is in the actual GM story dialog (`Sidebar.tsx`), shows revision/publication locations, links to the current post presentation without implying historical revision editing, and offers unused delete and cleanup retry. Existing editor replacement stages new contentId and PATCHes a new revision while preserving old version.
- Changed files owned here: `apps/server/src/story-attachment-lifecycle.ts`, `apps/server/src/routes.ts`, `packages/contracts/src/story-attachment-lifecycle.ts`, `packages/contracts/src/index.ts`, `tests/story-attachment-lifecycle.test.ts`, `apps/web/src/StoryAttachmentLibrary.tsx`, `apps/web/src/StoryAttachmentLibrary.css`, `apps/web/src/StoryAttachmentLibrary.test.tsx`, `apps/web/src/story-attachment-api.ts`, `apps/web/src/Sidebar.tsx`, `apps/web/src/StoryChannel.tsx`.
- Verification: connected focused story PGlite/API + component tests passed 9/9, including same-action pending->success, concurrent duplicate action, exact replay/conflict, and A→B revision/media-byte preservation/delete block. After sticker-route registration, story lifecycle + sticker-admin API tests passed 9/9; contracts build, server/web typechecks (server exit 0), scoped Prettier, and `git diff --check` passed.
- Not verified: no server start, browser QA, full E2E, Docker, SSH, production, or deployment. Concurrent sticker-pack worker files remain untouched.
- Next: independent review and acceptance decision; runtime/browser acceptance remains open.


## Follow-up checkpoint — chat claim/delete race
- Revision: `66300f5` (same working tree; uncommitted shared changes preserved).
- Change: `apps/server/src/routes.ts` now locks candidate upload rows `FOR UPDATE` and conditionally transitions only matching campaign/owner/STAGED/unexpired uploads to CLAIMED before adding chat references. A delete that expires/removes first makes claim fail; a claim that commits first leaves a chat reference that blocks deletion.
- Regression: `tests/story-attachment-lifecycle.test.ts` replaces the timing-sleep single-order scenario with paired real-route outcomes and positive response/state barriers: claim-first => chat 201, delete 409, ref and blob retained; delete-first => delete 200, chat 404, no ref/upload/blob. No timing sleeps or production hooks. This proves both committed serial orders; it is not a simultaneous stress test.
- Verification: focused lifecycle test file passed 7/7 after paired-order revision. Official `pnpm --filter @arken/server typecheck` and `pnpm --filter @arken/web typecheck` invoked correct package scripts (`tsc --noEmit`) and exited 0; logs saved in `%TEMP%\uix293-story-race-server-typecheck.log` and `%TEMP%\uix293-story-race-web-typecheck.log`. Scoped Prettier and `git diff --check` passed. Sandbox EPERM attempt is separate; escalated focused runs succeeded.
- Limits: no server, browser, full E2E, Docker, SSH, production, or deployment. Existing concurrent worker changes are untouched.
- Next: independent review of the race fix; do not close the broader UIX-293/runtime gate based on this source/API slice.



- Review follow-up: deterministic paired lock-order tests supersede the sleep-based scenario; ready for independent re-review.
