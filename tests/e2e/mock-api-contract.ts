import type { Route } from "@playwright/test";

/**
 * UIX-693: what a mocked e2e spec may answer for a GET it did not mock itself.
 *
 * Specs used to end their API router with `route.fulfill({ json: [] })` for
 * every unmatched GET. That hid real contract drift: the operator capability
 * check got a truthy `[]` instead of the server's 403, so every mocked client
 * believed it was an operator. Now only real collection endpoints may default
 * to an empty list, known capability probes answer like the server does for
 * an ordinary member, and anything else fails the test by name.
 *
 * `tests/mock-api-contract.test.ts` checks every entry against the server's
 * registered GET routes, so this list cannot silently go stale.
 */
export const EMPTY_COLLECTION_GETS = [
  "/api/canvas/history",
  "/api/characters/archived",
  "/api/characters/:characterId/media",
  "/api/gm/global-sticker-packs",
  "/api/gm/sticker-packs",
  "/api/player-access",
  "/api/stickers",
  "/api/world-content",
] as const;

/** Capability probes: the server's answer for a non-privileged member. */
export const DENIED_CAPABILITY_GETS: Record<
  string,
  { status: number; error: string }
> = {
  "/api/operator/feedback/capability": {
    status: 403,
    error: "OPERATOR_REQUIRED",
  },
};

export class UnmockedApiRequestError extends Error {
  constructor(method: string, path: string) {
    super(
      `Unmocked API request: ${method} ${path}. Mock it in the spec, or add a real collection endpoint to tests/e2e/mock-api-contract.ts.`,
    );
  }
}

/** Server-style route template (`:param` = one path segment) as a matcher. */
export function routeTemplateMatches(template: string, path: string) {
  const pattern = template
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${pattern}$`).test(path);
}

/** The contract decision for an unmatched request, without Playwright. */
export function unmockedResponse(method: string, path: string) {
  if (method === "GET") {
    if (
      EMPTY_COLLECTION_GETS.some((template) =>
        routeTemplateMatches(template, path),
      )
    )
      return { status: 200, json: [] as unknown };
    const denied = DENIED_CAPABILITY_GETS[path];
    if (denied)
      return {
        status: denied.status,
        json: { error: denied.error } as unknown,
      };
  }
  throw new UnmockedApiRequestError(method, path);
}

/** Use as the last branch of a spec's `**\/api/**` router. */
export function fulfillUnmocked(route: Route, path: string) {
  const { status, json } = unmockedResponse(route.request().method(), path);
  return route.fulfill({ status, json });
}
