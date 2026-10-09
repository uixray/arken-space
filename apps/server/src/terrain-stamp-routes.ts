import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { campaigns, drawings, scenes } from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

const stampCatalog = {
  forest: {
    assetKey: "forest",
    packId: "builtin-terrain-v1",
    contentType: "image/png",
    path: new URL("../assets/terrain-stamps/forest.png", import.meta.url),
  },
  mountains: {
    assetKey: "mountains",
    packId: "builtin-terrain-v1",
    contentType: "image/png",
    path: new URL("../assets/terrain-stamps/mountains.png", import.meta.url),
  },
  clouds: {
    assetKey: "clouds",
    packId: "builtin-terrain-v1",
    contentType: "image/png",
    path: new URL("../assets/terrain-stamps/clouds.png", import.meta.url),
  },
} as const;

const assetKeySchema = z.enum(["forest", "mountains", "clouds"]);

async function mayReadStampAsset(
  db: Database,
  auth: AuthContext,
  assetKey: keyof typeof stampCatalog,
) {
  if (auth.role === "GM") return true;
  const [visibleInstance] = await db
    .select({ id: drawings.id })
    .from(drawings)
    .innerJoin(scenes, eq(drawings.sceneId, scenes.id))
    .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
    .where(
      and(
        eq(scenes.campaignId, auth.campaignId),
        eq(campaigns.activeSceneId, scenes.id),
        eq(drawings.kind, "STAMP"),
        eq(drawings.stampAssetKey, assetKey),
        eq(drawings.stampLayer, "PUBLIC"),
      ),
    )
    .limit(1);
  return Boolean(visibleInstance);
}

/** Built-in pixels are private content: only a GM or a campaign-visible public
 * stamp instance can authorize reads. Never resolve user input as a path. */
export function registerTerrainStampRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/terrain-stamps/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return reply.code(403).send({ error: "STAMP_CATALOG_FORBIDDEN" });
    return {
      packId: "builtin-terrain-v1",
      stamps: Object.values(stampCatalog).map(({ assetKey, packId }) => ({ assetKey, packId })),
    };
  });

  app.get<{ Params: { assetKey: string } }>(
    "/api/terrain-stamps/assets/:assetKey",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const parsed = assetKeySchema.safeParse(request.params.assetKey);
      if (!parsed.success) return reply.code(404).send({ error: "STAMP_ASSET_NOT_FOUND" });
      if (!(await mayReadStampAsset(db, auth, parsed.data)))
        return reply.code(404).send({ error: "STAMP_ASSET_NOT_FOUND" });

      // Authorization precedes all response handling; no conditional/range
      // headers can turn an unauthorized request into a cache oracle.
      const asset = stampCatalog[parsed.data];
      const bytes = await readFile(fileURLToPath(asset.path));
      return reply
        .header("Content-Type", asset.contentType)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes);
    },
  );
}
