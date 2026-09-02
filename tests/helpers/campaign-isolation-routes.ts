export type HttpRouteKey =
  | `DELETE /${string}`
  | `GET /${string}`
  | `HEAD /${string}`
  | `OPTIONS /${string}`
  | `PATCH /${string}`
  | `POST /${string}`
  | `PUT /${string}`;

export type CampaignRoutePolicy =
  "CAMPAIGN" | "WORLD_CONTENT_CANON" | "OPERATOR_FEEDBACK";

export type RoutePolicyEntry = Readonly<{
  key: HttpRouteKey;
  policy: CampaignRoutePolicy;
}>;

export type RegisteredRoute = Readonly<{
  exposeHeadRoute?: boolean;
  handler?: unknown;
  method: string | readonly string[];
  path: string;
}>;

export type RouteInventoryDiff = Readonly<{
  duplicateRegistrations: readonly HttpRouteKey[];
  duplicatePolicies: readonly HttpRouteKey[];
  invalidPolicies: readonly string[];
  stale: readonly HttpRouteKey[];
  unlisted: readonly HttpRouteKey[];
}>;

/**
 * Canonical world-content records belong to the shared setting, not to a
 * campaign. Campaign-local copies live under /api/world-content-instances.
 */
export const WORLD_CONTENT_CANON_ROUTE_KEYS = [
  "DELETE /api/world-content/:id",
  "DELETE /api/world-content/:id/media/:mediaId",
  "DELETE /api/world-content/relations/:relationId",
  "GET /api/world-content/:id",
  "GET /api/world-content/:id/media",
  "GET /api/world-content/:id/relations",
  "PATCH /api/world-content/:id",
  "PATCH /api/world-content/:id/media/:mediaId",
  "POST /api/world-content/:id/lifecycle",
  "POST /api/world-content/:id/media",
  "POST /api/world-content/:id/relations",
] as const satisfies readonly HttpRouteKey[];

/** Operator feedback is intentionally global and protected by operator auth. */
export const OPERATOR_FEEDBACK_ROUTE_KEYS = [
  "GET /api/operator/feedback/:id",
  "GET /api/operator/feedback/:id/attachments/:attachmentId",
  "GET /api/operator/feedback/:id/export",
  "PATCH /api/operator/feedback/:id",
] as const satisfies readonly HttpRouteKey[];

export const CAMPAIGN_ROUTE_KEYS = [
  "DELETE /api/catalog/:id",
  "DELETE /api/character-media/:id",
  "DELETE /api/characters/:characterId/catalog/:id",
  "DELETE /api/drawings/:id",
  "DELETE /api/sticker-packs/:id",
  "DELETE /api/token-definitions/:id",
  "DELETE /api/tokens/:id",
  "DELETE /api/world-content-instances/:id",
  "DELETE /api/world-maps/locations/:id",
  "DELETE /api/world-maps/locations/:id/scenes/:sceneId",
  "GET /api/assets/:id/content",
  "GET /api/characters/:characterId/media",
  "GET /api/characters/:characterId/spell-progression",
  "GET /api/chat/attachments/:contentId/content",
  "GET /api/chat/threads/:threadId/messages",
  "GET /api/gm/characters/:characterId/spell-progression",
  "GET /api/player-requests/:id",
  "GET /api/preview/:membershipId",
  "GET /api/stickers/:id/content",
  "GET /api/story/media/:contentId",
  "GET /api/world-content-instances/:id",
  "PATCH /api/catalog/:id",
  "PATCH /api/character-media/:id",
  "PATCH /api/characters/:characterId/catalog/:id",
  "PATCH /api/characters/:id",
  "PATCH /api/characters/:id/counters",
  "PATCH /api/drawings/:id",
  "PATCH /api/memberships/:id/name",
  "PATCH /api/player-requests/:id",
  "PATCH /api/scenes/:id",
  "PATCH /api/scenes/:id/canvas",
  "PATCH /api/sticker-packs/:id",
  "PATCH /api/story/posts/:postId",
  "PATCH /api/token-definitions/:id",
  "PATCH /api/tokens/:id/appearance",
  "PATCH /api/tokens/:id/conditions",
  "PATCH /api/tokens/:id/layer",
  "PATCH /api/tokens/:id/size",
  "PATCH /api/world-content-instances/:id",
  "PATCH /api/world-maps/:id",
  "PATCH /api/world-maps/locations/:id",
  "POST /api/assets/:sourceAssetId/token",
  "POST /api/character-media/:id/detach",
  "POST /api/character-media/:id/reorder",
  "POST /api/characters/:characterId/catalog/:entryId/recharge",
  "POST /api/characters/:characterId/catalog/:entryId/roll",
  "POST /api/characters/:characterId/media",
  "POST /api/characters/:characterId/spell-assignments",
  "POST /api/characters/:characterId/spell-assignments/:assignmentId/versions",
  "POST /api/characters/:id/archive",
  "POST /api/characters/:id/catalog",
  "POST /api/characters/:id/restore",
  "POST /api/drawings/:id/copy",
  "POST /api/encounters/:id/end",
  "POST /api/player-access/:id/revoke",
  "POST /api/player-access/:id/rotate",
  "POST /api/player-requests/:id/actions",
  "POST /api/spell-packs/:id/archive",
  "POST /api/spell-packs/:id/lifecycle",
  "POST /api/spell-packs/:id/versions",
  "POST /api/sticker-packs/:id/deprecate",
  "POST /api/sticker-packs/:id/publish",
  "POST /api/sticker-packs/:id/stickers",
  "POST /api/story/posts/:postId/archive",
  "POST /api/story/posts/:postId/publish",
  "POST /api/token-definitions/:id/placements",
  "POST /api/world-maps/:id/approve-background",
  "POST /api/world-maps/:id/archive",
  "POST /api/world-maps/:id/draft-background",
  "POST /api/world-maps/:id/publish",
  "POST /api/world-maps/locations/:id/scenes/:sceneId",
  "PUT /api/characters/:id/controllers",
  "PUT /api/sticker-packs/:id/consent",
  "PUT /api/sticker-packs/:id/entitlements/:membershipId",
  "PUT /api/token-definitions/:id/controllers",
] as const satisfies readonly HttpRouteKey[];

