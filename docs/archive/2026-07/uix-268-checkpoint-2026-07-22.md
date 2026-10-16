# UIX-268 checkpoint — 2026-07-22

## Decisions

- Ship the sticker-pack platform with an empty catalog: the 37 concepts found in project notes are drafts, not approved production assets.
- Keep sticker media outside the generic asset API and enforce campaign, entitlement, direct-thread, and consent access on catalog, send, snapshot, and binary delivery.
- Freeze the authorized audience on each sent sticker. Later entitlement changes do not rewrite history; revoking player-likeness consent is an emergency takedown and replaces historical media with a neutral tombstone.
- Stickers can be sent to TABLE, STORY, and DIRECT threads. ROLLS remains system-only.

## Revision

- Base: `559e7b3`
- UIX-268 revision: pending commit

## Changed files

- Database and contracts: `packages/db/drizzle/0019_sticker_packs.sql`, schema/journal, contract types and validation.
- Server: sticker access policy, CRUD/publish/consent/entitlement/send/content routes, snapshot filtering and tests.
- Web: accessible sticker picker, stream/direct integration, authorized rendering, narrow-layout and stacking fixes.
- Verification: migration, contract, server, web-state and combined chat E2E coverage.

## Verification

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS (existing bundle-size warning only).
- `pnpm test -- --maxWorkers=1` — PASS, 48 files / 256 tests.
- Combined UIX-266/UIX-267/UIX-268 Playwright gate — PASS, 6/6.
- `git diff --check` — PASS (line-ending warnings only).

## Blockers

- None for the service integration.
- Publishing real sticker content requires an explicitly approved asset manifest with authorship/license/provenance and player-likeness consent where applicable. No Telegram, Eagle, or Obsidian media was imported.

## Next action

- Commit and publish UIX-268, close its Linear stage gate, then continue with the public discovery/inventory task UIX-243.
- Production deployment is intentionally excluded from this pool.
