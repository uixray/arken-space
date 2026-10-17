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

export const BUILTIN_TEXTURE_PACK_ID = "builtin-texture-v1";

const catalogEntrySchema = z.object({
  key: z.string().regex(STAMP_TEMPLATE_KEY_PATTERN),
  title: z.string().trim().min(1).max(60),
  // A bare file name in the catalog folder; never a path from a client.
  file: z.string().regex(/^[a-z0-9][a-z0-9-]*\.(png|webp)$/),
});

const manifestSchema = z.object({
  packId: z.literal(BUILTIN_STAMP_PACK_ID),
  stamps: z.array(catalogEntrySchema).min(1),
  /** UIX-706 pool 3: tileable textures for the texture brush; may be empty. */
  textures: z.array(catalogEntrySchema).default([]),
});

type CatalogEntry = z.infer<typeof catalogEntrySchema>;

function catalogMap(entries: CatalogEntry[], section: string) {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key))
      throw new Error(`Duplicate ${section} key: ${entry.key}`);
    keys.add(entry.key);
  }
  return new Map(
    entries.map((entry) => [
      entry.key,
      {
        key: entry.key,
        title: entry.title,
        contentType: entry.file.endsWith(".webp") ? "image/webp" : "image/png",
        path: new URL(entry.file, catalogDirectory),
      },
    ]),
  );
}

/**
 * UIX-706: built-in templates and textures are data, not code. Adding one is
 * an image file plus one manifest entry; the DB only checks the key pattern.
 */
export function loadStampCatalog(
  manifest: unknown = JSON.parse(
    readFileSync(new URL("catalog.json", catalogDirectory), "utf8"),
  ),
) {
  const parsed = manifestSchema.parse(manifest);
  return {
    stamps: catalogMap(parsed.stamps, "stamp template"),
    textures: catalogMap(parsed.textures, "texture"),
  };
}

let catalogCache: ReturnType<typeof loadStampCatalog> | null = null;
export function stampCatalog() {
  catalogCache ??= loadStampCatalog();
  return catalogCache.stamps;
}
export function textureCatalog() {
  catalogCache ??= loadStampCatalog();
  return catalogCache.textures;
}

async function mayReadStampAsset(
  db: Database,
  auth: AuthContext,
  assetKey: string,
  kind: "STAMP" | "TEXTURE" = "STAMP",
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
        eq(drawings.kind, kind),
        eq(
          drawings.stampPackId,
          kind === "STAMP" ? BUILTIN_STAMP_PACK_ID : BUILTIN_TEXTURE_PACK_ID,
        ),
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
      textures: [...textureCatalog().values()].map(({ key, title }) => ({
        assetKey: key,
        packId: BUILTIN_TEXTURE_PACK_ID,
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

  app.get<{ Params: { assetKey: string } }>(
    "/api/terrain-stamps/textures/:assetKey",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const asset = textureCatalog().get(request.params.assetKey);
      if (!asset)
        return reply.code(404).send({ error: "STAMP_ASSET_NOT_FOUND" });
      if (!(await mayReadStampAsset(db, auth, asset.key, "TEXTURE")))
        return reply.code(404).send({ error: "STAMP_ASSET_NOT_FOUND" });
      const bytes = await readFile(fileURLToPath(asset.path));
      return reply
        .header("Content-Type", asset.contentType)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes);
    },
  );
}
