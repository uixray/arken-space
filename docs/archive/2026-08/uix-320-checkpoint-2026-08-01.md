# UIX-320 checkpoint ? 2026-08-01

## Linear

- UIX-320 is In Progress; implementation and scoped verification are complete.
- Final combined review with UIX-322 remains before release-candidate integration.

## Decisions

- Keep gmNotes exclusively in StoryPostAdminDto; do not add it to player bootstrap, HTTP or realtime projections.
- Render saved GM notes in a visually separate GM-only block.
- Use the existing revisioned PATCH flow for title, body, GM notes, media metadata and media membership.
- Add, replace and remove story images through the existing protected upload flow; immutable revisions remain server-owned.
- Remove redundant media margin rules and rely on the story-card grid gap for content-sized spacing.

## Revision

- Base includes UIX-321 revisions 5bb3015 and b25f224.
- Branch: codex/manual-production-fixes.

## Changed files

- apps/web/src/StoryChannel.tsx
- apps/web/src/styles.css
- tests/e2e/story-channel.spec.ts
- tests/story-http.integration.test.ts

## Verification

- PASS: Story helper/contracts/HTTP scoped suite ? 17 tests.
- PASS: explicit GM story retrieval and player omission HTTP coverage ? 8 tests.
- PASS: full workspace typecheck.
- PASS: GM/player StoryChannel Playwright gate ? 2/2.
- PASS: archive, restore, publish and correction browser path remains valid.
- PASS: git diff --check.

## Blockers

- No code blocker for UIX-320.
- No production deployment, push or merge was performed.

## Next action

- Commit this pool, mark UIX-320 Done at the Linear stage gate, then implement UIX-322 logout/shared-PC chooser.
