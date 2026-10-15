import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { STAMP_TEMPLATE_KEY_PATTERN } from "@arken/contracts";
import { campaigns, drawings, scenes } from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export const BUILTIN_STAMP_PACK_ID = "builtin-terrain-v1";
export const CAMPAIGN_IMAGE_STAMP_PACK_ID = "campaign-image";

const catalogDirectory = new URL("../assets/terrain-stamps/", import.meta.url);

const manifestSchema = z.object({
  packId: z.literal(BUILTIN_STAMP_PACK_ID),
  stamps: z
    .array(
      z.object({
        key: z.string().regex(STAMP_TEMPLATE_KEY_PATTERN),
        title: z.string().trim().min(1).max(60),
        // A bare file name in the catalog folder; never a path from a client.
        file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.(png|webp)$/),
      }),
    )
    .min(1),
});

/**
 * UIX-706: built-in templates are data, not code. Adding a template is one
 * image file plus one manifest entry; the DB only checks the key pattern.
 */
export function loadStampCatalog(
  manifest: unknown = JSON.parse(
    readFileSync(new URL("catalog.json", catalogDirectory), "utf8"),
  ),
) {
  const parsed = manifestSchema.parse(manifest);
  const keys = new Set<string>();
  for (const stamp of parsed.stamps) {
    if (keys.has(stamp.key))
      throw new Error(`Duplicate stamp template key: ${stamp.key}`);
    keys.add(stamp.key);
  }
  return new Map(
    parsed.stamps.map((stamp) => [
      stamp.key,
      {
        key: stamp.key,
        title: stamp.title,
        contentType: stamp.file.endsWith(".webp") ? "image/webp" : "image/png",
        path: new URL(stamp.file, catalogDirectory),
      },
    ]),
  );
}

let catalogCache: ReturnType<typeof loadStampCatalog> | null = null;
export function stampCatalog() {
  catalogCache ??= loadStampCatalog();
  return catalogCache;
}

async function mayReadStampAsset(
  db: Database,
  auth: AuthContext,
  assetKey: string,
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
        eq(drawings.stampPackId, BUILTIN_STAMP_PACK_ID),
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
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "STAMP_CATALOG_FORBIDDEN" });
    return {
      packId: BUILTIN_STAMP_PACK_ID,
      stamps: [...stampCatalog().values()].map(({ key, title }) => ({
        assetKey: key,
        packId: BUILTIN_STAMP_PACK_ID,
        title,
      })),
    };
  });

  app.get<{ Params: { assetKey: string } }>(
    "/api/terrain-stamps/assets/:assetKey",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const asset = stampCatalog().get(request.params.assetKey);
      if (!asset)
        return reply.code(404).send({ error: "STAMP_ASSET_NOT_FOUND" });
      if (!(await mayReadStampAsset(db, auth, asset.key)))
        return reply.code(404).send({ error: "STAMP_ASSET_NOT_FOUND" });

      // Authorization precedes all response handling; no conditional/range
      // headers can turn an unauthorized request into a cache oracle.
      const bytes = await readFile(fileURLToPath(asset.path));
      return reply
        .header("Content-Type", asset.contentType)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes);
    },
  );
}
