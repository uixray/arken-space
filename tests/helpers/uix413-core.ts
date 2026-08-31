/**
 * UIX-413 — буквальные `:id`-маршруты ядра, для которых есть исполняемый
 * двухкампанейный probe в `campaign-isolation-core.integration.test.ts`.
 *
 * Это не список всех параметризованных API: structural gate отдельно видит
 * `:characterId`, `:membershipId` и sub-router'ы. Экспорт нужен, чтобы union
 * поведенческих матриц механически сравнивался с закрытым реестром политик.
 */
export const CORE_CAMPAIGN_PROBE_KEYS = [
  "PATCH /api/memberships/:id/name",
  "PUT /api/characters/:id/controllers",
  "PATCH /api/characters/:id",
  "POST /api/characters/:id/archive",
  "POST /api/characters/:id/restore",
  "PATCH /api/catalog/:id",
  "DELETE /api/catalog/:id",
  "POST /api/characters/:id/catalog",
  "PATCH /api/characters/:characterId/catalog/:id",
  "DELETE /api/characters/:characterId/catalog/:id",
  "POST /api/player-access/:id/revoke",
  "POST /api/player-access/:id/rotate",
  "PATCH /api/scenes/:id",
  "POST /api/token-definitions/:id/placements",
  "PATCH /api/tokens/:id/size",
  "PATCH /api/tokens/:id/appearance",
  "PATCH /api/tokens/:id/conditions",
  "DELETE /api/tokens/:id",
  "PUT /api/token-definitions/:id/controllers",
  "PATCH /api/token-definitions/:id",
  "DELETE /api/token-definitions/:id",
  "PATCH /api/tokens/:id/layer",
  "PATCH /api/drawings/:id",
  "POST /api/drawings/:id/copy",
  "DELETE /api/drawings/:id",
  "PATCH /api/scenes/:id/canvas",
  "PATCH /api/sticker-packs/:id",
  "DELETE /api/sticker-packs/:id",
  "POST /api/sticker-packs/:id/stickers",
  "POST /api/sticker-packs/:id/publish",
  "POST /api/sticker-packs/:id/deprecate",
  "PUT /api/sticker-packs/:id/entitlements/:membershipId",
  "PUT /api/sticker-packs/:id/consent",
  "GET /api/stickers/:id/content",
  "PATCH /api/characters/:id/counters",
  "GET /api/assets/:id/content",
] as const;

export type CoreCampaignProbeKey = (typeof CORE_CAMPAIGN_PROBE_KEYS)[number];
