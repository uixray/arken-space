import { and, asc, eq, gt } from "drizzle-orm";
import { worldContent, worldContentImages, worldContentMedia } from "@arken/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { worldContentByIdVisibleTo } from "./world-content.js";
import { readStoredImage, removeStoredUpload } from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** A retained library blob is no longer owned exclusively by a campaign. */
export async function removeCampaignBlob(db: Database, storageKey: string) {
  const [retained] = await db.select({ id: worldContentImages.id })
    .from(worldContentImages).where(eq(worldContentImages.storageKey, storageKey)).limit(1);
  if (!retained) await removeStoredUpload(storageKey);
}

export function registerWorldContentImageRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/world-content-images", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const query = z.object({ cursor: z.string().uuid().optional() }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "INVALID_CURSOR" });
    const rows = await db.select({ id: worldContentImages.id, name: worldContentImages.name })
      .from(worldContentImages)
      .where(query.data.cursor ? gt(worldContentImages.id, query.data.cursor) : undefined)
      .orderBy(asc(worldContentImages.id)).limit(51);
    const items = rows.slice(0, 50).map(row => ({ ...row,
      url: `/api/world-content-images/${row.id}/content?campaignId=${auth.campaignId}`,
    }));
    return { items, nextCursor: rows.length > 50 ? items.at(-1)?.id ?? null : null };
  });
  app.get("/api/world-content-images/:imageId/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const params = z.object({ imageId: z.string().uuid() }).safeParse(request.params);
    const query = z.object({ campaignId: z.string().uuid() }).strict().safeParse(request.query);
    if (!params.success || !query.success || query.data.campaignId !== auth.campaignId)
      return reply.code(404).send({ error: "WORLD_CONTENT_IMAGE_NOT_FOUND" });
    const [image] = await db.select().from(worldContentImages)
      .where(eq(worldContentImages.id, params.data.imageId)).limit(1);
    if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType))
      return reply.code(404).send({ error: "WORLD_CONTENT_IMAGE_NOT_FOUND" });
    try {
      return reply.type(image.mimeType).header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", "inline; filename=world-image")
        .send(await readStoredImage(image.storageKey));
    } catch { return reply.code(404).send({ error: "WORLD_CONTENT_IMAGE_NOT_FOUND" }); }
  });
  app.get("/api/world-content/:id/images/:imageId/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    const params = z.object({ id: z.string().uuid(), imageId: z.string().uuid() })
      .safeParse(request.params);
    const query = z.object({ campaignId: z.string().uuid().optional() }).strict()
      .safeParse(request.query);
    const missing = () => reply.code(404).send({ error: "WORLD_CONTENT_IMAGE_NOT_FOUND" });
    if (!params.success || !query.success ||
        (query.data.campaignId && query.data.campaignId !== auth.campaignId)) return missing();
    const { id, imageId } = params.data;
    const [subject] = await db.select({ cover: worldContent.coverAssetId })
      .from(worldContent).where(worldContentByIdVisibleTo(auth, id)).limit(1);
    if (!subject) return missing();
    if (subject.cover !== imageId) {
      const [gallery] = await db.select({ id: worldContentMedia.id })
        .from(worldContentMedia).where(and(
          eq(worldContentMedia.worldContentId, id), eq(worldContentMedia.assetId, imageId),
        )).limit(1);
      if (!gallery) return missing();
    }
    const [image] = await db.select().from(worldContentImages)
      .where(eq(worldContentImages.id, imageId)).limit(1);
    if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType))
      return missing();
    try {
      const bytes = await readStoredImage(image.storageKey);
      return reply.type(image.mimeType).header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", "inline; filename=world-image").send(bytes);
    } catch {
      return missing();
    }
  });
}
