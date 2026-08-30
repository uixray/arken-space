/**
 * Parameterized campaign routes registered outside the central routes.ts.
 *
 * Keep this list paired with executable cross-campaign probes in
 * campaign-isolation-subrouters.integration.test.ts. The structural UIX-413
 * guard imports it so a newly registered route cannot silently remain
 * unclassified.
 */
export const SUBROUTER_CAMPAIGN_PROBE_KEYS = [
  "PATCH /api/character-media/:id",
  "POST /api/character-media/:id/reorder",
  "POST /api/character-media/:id/detach",
  "DELETE /api/character-media/:id",
  "POST /api/encounters/:id/end",
  "GET /api/player-requests/:id",
  "PATCH /api/player-requests/:id",
  "POST /api/player-requests/:id/actions",
  "GET /api/world-content-instances/:id",
  "PATCH /api/world-content-instances/:id",
  "DELETE /api/world-content-instances/:id",
  "PATCH /api/world-maps/:id",
  "POST /api/world-maps/:id/draft-background",
  "POST /api/world-maps/:id/approve-background",
  "POST /api/world-maps/:id/publish",
  "POST /api/world-maps/:id/archive",
  "PATCH /api/world-maps/locations/:id",
  "DELETE /api/world-maps/locations/:id",
  "POST /api/world-maps/locations/:id/scenes/:sceneId",
  "DELETE /api/world-maps/locations/:id/scenes/:sceneId",
] as const;

export type SubrouterCampaignProbeKey =
  (typeof SUBROUTER_CAMPAIGN_PROBE_KEYS)[number];