export const GLOBAL_ROUTE_EXCEPTIONS = {
  OPERATOR_FEEDBACK: OPERATOR_FEEDBACK_ROUTE_KEYS,
  WORLD_CONTENT_CANON: WORLD_CONTENT_CANON_ROUTE_KEYS,
} as const satisfies Record<
  Exclude<CampaignRoutePolicy, "CAMPAIGN">,
  readonly HttpRouteKey[]
>;

export const ROUTE_POLICY_REGISTRY: readonly RoutePolicyEntry[] = [
  ...CAMPAIGN_ROUTE_KEYS.map((key) => ({ key, policy: "CAMPAIGN" as const })),
  ...WORLD_CONTENT_CANON_ROUTE_KEYS.map((key) => ({
    key,
    policy: "WORLD_CONTENT_CANON" as const,
  })),
  ...OPERATOR_FEEDBACK_ROUTE_KEYS.map((key) => ({
    key,
    policy: "OPERATOR_FEEDBACK" as const,
  })),
];

const ROUTE_POLICIES = new Set<CampaignRoutePolicy>([
  "CAMPAIGN",
  "WORLD_CONTENT_CANON",
  "OPERATOR_FEEDBACK",
]);

const PATH_PARAMETER_PATTERN = /:([A-Za-z][A-Za-z0-9_]*)/g;

export function hasIdPathParameter(path: string): boolean {
  return [...path.matchAll(PATH_PARAMETER_PATTERN)].some(
    ([, name]) => name === "id" || name?.endsWith("Id") === true,
  );
}

export function normalizeIdRouteInventory(
  routes: readonly RegisteredRoute[],
): HttpRouteKey[] {
  /*
   * Fastify clones a generated HEAD from its GET and preserves the handler
   * reference. An explicit HEAD can coexist with a preceding GET only when
   * that GET disables exposeHeadRoute. Require all three facts; incomplete
   * metadata stays fail-closed as an explicit route.
   */
  const derivedHeadIndexes = new Set<number>();
  for (const [index, route] of routes.entries()) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (
      methods.length !== 1 ||
      methods[0]?.toUpperCase() !== "HEAD" ||
      route.handler === undefined
    )
      continue;

    const hasPrecedingGet = routes.slice(0, index).some((candidate) => {
      const candidateMethods = Array.isArray(candidate.method)
        ? candidate.method
        : [candidate.method];
      return (
        candidate.path === route.path &&
        candidate.exposeHeadRoute !== false &&
        candidate.handler === route.handler &&
        candidateMethods.some((method) => method.toUpperCase() === "GET")
      );
    });
    if (hasPrecedingGet) derivedHeadIndexes.add(index);
  }

  return routes
    .flatMap(({ method, path }, index) => {
      if (derivedHeadIndexes.has(index)) {
        return [];
      }
      if (!hasIdPathParameter(path)) {
        return [];
      }

      const methods = Array.isArray(method) ? method : [method];
      return methods.map(
        (item) => `${item.toUpperCase()} ${path}` as HttpRouteKey,
      );
    })
    .sort();
}

function duplicateKeys(keys: readonly HttpRouteKey[]): HttpRouteKey[] {
  const counts = new Map<HttpRouteKey, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
}

export function diffRouteInventory(
  registeredKeys: readonly HttpRouteKey[],
  policyEntries: readonly Readonly<{ key: HttpRouteKey; policy: string }>[],
): RouteInventoryDiff {
  const policyKeys = policyEntries.map(({ key }) => key);
  const registeredSet = new Set(registeredKeys);
  const policySet = new Set(policyKeys);

  return {
    duplicateRegistrations: duplicateKeys(registeredKeys),
    duplicatePolicies: duplicateKeys(policyKeys),
    invalidPolicies: policyEntries
      .filter(
        ({ policy }) => !ROUTE_POLICIES.has(policy as CampaignRoutePolicy),
      )
      .map(({ key, policy }) => `${key} -> ${policy}`)
      .sort(),
    stale: [...policySet].filter((key) => !registeredSet.has(key)).sort(),
    unlisted: [...registeredSet].filter((key) => !policySet.has(key)).sort(),
  };
}

export function formatRouteInventoryDiff(diff: RouteInventoryDiff): string[] {
  return [
    ...diff.duplicateRegistrations.map(
      (key) => `DUPLICATE_ID_ROUTE_REGISTRATION: ${key}`,
    ),
    ...diff.duplicatePolicies.map((key) => `DUPLICATE_ID_ROUTE_POLICY: ${key}`),
    ...diff.invalidPolicies.map((entry) => `INVALID_ID_ROUTE_POLICY: ${entry}`),
    ...diff.stale.map((key) => `STALE_ID_ROUTE_POLICY: ${key}`),
    ...diff.unlisted.map((key) => `UNLISTED_ID_ROUTE: ${key}`),
  ];
}
