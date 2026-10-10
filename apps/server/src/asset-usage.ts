import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { actionIdSchema, audioPurposeSchema } from "@arken/contracts";
import type {
  AssetUsageDto,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import {
  assets,
  campaignAudioTracks,
  campaignSounds,
  characters,
  characterMedia,
  gameEvents,
  scenes,
  tokenDefinitions,
  tokens,
  worldContent,
  worldContentActions,
  worldContentInstances,
  worldContentMedia,
  worldMaps,
} from "@arken/db";
import { z } from "zod";
import { requireAuth } from "./auth.js";
import { env } from "./env.js";
import { buildSnapshot } from "./snapshot.js";
import {
  assertStorageCapacity,
  removeStoredUpload,
  storeUpload,
} from "./storage.js";
import { publicUploadError } from "./telemetry.js";
import { postgresErrorCode } from "./database-errors.js";
import {
  assetContentVersion,
  assetDto,
  assetUsagePolicy,
  deleteUnusedAsset,
} from "./asset-lifecycle.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

function replacementReplay(
  event:
    { type: string; entityId: string | null; payload: unknown } | undefined,
  assetId: string,
  contentSha256: string,
) {
  if (!event) return "NONE" as const;
  if (
    event.type !== "asset.replaced" ||
    event.entityId !== assetId ||
    !event.payload ||
    typeof event.payload !== "object" ||
    !("contentSha256" in event.payload) ||
    event.payload.contentSha256 !== contentSha256
  )
    return "CONFLICT" as const;
  return "EXACT" as const;
}
/** Resolve only schema- or route-confirmed references to rows in assets. */
export async function resolveAssetUsages(
  db: Database,
  campaignId: string,
  assetId: string,
): Promise<AssetUsageDto[]> {
  const [
    sceneRows,
    definitionRows,
    tokenRows,
    characterResourceRows,
    characterRows,
    characterMediaRows,
    mapRows,
    audioRows,
    soundRows,
    worldContentCoverRows,
    worldContentMediaRows,
    worldContentInstanceRows,
    provenanceRows,
  ] = await Promise.all([
    db
      .select({ id: scenes.id, name: scenes.name })
      .from(scenes)
      .where(
        and(eq(scenes.campaignId, campaignId), eq(scenes.mapAssetId, assetId)),
      ),
    db
      .select({
        id: tokenDefinitions.id,
        name: tokenDefinitions.name,
        characterName: characters.name,
      })
      .from(tokenDefinitions)
      .leftJoin(characters, eq(tokenDefinitions.characterId, characters.id))
      .where(
        and(
          eq(tokenDefinitions.campaignId, campaignId),
          eq(tokenDefinitions.defaultAssetId, assetId),
        ),
      ),
    db
      .select({ id: tokens.id, name: tokens.name })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(scenes.campaignId, campaignId), eq(tokens.assetId, assetId))),
    db
      .select({
        id: characters.id,
        name: characters.name,
        ownerMembershipId: characters.ownerMembershipId,
      })
      .from(characters)
      .where(
        and(
          eq(characters.campaignId, campaignId),
          sql`exists (
            select 1
            from jsonb_each(${characters.resources}) as resource
            where resource.value->>'imageAssetId' = ${assetId}
          )`,
        ),
      ),
    db
      .select({
        id: characters.id,
        name: characters.name,
        ownerMembershipId: characters.ownerMembershipId,
      })
      .from(characters)
      .where(
        and(
          eq(characters.campaignId, campaignId),
          eq(characters.portraitAssetId, assetId),
        ),
      ),
    db
      .select({
        id: characterMedia.id,
        label: characterMedia.caption,
        characterName: characters.name,
      })
      .from(characterMedia)
      .innerJoin(characters, eq(characterMedia.characterId, characters.id))
      .where(
        and(
          eq(characterMedia.campaignId, campaignId),
          eq(characterMedia.assetId, assetId),
          isNull(characterMedia.detachedAt),
        ),
      ),
    db
      .select({
        id: worldMaps.id,
        name: worldMaps.name,
        lifecycle: worldMaps.lifecycle,
        visibility: worldMaps.visibility,
      })
      .from(worldMaps)
      .where(
        and(
          eq(worldMaps.campaignId, campaignId),
          eq(worldMaps.backgroundAssetId, assetId),
        ),
      ),
    db
      .select({
        id: campaignAudioTracks.id,
        slotOrder: campaignAudioTracks.slotOrder,
      })
      .from(campaignAudioTracks)
      .where(
        and(
          eq(campaignAudioTracks.campaignId, campaignId),
          eq(campaignAudioTracks.assetId, assetId),
        ),
      ),
    db
      .select({ id: campaignSounds.id, label: campaignSounds.label })
      .from(campaignSounds)
      .where(and(eq(campaignSounds.campaignId, campaignId), eq(campaignSounds.assetId, assetId))),
    db
      .select({ id: worldContent.id, name: worldContent.name })
      .from(worldContent)
      .where(eq(worldContent.coverAssetId, assetId)),
    db
      .select({
        id: worldContentMedia.id,
        label: worldContentMedia.caption,
        worldContentName: worldContent.name,
      })
      .from(worldContentMedia)
      .innerJoin(
        worldContent,
        eq(worldContentMedia.worldContentId, worldContent.id),
      )
      .where(eq(worldContentMedia.assetId, assetId)),
    db
      .select({ id: worldContentInstances.id, name: worldContentInstances.displayNameOverride })
      .from(worldContentInstances)
      .where(and(
        eq(worldContentInstances.campaignId, campaignId),
        eq(worldContentInstances.portraitAssetId, assetId),
      )),
    db
      .select({ sequence: gameEvents.sequence })
      .from(gameEvents)
      .where(
        and(
          eq(gameEvents.campaignId, campaignId),
          eq(gameEvents.type, "asset.created"),
          sql`${gameEvents.payload}->>'sourceAssetId' = ${assetId}`,
        ),
      ),
  ]);

  return [
    ...sceneRows.map((row) => ({
      kind: "SCENE_BACKGROUND" as const,
      entityId: row.id,
      label: row.name,
      location: "Сцена",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...definitionRows.map((row) => ({
      kind: "TOKEN_DEFINITION" as const,
      entityId: row.id,
      label: row.name ?? row.characterName ?? "Токен",
      location: "Каталог токенов",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...tokenRows.map((row) => ({
      kind: "TOKEN_INSTANCE" as const,
      entityId: row.id,
      label: row.name,
      location: "Токен на сцене",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...characterRows.map((row) => ({
      kind: "CHARACTER_PORTRAIT" as const,
      entityId: row.id,
      label: row.name,
      location: "Персонаж",
      visibility: row.ownerMembershipId
        ? ("PARTICIPANT" as const)
        : ("GM_ONLY" as const),
      deletionPolicy: "DETACH" as const,
    })),
    ...characterResourceRows.map((row) => ({
      kind: "CHARACTER_RESOURCE" as const,
      entityId: row.id,
      label: row.name,
      location: "Ресурс персонажа",
      visibility: row.ownerMembershipId
        ? ("PARTICIPANT" as const)
        : ("GM_ONLY" as const),
      deletionPolicy: "DETACH" as const,
    })),
    ...characterMediaRows.map((row) => ({
      kind: "CHARACTER_MEDIA" as const,
      entityId: row.id,
      label: row.label ?? row.characterName,
      location: "Галерея персонажа",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...mapRows.map((row) => ({
      kind: "WORLD_MAP_BACKGROUND" as const,
      entityId: row.id,
      label: row.name,
      location: "Карта мира",
      visibility:
        row.lifecycle === "PUBLISHED" && row.visibility === "CAMPAIGN"
          ? ("PUBLIC" as const)
          : ("GM_ONLY" as const),
      deletionPolicy: "DETACH" as const,
    })),
    ...audioRows.map((row) => ({
      kind: "AUDIO_TRACK" as const,
      entityId: row.id,
      label: `Аудиодорожка ${row.slotOrder + 1}`,
      location: "Музыка",
      visibility: "PUBLIC" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...soundRows.map((row) => ({
      kind: "CAMPAIGN_SOUND" as const,
      entityId: row.id,
      label: row.label,
      location: "Саундпад кампании",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...worldContentCoverRows.map((row) => ({
      kind: "WORLD_CONTENT_COVER" as const,
      entityId: row.id,
      label: row.name,
      location: "Обложка материала мира",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...worldContentMediaRows.map((row) => ({
      kind: "WORLD_CONTENT_MEDIA" as const,
      entityId: row.id,
      label: row.label ?? row.worldContentName,
      location: "Файлы материала мира",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...worldContentInstanceRows.map((row) => ({
      kind: "WORLD_CONTENT_INSTANCE_PORTRAIT" as const,
      entityId: row.id,
      label: row.name ?? "Экземпляр материала мира",
      location: "Портрет экземпляра материала мира",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "DETACH" as const,
    })),
    ...provenanceRows.map((row) => ({
      kind: "GENERATED_TOKEN_SOURCE" as const,
      entityId: String(row.sequence),
      label: "Источник созданного токена",
      location: "История изменений",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "RETAIN_HISTORY" as const,
    })),
  ];
}

export function registerAssetLifecycleRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
  broadcastSnapshots: (
    io: RealtimeServer,
    db: Database,
    campaignId: string,
  ) => Promise<void>,
) {
  app.patch("/api/assets/:id/audio-purpose", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ actionId: actionIdSchema, audioPurpose: audioPurposeSchema }).parse(request.body);
    const result = await db.transaction(async (tx) => {
      const [asset] = await tx.select().from(assets)
        .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
        .for("update").limit(1);
      if (!asset) return { kind: "missing" as const };
      if (asset.kind !== "AUDIO") return { kind: "not_audio" as const };

      const [priorAction] = await tx.select().from(gameEvents)
        .where(and(eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, body.actionId)))
        .limit(1);
      if (priorAction) {
        const payload = priorAction.payload as { audioPurpose?: string; assetId?: string } | null;
        if (priorAction.type === "asset.audio_purpose_changed" && priorAction.entityId === id && payload?.assetId === id && payload.audioPurpose === body.audioPurpose)
          return { kind: "updated" as const, asset };
        return { kind: "action_conflict" as const };
      }

      const [trackUse] = await tx.select({ id: campaignAudioTracks.id }).from(campaignAudioTracks)
        .where(and(eq(campaignAudioTracks.campaignId, auth.campaignId), eq(campaignAudioTracks.assetId, id))).limit(1);
      const [soundUse] = await tx.select({ id: campaignSounds.id }).from(campaignSounds)
        .where(and(eq(campaignSounds.campaignId, auth.campaignId), eq(campaignSounds.assetId, id))).limit(1);
      if ((body.audioPurpose === "MUSIC" && soundUse) || (body.audioPurpose === "SOUND_EFFECT" && trackUse))
        return { kind: "in_use" as const };

      const [updated] = await tx.update(assets).set({ audioPurpose: body.audioPurpose })
        .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId))).returning();
      if (!updated) return { kind: "missing" as const };
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "asset.audio_purpose_changed",
        entityType: "asset",
        entityId: id,
        payload: { assetId: id, audioPurpose: body.audioPurpose },
      });
      return { kind: "updated" as const, asset: updated };
    }).catch((error: unknown) => {
      if (postgresErrorCode(error) === "23505")
        return { kind: "action_conflict" as const };
      throw error;
    });

    if (result.kind === "missing") return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (result.kind === "not_audio") return reply.code(400).send({ error: "AUDIO_ASSET_REQUIRED" });
    if (result.kind === "in_use") return reply.code(409).send({ error: "AUDIO_PURPOSE_IN_USE" });
    if (result.kind === "action_conflict") return reply.code(409).send({ error: "ACTION_ID_CONFLICT" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.send(assetDto(result.asset));
  });

  app.get("/api/assets/:id/usage", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
      .limit(1);
    if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    if (auth.role !== "GM") {
      const snapshot = await buildSnapshot(db, auth);
      if (!snapshot.assets.some((visible) => visible.id === asset.id))
        return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    const usages = await resolveAssetUsages(db, auth.campaignId, id);
    return reply.send(assetUsagePolicy(asset, usages, auth));
  });

  app.delete("/api/assets/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    let storageKey = "";
    try {
      const result = await db.transaction(async (tx) => {
        const [asset] = await tx
          .select()
          .from(assets)
          .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
          .for("update")
          .limit(1);
        if (!asset) return null;
        const usages = await resolveAssetUsages(
          tx as unknown as Database,
          auth.campaignId,
          id,
        );
        // Detach every live reference in the same transaction as metadata
        // deletion. Keep owning records (characters, maps and global world
        // content) intact; gallery/audio/pack rows are association records.
        await tx.update(scenes).set({ mapAssetId: null, revision: sql`${scenes.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(scenes.campaignId, auth.campaignId), eq(scenes.mapAssetId, id)));
        await tx.update(tokenDefinitions).set({ defaultAssetId: null, revision: sql`${tokenDefinitions.revision} + 1` })
          .where(and(eq(tokenDefinitions.campaignId, auth.campaignId), eq(tokenDefinitions.defaultAssetId, id)));
        await tx.update(tokens).set({ assetId: null, revision: sql`${tokens.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(tokens.assetId, id), sql`EXISTS (SELECT 1 FROM ${scenes} WHERE ${scenes.id} = ${tokens.sceneId} AND ${scenes.campaignId} = ${auth.campaignId})`));
        await tx.update(characters).set({ portraitAssetId: null, revision: sql`${characters.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(characters.campaignId, auth.campaignId), eq(characters.portraitAssetId, id)));
        await tx.update(characters).set({
          resources: sql`(SELECT coalesce(jsonb_object_agg(key, CASE WHEN value->>'imageAssetId' = ${id} THEN value - 'imageAssetId' ELSE value END), '{}'::jsonb) FROM jsonb_each(${characters.resources}))`,
          revision: sql`${characters.revision} + 1`,
          updatedAt: new Date(),
        }).where(and(
          eq(characters.campaignId, auth.campaignId),
          sql`EXISTS (SELECT 1 FROM jsonb_each(${characters.resources}) AS resource WHERE resource.value->>'imageAssetId' = ${id})`,
        ));
        await tx.update(worldMaps).set({
          backgroundAssetId: null,
          backgroundAssetApprovedByMembershipId: null,
          backgroundAssetApprovedAt: null,
          lifecycle: sql`CASE WHEN ${worldMaps.lifecycle} = 'PUBLISHED' THEN 'DRAFT'::world_map_lifecycle ELSE ${worldMaps.lifecycle} END`,
          publishedAt: sql`CASE WHEN ${worldMaps.lifecycle} = 'PUBLISHED' THEN NULL ELSE ${worldMaps.publishedAt} END`,
          revision: sql`${worldMaps.revision} + 1`,
          updatedAt: new Date(),
        }).where(and(
          eq(worldMaps.campaignId, auth.campaignId),
          eq(worldMaps.backgroundAssetId, id),
          inArray(worldMaps.lifecycle, ["PUBLISHED", "DRAFT", "ARCHIVED"]),
        ));
        await tx.update(campaignAudioTracks).set({
          assetId: null,
          playing: false,
          positionSeconds: 0,
          startedAt: null,
          revision: sql`${campaignAudioTracks.revision} + 1`,
          updatedAt: new Date(),
        }).where(and(eq(campaignAudioTracks.campaignId, auth.campaignId), eq(campaignAudioTracks.assetId, id)));
        await tx.delete(campaignSounds).where(and(
          eq(campaignSounds.campaignId, auth.campaignId),
          eq(campaignSounds.assetId, id),
        ));
        await tx.delete(characterMedia).where(and(
          eq(characterMedia.campaignId, auth.campaignId),
          eq(characterMedia.assetId, id),
        ));
        await tx.update(worldContentInstances).set({
          portraitAssetId: null,
          revision: sql`${worldContentInstances.revision} + 1`,
          updatedAt: new Date(),
        }).where(and(eq(worldContentInstances.campaignId, auth.campaignId), eq(worldContentInstances.portraitAssetId, id)));
        const detachedWorldMedia = await tx.delete(worldContentMedia)
          .where(eq(worldContentMedia.assetId, id))
          .returning({ worldContentId: worldContentMedia.worldContentId });
        const detachedWorldCovers = await tx.update(worldContent).set({
          coverAssetId: null,
        }).where(eq(worldContent.coverAssetId, id)).returning({ id: worldContent.id });
        const affectedWorldContentIds = new Set([
          ...detachedWorldMedia.map((row) => row.worldContentId),
          ...detachedWorldCovers.map((row) => row.id),
        ]);
        if (affectedWorldContentIds.size > 0)
          await tx.update(worldContent).set({
            revision: sql`${worldContent.revision} + 1`,
            updatedAt: new Date(),
          }).where(inArray(worldContent.id, [...affectedWorldContentIds]));
        for (const worldContentId of affectedWorldContentIds) {
          await tx.insert(worldContentActions).values({
            actionId: randomUUID(),
            type: "world_content.asset_detached",
            entityType: "world_content",
            entityId: worldContentId,
            actorMembershipId: auth.membershipId,
            payload: { assetId: id },
          });
        }
        const remainingUsages = await resolveAssetUsages(
          tx as unknown as Database,
          auth.campaignId,
          id,
        );
        storageKey = asset.storageKey;
        return deleteUnusedAsset(id, remainingUsages, {
          deleteMetadata: async () => {
            await tx
              .delete(assets)
              .where(
                and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)),
              );
            await tx.insert(gameEvents).values({
              campaignId: auth.campaignId,
              actionId: randomUUID(),
              membershipId: auth.membershipId,
              type: "asset.deleted",
              entityType: "asset",
              entityId: id,
              payload: {
                assetId: id,
                detachedUsageCount: usages.filter((usage) => usage.deletionPolicy === "DETACH").length,
                detachedWorldContentCount: affectedWorldContentIds.size,
              },
            });
          },
          removeBlob: async () => undefined,
        });
      });
      if (!result) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      let blobCleanupPending = false;
      try {
        await removeStoredUpload(storageKey);
      } catch {
        blobCleanupPending = true;
        request.log.error(
          { assetId: id, errorCode: "ASSET_BLOB_CLEANUP_FAILED" },
          "asset.delete_cleanup_pending",
        );
      }
      await broadcastSnapshots(io, db, auth.campaignId);
      request.log.info({ assetId: id, blobCleanupPending }, "asset.deleted");
      return reply.send({ ...result, blobCleanupPending });
    } catch (error) {
      if (error instanceof Error && error.message === "ASSET_IN_USE") {
        const usages = await resolveAssetUsages(db, auth.campaignId, id);
        return reply.code(409).send({
          error: "ASSET_IN_USE",
          usageCount: usages.length,
          usages,
        });
      }
      throw error;
    }
  });

  app.put("/api/assets/:id/content", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const expectedVersion = z
      .string()
      .min(3)
      .parse(request.headers["if-match"]);
    const [current] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
      .limit(1);
    if (!current) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });

    const file = await request.file({
      limits: {
        fileSize:
          current.kind === "AUDIO" ? env.MAX_AUDIO_BYTES : env.MAX_IMAGE_BYTES,
        files: 1,
      },
    });
    if (!file) return reply.code(400).send({ error: "FILE_REQUIRED" });
    const buffer = await file.toBuffer();
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    const [existingAction] = await db
      .select({
        type: gameEvents.type,
        entityId: gameEvents.entityId,
        payload: gameEvents.payload,
      })
      .from(gameEvents)
      .where(
        and(
          eq(gameEvents.campaignId, auth.campaignId),
          eq(gameEvents.actionId, actionId),
        ),
      )
      .limit(1);
    const replay = replacementReplay(existingAction, id, contentSha256);
    if (replay === "CONFLICT")
      return reply.code(409).send({ error: "ACTION_ID_REUSED" });
    if (replay === "EXACT")
      return reply.send({
        asset: assetDto(current),
        version: assetContentVersion(current.storageKey),
        replayed: true,
      });

    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    let committed = false;
    try {
      const [usage] = await db
        .select({ used: sum(assets.sizeBytes) })
        .from(assets)
        .where(eq(assets.campaignId, auth.campaignId));
      await assertStorageCapacity(
        Math.max(0, Number(usage?.used ?? 0) - current.sizeBytes),
        buffer.length,
      );
      stored = await storeUpload(
        buffer,
        current.kind === "AUDIO" ? "audio" : "image",
      );
      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(assets)
          .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
          .for("update")
          .limit(1);
        if (!locked) return null;
        const beforeVersion = assetContentVersion(locked.storageKey);
        if (beforeVersion !== expectedVersion)
          throw new Error("ASSET_VERSION_CONFLICT");
        const [updated] = await tx
          .update(assets)
          .set({
            storageKey: stored!.storageKey,
            mimeType: stored!.mimeType,
            sizeBytes: stored!.sizeBytes,
            width: stored!.width,
            height: stored!.height,
            durationSeconds: stored!.durationSeconds,
          })
          .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
          .returning();
        if (!updated) throw new Error("ASSET_REPLACE_FAILED");
        const afterVersion = assetContentVersion(updated.storageKey);
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "asset.replaced",
          entityType: "asset",
          entityId: id,
          payload: {
            assetId: id,
            beforeVersion,
            afterVersion,
            contentSha256,
            mimeType: updated.mimeType,
            sizeBytes: updated.sizeBytes,
            width: updated.width,
            height: updated.height,
            durationSeconds: updated.durationSeconds,
          },
        });
        return { updated, oldStorageKey: locked.storageKey, afterVersion };
      });
      if (!result) {
        await removeStoredUpload(stored.storageKey);
        return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      }
      committed = true;
      let oldBlobCleanupPending = false;
      try {
        await removeStoredUpload(result.oldStorageKey);
      } catch {
        oldBlobCleanupPending = true;
        request.log.error(
          { assetId: id, errorCode: "ASSET_OLD_BLOB_CLEANUP_FAILED" },
          "asset.replace_cleanup_pending",
        );
      }
      try {
        await broadcastSnapshots(io, db, auth.campaignId);
      } catch (error) {
        request.log.error(
          { assetId: id, error },
          "asset.replace_broadcast_failed",
        );
      }
      return reply.send({
        asset: assetDto(result.updated),
        version: result.afterVersion,
        oldBlobCleanupPending,
        replayed: false,
      });
    } catch (error) {
      if (!committed && stored) await removeStoredUpload(stored.storageKey);
      if (
        error instanceof Error &&
        error.message === "ASSET_VERSION_CONFLICT"
      ) {
        const [latest] = await db
          .select({ storageKey: assets.storageKey })
          .from(assets)
          .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
          .limit(1);
        return reply.code(409).send({
          error: "ASSET_VERSION_CONFLICT",
          currentVersion: latest
            ? assetContentVersion(latest.storageKey)
            : undefined,
        });
      }
      const concurrentAction = await db
        .select({
          type: gameEvents.type,
          entityId: gameEvents.entityId,
          payload: gameEvents.payload,
        })
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.actionId, actionId),
          ),
        )
        .limit(1);
      const concurrentReplay = replacementReplay(
        concurrentAction[0],
        id,
        contentSha256,
      );
      if (concurrentReplay === "EXACT") {
        const [latest] = await db
          .select()
          .from(assets)
          .where(and(eq(assets.id, id), eq(assets.campaignId, auth.campaignId)))
          .limit(1);
        if (latest)
          return reply.send({
            asset: assetDto(latest),
            version: assetContentVersion(latest.storageKey),
            replayed: true,
          });
      }
      if (concurrentReplay === "CONFLICT")
        return reply.code(409).send({ error: "ACTION_ID_REUSED" });
      const errorCode = publicUploadError(error);
      if (errorCode !== "UPLOAD_FAILED")
        return reply.code(400).send({ error: errorCode });
      throw error;
    }
  });
}
