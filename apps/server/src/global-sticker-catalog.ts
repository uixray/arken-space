import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq, inArray, isNull, or, sql, sum } from "drizzle-orm";
import { globalStickerMedia, globalStickerPacks, globalStickers, assets, feedbackAttachments, chatAttachmentUploads, stickerMedia } from "@arken/db";
import { isOperatorMembershipId, requireAuth } from "./auth.js";
import { env } from "./env.js";
import { publicUploadError } from "./telemetry.js";
import { assertStorageCapacity, openStoredFile, removeStoredUpload, storeUpload } from "./storage.js";
import type { createDatabase } from "@arken/db";

type Database = ReturnType<typeof createDatabase>["db"];

function managerOwnershipFilter(auth: { membershipId: string }) {
  return isOperatorMembershipId(auth.membershipId)
    ? or(eq(globalStickerPacks.creatorMembershipId, auth.membershipId), isNull(globalStickerPacks.creatorMembershipId))!
    : eq(globalStickerPacks.creatorMembershipId, auth.membershipId);
}

export function registerGlobalStickerRoutes(
  app: FastifyInstance,
  db: Database,
  authenticate: typeof requireAuth = (request, reply, database) => requireAuth(request, reply, database),
) {
  const gm = async (request: Parameters<typeof requireAuth>[0], reply: Parameters<typeof requireAuth>[1]) => {
    if (!env.GLOBAL_STICKERS_ENABLED) { reply.code(404).send({ error: "GLOBAL_STICKERS_DISABLED" }); return null; }
    const auth = await authenticate(request, reply, db);
    if (!auth || auth.role !== "GM") {
      if (auth) reply.code(403).send({ error: "GM_REQUIRED" });
      return null;
    }
    return auth;
  };
  const metadataSchema = z.object({
    actionId: z.string().uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(1).max(80),
    altText: z.string().trim().min(1).max(240),
    authorCredit: z.string().trim().max(240).nullable().optional(),
    licenseNote: z.string().trim().max(500).nullable().optional(),
    sourceReference: z.string().trim().max(1000).nullable().optional(),
  }).strict();

  app.get("/api/gm/global-sticker-packs", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    reply.header("Cache-Control", "private, no-store");
    return db.select().from(globalStickerPacks).where(managerOwnershipFilter(auth));
  });
  app.get("/api/gm/global-sticker-packs/:id", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [pack] = await db.select().from(globalStickerPacks).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth))).limit(1);
    if (!pack) return reply.code(404).send({ error: "GLOBAL_STICKER_PACK_NOT_FOUND" });
    const items = await db.select({ sticker: globalStickers, media: globalStickerMedia }).from(globalStickers).innerJoin(globalStickerMedia, eq(globalStickerMedia.id, globalStickers.mediaId)).where(eq(globalStickers.packId, id)).orderBy(asc(globalStickers.createdAt), asc(globalStickers.id));
    return { ...pack, stickers: items.map(({ sticker, media }) => ({ id: sticker.id, actionId: sticker.actionId, name: sticker.name, altText: sticker.altText, authorCredit: sticker.authorCredit, licenseNote: sticker.licenseNote, sourceReference: sticker.sourceReference, sha256: media.sha256, width: media.width, height: media.height })) };
  });
  app.post("/api/gm/global-sticker-packs", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    const body = z.object({ actionId: z.string().uuid(), name: z.string().trim().min(1).max(120) }).strict().parse(request.body);
    const [created] = await db.insert(globalStickerPacks).values({ name: body.name, createActionId: body.actionId, creatorMembershipId: auth.membershipId }).onConflictDoNothing({ target: [globalStickerPacks.creatorMembershipId, globalStickerPacks.createActionId] }).returning();
    if (created) return reply.code(201).send(created);
    const [prior] = await db.select().from(globalStickerPacks).where(and(eq(globalStickerPacks.creatorMembershipId, auth.membershipId), eq(globalStickerPacks.createActionId, body.actionId))).limit(1);
    if (!prior) throw new Error("GLOBAL_STICKER_CREATE_REPLAY_MISSING");
    return prior.name === body.name
      ? reply.code(200).send(prior)
      : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
  });
  app.patch("/api/gm/global-sticker-packs/:id", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ revision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(120) }).strict().parse(request.body);
    const [pack] = await db.update(globalStickerPacks).set({ name: body.name, revision: body.revision + 1, updatedAt: new Date() }).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth), eq(globalStickerPacks.lifecycle, "DRAFT"), eq(globalStickerPacks.revision, body.revision))).returning();
    if (!pack) return reply.code(404).send({ error: "GLOBAL_STICKER_PACK_NOT_FOUND" });
    return pack;
  });
  app.post("/api/gm/global-sticker-packs/:id/stickers", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const metadata = metadataSchema.parse(request.query);
    const [ownedPack] = await db.select().from(globalStickerPacks).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth))).limit(1);
    if (!ownedPack) return reply.code(404).send({ error: "GLOBAL_STICKER_PACK_NOT_FOUND" });
    const [prior] = await db.select({ sticker: globalStickers, sha256: globalStickerMedia.sha256 }).from(globalStickers).innerJoin(globalStickerMedia, eq(globalStickerMedia.id, globalStickers.mediaId)).where(and(eq(globalStickers.packId, id), eq(globalStickers.actionId, metadata.actionId))).limit(1);
    if (prior) {
      const matches = prior.sha256 === metadata.sourceSha256 && prior.sticker.name === metadata.name && prior.sticker.altText === metadata.altText &&
        (prior.sticker.authorCredit ?? null) === (metadata.authorCredit ?? null) &&
        (prior.sticker.licenseNote ?? null) === (metadata.licenseNote ?? null) &&
        (prior.sticker.sourceReference ?? null) === (metadata.sourceReference ?? null);
      return matches ? reply.code(200).send(prior.sticker) : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    }
    if (ownedPack.lifecycle !== "DRAFT") return reply.code(409).send({ error: "STICKER_PACK_NOT_DRAFT", revision: ownedPack.revision });
    const file = await request.file({ limits: { files: 1, fileSize: 5 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "UPLOAD_REQUIRED" });
    const buffer = await file.toBuffer();
    const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
    if (sourceSha256 !== metadata.sourceSha256) return reply.code(400).send({ error: "SOURCE_SHA256_MISMATCH" });
    const usages = await Promise.all([
      db.select({ used: sum(assets.sizeBytes) }).from(assets),
      db.select({ used: sum(feedbackAttachments.sizeBytes) }).from(feedbackAttachments),
      db.select({ used: sum(chatAttachmentUploads.sizeBytes) }).from(chatAttachmentUploads),
      db.select({ used: sum(stickerMedia.sizeBytes) }).from(stickerMedia),
      db.select({ used: sum(globalStickerMedia.sizeBytes) }).from(globalStickerMedia),
    ]);
    await assertStorageCapacity(usages.reduce((n, rows) => n + Number(rows[0]?.used ?? 0), 0), buffer.length);
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      stored = await storeUpload(buffer, "image");
      if (stored.mimeType !== "image/webp" || !stored.width || !stored.height || stored.width > 4096 || stored.height > 4096) throw new Error("INVALID_STICKER_MEDIA");
      const result = await db.transaction(async (tx) => {
        const [locked] = await tx.select({ id: globalStickerPacks.id }).from(globalStickerPacks).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth), eq(globalStickerPacks.lifecycle, "DRAFT"))).for("update").limit(1);
        if (!locked) throw new Error("GLOBAL_STICKER_PACK_NOT_DRAFT");
        const [duplicateMedia] = await tx.select({ id: globalStickers.id }).from(globalStickers).innerJoin(globalStickerMedia, eq(globalStickerMedia.id, globalStickers.mediaId)).where(and(eq(globalStickers.packId, id), eq(globalStickerMedia.sha256, sourceSha256))).limit(1);
        if (duplicateMedia) throw new Error("DUPLICATE_STICKER_MEDIA");
        const [media] = await tx.insert(globalStickerMedia).values({ uploadedByMembershipId: auth.membershipId, storageKey: stored!.storageKey, mimeType: stored!.mimeType, sizeBytes: stored!.sizeBytes, width: stored!.width!, height: stored!.height!, sha256: createHash("sha256").update(buffer).digest("hex") }).returning();
        const { sourceSha256: _sourceSha256, ...stickerMetadata } = metadata;
        const [sticker] = await tx.insert(globalStickers).values({ packId: id, mediaId: media!.id, ...stickerMetadata }).returning();
        return sticker;
      });
      return reply.code(201).send(result);
    } catch (error) {
      const [replay] = await db.select({ sticker: globalStickers, sha256: globalStickerMedia.sha256, storageKey: globalStickerMedia.storageKey }).from(globalStickers).innerJoin(globalStickerMedia, eq(globalStickerMedia.id, globalStickers.mediaId)).where(and(eq(globalStickers.packId, id), eq(globalStickers.actionId, metadata.actionId))).limit(1);
      if (replay) {
        const matches = replay.sha256 === metadata.sourceSha256 && replay.sticker.name === metadata.name && replay.sticker.altText === metadata.altText &&
          (replay.sticker.authorCredit ?? null) === (metadata.authorCredit ?? null) &&
          (replay.sticker.licenseNote ?? null) === (metadata.licenseNote ?? null) &&
          (replay.sticker.sourceReference ?? null) === (metadata.sourceReference ?? null);
        // The transaction may have committed but its acknowledgement was
        // lost. Preserve the file referenced by that committed winning row;
        // discard only this request's unreferenced temporary upload.
        if (stored && replay.storageKey !== stored.storageKey) await removeStoredUpload(stored.storageKey);
        return matches ? reply.code(200).send(replay.sticker) : reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
      }
      if (stored) await removeStoredUpload(stored.storageKey);
      if (error instanceof Error && error.message === "GLOBAL_STICKER_PACK_NOT_DRAFT") {
        const [current] = await db.select({ revision: globalStickerPacks.revision }).from(globalStickerPacks).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth))).limit(1);
        return current ? reply.code(409).send({ error: "STICKER_PACK_NOT_DRAFT", revision: current.revision }) : reply.code(404).send({ error: "GLOBAL_STICKER_PACK_NOT_FOUND" });
      }
      if (error instanceof Error && error.message === "DUPLICATE_STICKER_MEDIA") return reply.code(409).send({ error: "STICKER_ALREADY_IN_PACK" });
      if (error instanceof Error && error.message === "INVALID_STICKER_MEDIA") return reply.code(400).send({ error: error.message });
      const publicError = publicUploadError(error);
      if (publicError !== "UPLOAD_FAILED") return reply.code(400).send({ error: publicError });
      throw error;
    }
  });
  app.post("/api/gm/global-sticker-packs/:id/publish", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(request.body);
    const [pack] = await db.select().from(globalStickerPacks).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth), eq(globalStickerPacks.lifecycle, "DRAFT"))).limit(1);
    if (!pack) {
      const [active] = await db.select().from(globalStickerPacks).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth), eq(globalStickerPacks.lifecycle, "ACTIVE"))).limit(1);
      return active ?? reply.code(404).send({ error: "GLOBAL_STICKER_PACK_NOT_FOUND" });
    }
    if (pack.revision !== revision) return reply.code(409).send({ error: "STICKER_PACK_CONFLICT", revision: pack.revision });
    const [item] = await db.select({ id: globalStickers.id }).from(globalStickers).where(eq(globalStickers.packId, id)).limit(1);
    if (!item) return reply.code(409).send({ error: "STICKER_PACK_EMPTY" });
    const [updated] = await db.update(globalStickerPacks).set({ lifecycle: "ACTIVE", revision: pack.revision + 1, updatedAt: new Date() }).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth), eq(globalStickerPacks.revision, pack.revision))).returning();
    return updated ?? reply.code(409).send({ error: "STICKER_PACK_CONFLICT" });
  });
  app.post("/api/gm/global-sticker-packs/:id/deprecate", async (request, reply) => {
    const auth = await gm(request, reply); if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db.update(globalStickerPacks).set({ lifecycle: "DEPRECATED", deprecatedAt: new Date(), revision: sql`${globalStickerPacks.revision} + 1`, updatedAt: new Date() }).where(and(eq(globalStickerPacks.id, id), managerOwnershipFilter(auth), eq(globalStickerPacks.lifecycle, "ACTIVE"))).returning({ id: globalStickerPacks.id });
    if (!updated) return reply.code(404).send({ error: "GLOBAL_STICKER_PACK_NOT_FOUND" });
    return reply.code(204).send();
  });
  app.get("/api/global-stickers/:id/content", async (request, reply) => {
    const auth = await authenticate(request, reply, db); if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [row] = await db.select({ pack: globalStickerPacks, media: globalStickerMedia }).from(globalStickers).innerJoin(globalStickerPacks, eq(globalStickerPacks.id, globalStickers.packId)).innerJoin(globalStickerMedia, eq(globalStickerMedia.id, globalStickers.mediaId)).where(and(eq(globalStickers.id, id), inArray(globalStickerPacks.lifecycle, ["ACTIVE", "DEPRECATED"]))).limit(1);
    if (!row) return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    try {
      const file = await openStoredFile(row.media.storageKey, request.headers.range);
      reply.header("Content-Type", row.media.mimeType).header("Cache-Control", "private, no-store").header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) { reply.code(206); reply.header("Content-Range", `bytes ${file.start}-${file.end}/${file.size}`); }
      return reply.send(file.stream);
    } catch { return reply.code(404).send({ error: "STICKER_NOT_FOUND" }); }
  });
}
