import Fastify from "fastify";
import { describe, expect, test } from "vitest";

import { registerRoutes } from "../apps/server/src/routes.js";
import {
  CAMPAIGN_ROUTE_KEYS,
  diffRouteInventory,
  formatRouteInventoryDiff,
  GLOBAL_ROUTE_EXCEPTIONS,
  hasIdPathParameter,
  normalizeIdRouteInventory,
  ROUTE_POLICY_REGISTRY,
  type HttpRouteKey,
  type RegisteredRoute,
} from "./helpers/campaign-isolation-routes.js";
import { CORE_CAMPAIGN_PROBE_KEYS } from "./helpers/uix413-core.js";
import { SUBROUTER_CAMPAIGN_PROBE_KEYS } from "./helpers/uix413-subrouters.js";

describe("campaign route inventory", () => {
  test("normalizes generated HEAD but retains explicit HEAD beside GET", async () => {
    const app = Fastify();
    const registeredRoutes: RegisteredRoute[] = [];
    app.addHook("onRoute", (route) => {
      registeredRoutes.push({
        exposeHeadRoute: route.exposeHeadRoute,
        handler: route.handler,
        method: route.method,
        path: route.url,
      });
    });
    app.get("/api/automatic/:id", async () => ({ ok: true }));
    const explicitHandler = async () => ({ ok: true });
    app.get("/api/explicit/:id", { exposeHeadRoute: false }, explicitHandler);
    app.head("/api/explicit/:id", explicitHandler);

    try {
      await app.ready();
      expect(normalizeIdRouteInventory(registeredRoutes)).toEqual([
        "GET /api/automatic/:id",
        "GET /api/explicit/:id",
        "HEAD /api/explicit/:id",
      ]);
    } finally {
      await app.close();
    }

    expect(
      normalizeIdRouteInventory([
        { method: "GET", path: "/api/unproven/:id" },
        { method: "HEAD", path: "/api/unproven/:id" },
      ]),
    ).toEqual(["GET /api/unproven/:id", "HEAD /api/unproven/:id"]);
    expect(hasIdPathParameter("/api/story/posts/:postId")).toBe(true);
    expect(hasIdPathParameter("/api/auth/player/:handle")).toBe(false);
  });

  test("includes an ID route registered by an async Fastify plugin", async () => {
    const app = Fastify();
    const registeredRoutes: RegisteredRoute[] = [];
    app.addHook("onRoute", (route) => {
      registeredRoutes.push({
        exposeHeadRoute: route.exposeHeadRoute,
        handler: route.handler,
        method: route.method,
        path: route.url,
      });
    });
    void app.register(async (plugin) => {
      await Promise.resolve();
      plugin.get("/api/__uix413_async/:id", async () => ({ ok: true }));
    });

    try {
      await app.ready();
      const routeKeys = normalizeIdRouteInventory(registeredRoutes);
      expect(
        formatRouteInventoryDiff(diffRouteInventory(routeKeys, [])),
      ).toEqual(["UNLISTED_ID_ROUTE: GET /api/__uix413_async/:id"]);
    } finally {
      await app.close();
    }
  });

  test("reports unlisted, stale and duplicate routes in both directions", () => {
    const registered = [
      "GET /api/scenes/:id",
      "PATCH /api/characters/:id",
      "PATCH /api/characters/:id",
      "POST /api/assets/:id/token",
    ] as const satisfies readonly HttpRouteKey[];
    const policies = [
      { key: "GET /api/scenes/:id", policy: "CAMPAIGN" },
      { key: "DELETE /api/tokens/:id", policy: "CAMPAIGN" },
      { key: "DELETE /api/tokens/:id", policy: "CAMPAIGN" },
      { key: "POST /api/assets/:id/token", policy: "ARBITRARY_EXCEPTION" },
    ] as const;

    expect(
      formatRouteInventoryDiff(diffRouteInventory(registered, policies)),
    ).toEqual([
      "DUPLICATE_ID_ROUTE_REGISTRATION: PATCH /api/characters/:id",
      "DUPLICATE_ID_ROUTE_POLICY: DELETE /api/tokens/:id",
      "INVALID_ID_ROUTE_POLICY: POST /api/assets/:id/token -> ARBITRARY_EXCEPTION",
      "STALE_ID_ROUTE_POLICY: DELETE /api/tokens/:id",
      "UNLISTED_ID_ROUTE: PATCH /api/characters/:id",
    ]);
  });

  test("requires an executable probe for every exact :id campaign route", () => {
    const exactIdCampaignRoutes = CAMPAIGN_ROUTE_KEYS.filter((key) =>
      key
        .slice(key.indexOf(" ") + 1)
        .split("/")
        .includes(":id"),
    );
    const probeKeys = [
      ...CORE_CAMPAIGN_PROBE_KEYS,
      ...SUBROUTER_CAMPAIGN_PROBE_KEYS,
    ];

    expect(exactIdCampaignRoutes.length).toBeGreaterThan(0);
    expect(probeKeys.length).toBeGreaterThan(0);
    expect(new Set(probeKeys).size).toBe(probeKeys.length);
    expect([...probeKeys].sort()).toEqual([...exactIdCampaignRoutes].sort());
  });

  test("has an exact closed policy for every registered ID route", async () => {
    const app = Fastify();
    const registeredRoutes: RegisteredRoute[] = [];
    app.addHook("onRoute", (route) => {
      registeredRoutes.push({
        exposeHeadRoute: route.exposeHeadRoute,
        handler: route.handler,
        method: route.method,
        path: route.url,
      });
    });

    try {
      registerRoutes(app, {} as never, {} as never);
      await app.ready();

      const routeKeys = normalizeIdRouteInventory(registeredRoutes);
      const diff = diffRouteInventory(routeKeys, ROUTE_POLICY_REGISTRY);

      expect(routeKeys.length).toBeGreaterThan(0);
      expect(CAMPAIGN_ROUTE_KEYS.length).toBeGreaterThan(0);
      expect(
        GLOBAL_ROUTE_EXCEPTIONS.WORLD_CONTENT_CANON.length,
      ).toBeGreaterThan(0);
      expect(GLOBAL_ROUTE_EXCEPTIONS.OPERATOR_FEEDBACK.length).toBeGreaterThan(
        0,
      );
      expect(
        registeredRoutes.some(
          ({ method, path }) =>
            method === "POST" && path === "/api/auth/player/:handle",
        ),
      ).toBe(true);
      expect(routeKeys).not.toContain("POST /api/auth/player/:handle");
      expect(formatRouteInventoryDiff(diff)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
