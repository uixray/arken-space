# UIX-243 discovery checkpoint — 2026-07-23

## Decisions

- Keep world geography separate from tactical `scenes`; use a dedicated campaign-scoped aggregate and workspace.
- Treat the ten legacy maps as private, review-only references. Do not publish, redraw, or infer authoritative distances from their pixels.
- Start with a safe product slice: one published world/region map, normalized locations, server-filtered visibility, public/GM location cards, one GM-controlled `partyLocationId`, explicit scene links, audit events, realtime and reload.
- Defer hierarchy editing, routes, pathfinding, travel calculations, `in transit`, encyclopedia joins, and legacy-map publication until the reference inventory and product rules are approved.
- MVP has no computed distance or travel cost. Party position is location-only.
- Background replacement must use draft → marker review → explicit publish; coordinates are never remapped silently.

## Source inventory

- Source located in Eagle library `Arhen Khar`, folder `MP3RT8850N5L1` (`Карты аркен хара`).
- The folder contains exactly ten 1280×960 JPG files. Eagle IDs: `MQWO8TVIKFDRP`, `MQWO8TVJQJKX5`, `MQWO8TVJ669UI`, `MQWO8TVJ4SOVR`, `MQWO8TVJACIUS`, `MQWO8TVK6HR2J`, `MQWO8TVKAWCHJ`, `MQWO8TVKQBM8X`, `MQWO8TVKFTCTY`, `MQWO8TVKTI5C6`.
- Names are generic `photo_1…photo_10`; Eagle tags, annotations and source URLs are empty.
- No copies are added to Git or public assets. Eagle remains the source of truth for these private references.

### Preliminary map inventory

| Source | Candidate scope | Readable reference labels | Review notes |
| --- | --- | --- | --- |
| photo 10 | WORLD overview | Центральный Аркейн, Северный Аркейн-Хар, Восточный Аркейн-Хар, Южный Аркейн-Хар, Велтория, Крестландия, Аландрия | Best hierarchy root; borders and scale are illustrative. |
| photo 1 | Central Arkein / Krestlandia border | Центральный Аркейн, Крестландия, Берхор, Каранаир | Candidate regional overview; several labels need original-resolution GM confirmation. |
| photo 2 | Central Arkein | Центральный Аркейн, Северный/Южный/Восточный/Западный Аркейн, Тристонния, Амбрион, Леонарис, Янтарная башня, Броистан | Candidate child map; distinguish settlements from landmarks. |
| photo 3 | South Arkein coast | Южный Аркейн, Аландрия, Сталград, Храм, island and coastal labels | Candidate regional/coastal child; small labels remain uncertain. |
| photo 4 | Alandria | Аландрия, Пустыня Сияния, Кампилак, Мешнарак, Махлар | Candidate country/island overview. |
| photo 5 | Veltoria | Велтория, Арквин, Крестландия, Аландрия, Норвиан, Тримун, Хантар, Дианри | Candidate country overview; spelling requires GM confirmation. |
| photo 8 | Western/northern subregion | Море Хьёрд, Драконьи Клыки, Хорст, Бреган, Майкал, Арфонг, Переправа, Локсвилл | Candidate regional map; parent is not explicit. |
| photos 6, 7, 9 | Unclassified regional references | Metadata confirmed; labels not safely transcribed in this pass | Review at original resolution before hierarchy assignment. |

### Candidate hierarchy

1. `photo 10` — WORLD root.
2. `photo 1`, `photo 2`, `photo 3`, `photo 4`, `photo 5`, `photo 8` — candidate REGION maps.
3. `photos 6`, `7`, `9` — pending classification.

This is a review inventory, not canonical geography. No route edge, distance, border, or parent relationship is approved solely from image pixels.

## Integration boundary

- Schema: dedicated `world_maps`, `world_map_locations`, party-position and scene-link tables with campaign-scoped foreign keys and revisions.
- Contracts: bounded Zod commands and filtered snapshot DTOs.
- Server: GM-only idempotent mutations using `gameEvents`; authoritative filtering in `buildSnapshot`; full filtered snapshot broadcast.
- Assets: reuse `AssetKind.MAP`, but expose world-map assets only when referenced by the viewer's authorized projection.
- Web: dedicated draggable `WorldMapsWorkspace`; do not reuse the combat renderer wholesale.

## Verification

- Read-only audit of Linear, Eagle, repository, schema/routes/snapshot/realtime/workspace patterns.
- No legacy map was copied to Git or public storage.
- No production deployment was performed.

## Open review items

- Canonical spelling, parent scope of photos 6/7/8/9, and which illustrated roads become real route edges require GM review.
- Eagle metadata has no provenance/copyright/source URL. The maps remain private references until a modern redraw is approved.

## Next action

1. Implement the safe asset-independent MVP foundation.
2. Review the inventory and classify photos 6/7/8/9 before importing geography.
3. Select or produce one approved background through the redraw gate before player publication.


## Implementation checkpoint

### Delivered

- Dedicated world-map persistence and contracts: maps, normalized locations, scene links, approved background lifecycle, location-only party position and campaign-safe foreign keys.
- Server-authoritative projection: players only receive published campaign maps, visible/discovered locations, permitted active-scene links and authorized background assets; GM-only notes and draft metadata remain private.
- GM workflow: create draft, choose MAP asset, approve background, manage locations and scene links, publish/archive, and set/clear party position.
- Dedicated draggable World Maps workspace with marker buttons, textual location list, cards, GM lifecycle controls, keyboard/focus/Escape handling and narrow layout.
- Idempotent audited mutations with optimistic revisions and race-safe handling for duplicate action IDs and the initial party-position insert.
- No Eagle reference image was copied, seeded or publicly published.

### Changed areas

- Database: `packages/db/drizzle/0020_world_maps.sql`, schema and journal.
- Contracts: `packages/contracts/src/index.ts`.
- Server: world-map access, projection and routes; snapshot/route registration.
- Web: `WorldMapsWorkspace`, state helpers, App/Sidebar integration and styles.
- Tests: migration/contracts, server visibility/idempotency, workspace state, visibility harness and Playwright world-map flows.

### Verification

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm build` — PASS (existing bundle-size warning only).
- `pnpm test -- --maxWorkers=1` — PASS, 52 files / 269 tests.
- UIX-243 Playwright — PASS, 2/2.
- Combined security review — no remaining P0/P1.
- `git diff --check` — PASS (line-ending warnings only).

### Remaining product/content gates

- Classify Eagle photos 6/7/8/9 and confirm canonical spelling/hierarchy with the GM.
- Record provenance/copyright context and approve a modern redraw/background before publishing real geography.
- Routes, explicit distance, pathfinding, hierarchy editor and in-transit state remain intentionally deferred.

### Deployment

- Production deployment was not requested and was not performed.
