import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  stickerPackAudienceSchema,
  stickerPackSendPolicySchema,
  stickerPackSubjectSchema,
  stickerProvenanceTypeSchema,
} from "@arken/contracts";
import {
  assets,
  characters,
  chatMessages,
  globalStickerPacks,
  globalStickers,
  globalStickerMedia,
  chatThreads,
  chatAttachmentUploads,
  stickerMedia,
  stickerPackEntitlements,
  stickerPacks,
  stickers,
  playerLikenessConsents,
  feedbackAttachments,
  memberships,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { env } from "./env.js";
import { chatVisibilityFilter } from "./chat.js";
import {
  canMemberSendPack,
  canMembersViewPack,
  resolveSticker,
  invalidateStickerConsentClients,
  stickerAssetUrl,
} from "./sticker-access.js";
import { publicUploadError } from "./telemetry.js";
import {
  assertStorageCapacity,
  openStoredFile,
  removeStoredUpload,
  storeUpload,
} from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * Campaign sticker packs: authoring, publishing, entitlements, likeness
 * consent and the sticker catalog/content reads. Moved out of routes.ts
 * unchanged (legacy cleanup after the 15.10 audit).
 */
export function registerStickerRoutes(
  app: FastifyInstance,
  db: Database,
  { broadcast }: { broadcast: (campaignId: string) => Promise<void> },
) {
  const stickerPackInputSchema = z
    .object({
      name: z.string().trim().min(1).max(120),
      subject: stickerPackSubjectSchema,
      subjectCharacterId: z.string().uuid().nullable().optional(),
      subjectMembershipId: z.string().uuid().nullable().optional(),
      subjectLabel: z.string().trim().min(1).max(80).nullable().optional(),
      audience: stickerPackAudienceSchema.default("CAMPAIGN"),
      sendPolicy: stickerPackSendPolicySchema.default("ALL_MEMBERS"),
    })
    .strict();
  const stickerMetadataSchema = z
    .object({
      name: z.string().trim().min(1).max(80),
      altText: z.string().trim().min(1).max(240),
      provenanceType: stickerProvenanceTypeSchema,
      sourceReference: z.string().trim().min(1).max(1000).optional(),
      authorCredit: z.string().trim().min(1).max(200).optional(),
      licenseNote: z.string().trim().min(1).max(1000).optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.provenanceType === "IMPORTED" &&
        (!value.sourceReference || !value.authorCredit || !value.licenseNote)
      )
        context.addIssue({
          code: "custom",
          message: "Imported stickers require provenance",
        });
    });
  const requireGm = async (
    request: Parameters<typeof requireAuth>[0],
    reply: Parameters<typeof requireAuth>[1],
  ) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth || auth.role !== "GM") {
      if (auth) reply.code(403).send({ error: "GM_REQUIRED" });
      return null;
    }
    return auth;
  };

  app.post("/api/sticker-packs", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const body = stickerPackInputSchema.parse(request.body);
    const shapeValid =
      body.subject === "CHARACTER"
        ? !!body.subjectCharacterId &&
          !body.subjectMembershipId &&
          !body.subjectLabel
        : body.subject === "PLAYER"
          ? !!body.subjectMembershipId &&
            !body.subjectCharacterId &&
            !body.subjectLabel
          : !!body.subjectLabel &&
            !body.subjectCharacterId &&
            !body.subjectMembershipId;
    if (!shapeValid)
      return reply.code(422).send({ error: "INVALID_STICKER_PACK_SUBJECT" });
    if (body.subjectMembershipId) {
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.id, body.subjectMembershipId),
          ),
        )
        .limit(1);
      if (!member)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    }
    if (body.subjectCharacterId) {
      const [character] = await db
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.campaignId, auth.campaignId),
            eq(characters.id, body.subjectCharacterId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    }
    const [created] = await db
      .insert(stickerPacks)
      .values({ campaignId: auth.campaignId, ...body })
      .returning();
    return reply.code(201).send(created);
  });

  app.patch("/api/sticker-packs/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        revision: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(120).optional(),
        audience: stickerPackAudienceSchema.optional(),
        sendPolicy: stickerPackSendPolicySchema.optional(),
      })
      .strict()
      .refine(
        (value) =>
          value.name !== undefined ||
          value.audience !== undefined ||
          value.sendPolicy !== undefined,
      )
      .parse(request.body);
    const [updated] = await db
      .update(stickerPacks)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.audience !== undefined ? { audience: body.audience } : {}),
        ...(body.sendPolicy !== undefined
          ? { sendPolicy: body.sendPolicy }
          : {}),
        revision: body.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
          eq(stickerPacks.revision, body.revision),
        ),
      )
      .returning();
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return updated;
  });

  app.delete("/api/sticker-packs/:id", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(stickerPacks)
      .set({ lifecycle: "ARCHIVED", deprecatedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          inArray(stickerPacks.lifecycle, ["DRAFT", "DEPRECATED"]),
        ),
      )
      .returning({ id: stickerPacks.id });
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return reply.code(204).send();
  });

  app.post("/api/sticker-packs/:id/stickers", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const metadata = stickerMetadataSchema.parse(request.query);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    const file = await request.file({
      limits: { files: 1, fileSize: 5 * 1024 * 1024 },
    });
    if (!file) return reply.code(400).send({ error: "UPLOAD_REQUIRED" });
    const buffer = await file.toBuffer();
    const [assetUsage, feedbackUsage, chatUsage, stickerUsage] =
      await Promise.all([
        db.select({ used: sum(assets.sizeBytes) }).from(assets),
        db
          .select({ used: sum(feedbackAttachments.sizeBytes) })
          .from(feedbackAttachments),
        db
          .select({ used: sum(chatAttachmentUploads.sizeBytes) })
          .from(chatAttachmentUploads),
        db.select({ used: sum(stickerMedia.sizeBytes) }).from(stickerMedia),
      ]);
    await assertStorageCapacity(
      Number(assetUsage[0]?.used ?? 0) +
        Number(feedbackUsage[0]?.used ?? 0) +
        Number(chatUsage[0]?.used ?? 0) +
        Number(stickerUsage[0]?.used ?? 0),
      buffer.length,
    );
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      stored = await storeUpload(buffer, "image");
      if (
        stored.mimeType !== "image/webp" ||
        !stored.width ||
        !stored.height ||
        stored.width > 4096 ||
        stored.height > 4096
      )
        throw new Error("INVALID_STICKER_MEDIA");
      const result = await db.transaction(async (tx) => {
        const [media] = await tx
          .insert(stickerMedia)
          .values({
            campaignId: auth.campaignId,
            uploadedByMembershipId: auth.membershipId,
            storageKey: stored!.storageKey,
            mimeType: stored!.mimeType,
            sizeBytes: stored!.sizeBytes,
            width: stored!.width!,
            height: stored!.height!,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          })
          .returning();
        const [sticker] = await tx
          .insert(stickers)
          .values({
            campaignId: auth.campaignId,
            packId: pack.id,
            mediaId: media!.id,
            ...metadata,
          })
          .returning();
        return sticker!;
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (stored) await removeStoredUpload(stored.storageKey);
      return reply.code(400).send({ error: publicUploadError(error) });
    }
  });

  app.post("/api/sticker-packs/:id/publish", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "DRAFT"),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    if (pack.subject === "PLAYER") {
      const [consent] = await db
        .select()
        .from(playerLikenessConsents)
        .where(
          and(
            eq(playerLikenessConsents.campaignId, auth.campaignId),
            eq(playerLikenessConsents.packId, id),
            eq(playerLikenessConsents.membershipId, pack.subjectMembershipId!),
            eq(playerLikenessConsents.status, "GRANTED"),
          ),
        )
        .limit(1);
      if (!consent)
        return reply.code(409).send({ error: "LIKENESS_CONSENT_REQUIRED" });
    }
    const [item] = await db
      .select({ id: stickers.id })
      .from(stickers)
      .where(
        and(eq(stickers.campaignId, auth.campaignId), eq(stickers.packId, id)),
      )
      .limit(1);
    if (!item) return reply.code(409).send({ error: "STICKER_PACK_EMPTY" });
    const [updated] = await db
      .update(stickerPacks)
      .set({
        lifecycle: "ACTIVE",
        revision: pack.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(eq(stickerPacks.id, id), eq(stickerPacks.revision, pack.revision)),
      )
      .returning();
    return updated ?? reply.code(409).send({ error: "STICKER_PACK_CONFLICT" });
  });

  app.post("/api/sticker-packs/:id/deprecate", async (request, reply) => {
    const auth = await requireGm(request, reply);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [updated] = await db
      .update(stickerPacks)
      .set({
        lifecycle: "DEPRECATED",
        deprecatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.lifecycle, "ACTIVE"),
        ),
      )
      .returning();
    if (!updated)
      return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    return updated;
  });

  app.put(
    "/api/sticker-packs/:id/entitlements/:membershipId",
    async (request, reply) => {
      const auth = await requireGm(request, reply);
      if (!auth) return;
      const params = z
        .object({ id: z.string().uuid(), membershipId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({ granted: z.boolean() })
        .strict()
        .parse(request.body);
      const [pack] = await db
        .select({ id: stickerPacks.id })
        .from(stickerPacks)
        .where(
          and(
            eq(stickerPacks.campaignId, auth.campaignId),
            eq(stickerPacks.id, params.id),
          ),
        )
        .limit(1);
      const [member] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.id, params.membershipId),
          ),
        )
        .limit(1);
      if (!pack || !member)
        return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
      if (body.granted)
        await db
          .insert(stickerPackEntitlements)
          .values({
            campaignId: auth.campaignId,
            packId: params.id,
            membershipId: params.membershipId,
          })
          .onConflictDoNothing();
      else
        await db
          .delete(stickerPackEntitlements)
          .where(
            and(
              eq(stickerPackEntitlements.campaignId, auth.campaignId),
              eq(stickerPackEntitlements.packId, params.id),
              eq(stickerPackEntitlements.membershipId, params.membershipId),
            ),
          );
      return reply.code(204).send();
    },
  );

  app.put("/api/sticker-packs/:id/consent", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { granted } = z
      .object({ granted: z.boolean() })
      .strict()
      .parse(request.body);
    const [pack] = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.id, id),
          eq(stickerPacks.subject, "PLAYER"),
          eq(stickerPacks.subjectMembershipId, auth.membershipId),
        ),
      )
      .limit(1);
    if (!pack) return reply.code(404).send({ error: "STICKER_PACK_NOT_FOUND" });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .insert(playerLikenessConsents)
        .values({
          campaignId: auth.campaignId,
          packId: id,
          membershipId: auth.membershipId,
          status: granted ? "GRANTED" : "REVOKED",
          grantedAt: now,
          revokedAt: granted ? null : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            playerLikenessConsents.packId,
            playerLikenessConsents.membershipId,
          ],
          set: {
            status: granted ? "GRANTED" : "REVOKED",
            grantedAt: granted
              ? now
              : sql`coalesce(${playerLikenessConsents.grantedAt}, ${now})`,
            revokedAt: granted ? null : now,
            updatedAt: now,
          },
        });
      if (!granted)
        await tx
          .update(stickerPacks)
          .set({
            lifecycle: "DEPRECATED",
            deprecatedAt: now,
            revision: pack.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(stickerPacks.id, id),
              eq(stickerPacks.campaignId, auth.campaignId),
            ),
          );
    });
    await invalidateStickerConsentClients(broadcast, auth.campaignId);
    return reply.code(204).send();
  });

  app.get("/api/stickers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const packs = await db
      .select()
      .from(stickerPacks)
      .where(
        and(
          eq(stickerPacks.campaignId, auth.campaignId),
          eq(stickerPacks.lifecycle, "ACTIVE"),
        ),
      );
    const result = [];
    for (const pack of packs) {
      if (
        !(await canMembersViewPack(db, auth.campaignId, pack, [
          auth.membershipId,
        ]))
      )
        continue;
      const items = await db
        .select({ sticker: stickers, media: stickerMedia })
        .from(stickers)
        .innerJoin(
          stickerMedia,
          and(
            eq(stickerMedia.id, stickers.mediaId),
            eq(stickerMedia.campaignId, stickers.campaignId),
          ),
        )
        .where(
          and(
            eq(stickers.campaignId, auth.campaignId),
            eq(stickers.packId, pack.id),
          ),
        );
      result.push({
        id: pack.id,
        name: pack.name,
        subject: pack.subject,
        subjectCharacterId: pack.subjectCharacterId,
        subjectMembershipId: pack.subjectMembershipId,
        subjectLabel: pack.subjectLabel,
        lifecycle: pack.lifecycle,
        canSend: await canMemberSendPack(db, auth, pack),
        stickers: items.map(({ sticker, media }) => ({
          id: sticker.id,
          packId: sticker.packId,
          name: sticker.name,
          altText: sticker.altText,
          url: stickerAssetUrl(sticker.id),
          width: media.width,
          height: media.height,
          attribution: {
            authorCredit: sticker.authorCredit,
            licenseNote: sticker.licenseNote,
          },
        })),
      });
    }
    const globalPacks = env.GLOBAL_STICKERS_ENABLED
      ? await db
          .select()
          .from(globalStickerPacks)
          .where(eq(globalStickerPacks.lifecycle, "ACTIVE"))
      : [];
    for (const pack of globalPacks) {
      const items = await db
        .select({ sticker: globalStickers, media: globalStickerMedia })
        .from(globalStickers)
        .innerJoin(
          globalStickerMedia,
          eq(globalStickerMedia.id, globalStickers.mediaId),
        )
        .where(eq(globalStickers.packId, pack.id));
      result.push({
        id: pack.id,
        scope: "GLOBAL_PUBLIC" as const,
        name: pack.name,
        subject: "COMMON" as const,
        subjectCharacterId: null,
        subjectMembershipId: null,
        subjectLabel: null,
        lifecycle: pack.lifecycle,
        canSend: true,
        stickers: items.map(({ sticker, media }) => ({
          id: sticker.id,
          packId: sticker.packId,
          name: sticker.name,
          altText: sticker.altText,
          url: `/api/global-stickers/${sticker.id}/content`,
          width: media.width,
          height: media.height,
          attribution: {
            authorCredit: sticker.authorCredit,
            licenseNote: sticker.licenseNote,
          },
        })),
      });
    }
    reply.header("Cache-Control", "private, no-store");
    return result;
  });

  app.get("/api/stickers/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const row = await resolveSticker(db, auth, id);
    if (!row || !["ACTIVE", "DEPRECATED"].includes(row.pack.lifecycle))
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const [revokedConsent] =
      row.pack.subject === "PLAYER"
        ? await db
            .select({ status: playerLikenessConsents.status })
            .from(playerLikenessConsents)
            .where(
              and(
                eq(playerLikenessConsents.campaignId, auth.campaignId),
                eq(playerLikenessConsents.packId, row.pack.id),
                eq(playerLikenessConsents.status, "REVOKED"),
              ),
            )
            .limit(1)
        : [];
    if (revokedConsent)
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    const currentlyVisible = await canMembersViewPack(
      db,
      auth.campaignId,
      row.pack,
      [auth.membershipId],
    );
    const [historicalMessage] = currentlyVisible
      ? []
      : await db
          .select({
            id: chatMessages.id,
            viewers: chatMessages.stickerViewerMembershipIds,
          })
          .from(chatMessages)
          .innerJoin(
            chatThreads,
            and(
              eq(chatThreads.id, chatMessages.threadId),
              eq(chatThreads.campaignId, chatMessages.campaignId),
            ),
          )
          .where(
            and(
              eq(chatMessages.campaignId, auth.campaignId),
              eq(chatMessages.stickerId, row.sticker.id),
              chatVisibilityFilter(auth),
              or(
                eq(chatThreads.type, "STREAM"),
                eq(chatThreads.participantAMembershipId, auth.membershipId),
                eq(chatThreads.participantBMembershipId, auth.membershipId),
              ),
            ),
          )
          .limit(1);
    const visibleHistoricalMessage =
      historicalMessage &&
      (!historicalMessage.viewers ||
        historicalMessage.viewers.includes(auth.membershipId));
    if (!currentlyVisible && !visibleHistoricalMessage)
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    try {
      const file = await openStoredFile(
        row.media.storageKey,
        request.headers.range,
      );
      reply.header("Content-Type", row.media.mimeType);
      reply.header("Cache-Control", "private, no-store");
      reply.header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${file.start}-${file.end}/${file.size}`,
        );
      }
      return reply.send(file.stream);
    } catch {
      return reply.code(404).send({ error: "STICKER_NOT_FOUND" });
    }
  });
}
