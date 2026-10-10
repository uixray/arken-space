# UIX-497 GM draft recovery checkpoint — 2026-10-08

- Base revision: 66300f5024d39faa061c9a49c77c419714facf7c; recovery changes pending integration commit.
- Decision: existing public sticker catalog/media ACL remain unchanged. New admin metadata routes are GM-only, campaign scoped, private/no-store; no storage keys or draft image preview.
- Scope: GET admin list/detail, explicit draft resume, original-byte SHA reconciliation for uncertain upload, actual lifecycle reconciliation after uncertain publish, manual selection after uncertain create. Campaign/member changes remount UI and ignore stale responses. No browser persistence of files/private metadata.
- Independent review found non-DRAFT lifecycle trap. Fixed: ARCHIVED excluded from list; known-id detail stays guarded; DEPRECATED read-only with accurate copy and reset/create path. Upload/publish only DRAFT.
- Changed files: apps/server/src/sticker-pack-admin.ts and .test.ts; packages/contracts/src/sticker-pack-admin.ts; apps/web/src/StickerPackManager.tsx/.css/.test.tsx; apps/web/src/sticker-pack-api.ts. Shared routes.ts and contracts/index.ts registration belongs to connected integration freeze with UIX-293.
- Verification: independent API/UI focused gate 12/12 PASS, diff check PASS. Root outside-sandbox official pnpm filter server/web typecheck both exit0 and visibly execute tsc in correct worktree package. Sandbox npm/direct typecheck failures are retained as runner-context limitation, not relabeled successful.
- Remaining original scope: reviewed content/metadata, actual import and approved runtime/browser acceptance. This source gate is not task completion, content approval, production or deployment. No server started.
- Next: freeze accepted recovery with independently reviewed story integration after its cross-domain race fix; record actual commit and Linear stage gate.
