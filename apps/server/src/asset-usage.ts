import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, eq, isNull, sql, sum } from "drizzle-orm";
import { actionIdSchema } from "@arken/contracts";
import type {
  AssetUsageDto,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import {
  assets,
  campaignAudioTracks,
  characters,
  characterMedia,
  gameEvents,
  scenes,
  tokenDefinitions,
  worldContent,
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
    characterRows,
    characterMediaRows,
    mapRows,
    audioRows,
    worldContentCoverRows,
    worldContentMediaRows,
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
      location: "Scene",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "BLOCK" as const,
    })),
    ...definitionRows.map((row) => ({
      kind: "TOKEN_DEFINITION" as const,
      entityId: row.id,
      label: row.name ?? row.characterName ?? "Token definition",
      location: "Token catalog",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "BLOCK" as const,
    })),
    ...characterRows.map((row) => ({
      kind: "CHARACTER_PORTRAIT" as const,
      entityId: row.id,
      label: row.name,
      location: "Character",
      visibility: row.ownerMembershipId
        ? ("PARTICIPANT" as const)
        : ("GM_ONLY" as const),
      deletionPolicy: "BLOCK" as const,
    })),
    ...characterMediaRows.map((row) => ({
      kind: "CHARACTER_MEDIA" as const,
      entityId: row.id,
      label: row.label ?? row.characterName,
      location: "Character media",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "BLOCK" as const,
    })),
    ...mapRows.map((row) => ({
      kind: "WORLD_MAP_BACKGROUND" as const,
      entityId: row.id,
      label: row.name,
      location: "World map",
      visibility:
        row.lifecycle === "PUBLISHED" && row.visibility === "CAMPAIGN"
          ? ("PUBLIC" as const)
          : ("GM_ONLY" as const),
      deletionPolicy: "BLOCK" as const,
    })),
    ...audioRows.map((row) => ({
      kind: "AUDIO_TRACK" as const,
      entityId: row.id,
      label: `Audio track ${row.slotOrder + 1}`,
      location: "Music",
      visibility: "PUBLIC" as const,
      deletionPolicy: "BLOCK" as const,
    })),
    ...worldContentCoverRows.map((row) => ({
      kind: "WORLD_CONTENT_COVER" as const,
      entityId: row.id,
      label: row.name,
      location: "World content cover",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "BLOCK" as const,
    })),
    ...worldContentMediaRows.map((row) => ({
      kind: "WORLD_CONTENT_MEDIA" as const,
      entityId: row.id,
      label: row.label ?? row.worldContentName,
      location: "World content media",
      visibility: "GM_ONLY" as const,
      deletionPolicy: "BLOCK" as const,
    })),
    ...provenanceRows.map((row) => ({
      kind: "GENERATED_TOKEN_SOURCE" as const,
      entityId: String(row.sequence),
      label: "Generated token provenance",
      location: "Audit history",
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
        storageKey = asset.storageKey;
        return deleteUnusedAsset(id, usages, {
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
              payload: { assetId: id },
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
