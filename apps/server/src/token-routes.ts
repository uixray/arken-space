import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  resizeTokenSchema,
  tokenAppearanceSchema,
  createTokenSchema,
  createTokenDefinitionSchema,
  updateTokenConditionsSchema,
  deleteTokenSchema,
  replaceTokenControllersSchema,
  placeTokenDefinitionSchema,
  revisionCommandSchema,
  tokenDefinitionUpdateSchema,
  changeTokenLayerSchema,
} from "@arken/contracts";
import {
  assets,
  actionJournal,
  campaigns,
  characters,
  gameEvents,
  memberships,
  scenes,
  tokens,
  tokenControllers,
  tokenDefinitions,
} from "@arken/db";
import { requireAuth } from "./auth.js";
import { findAction } from "./action-lookup.js";
import { canAccessCharacter } from "./character-access.js";
import { invalidateRedoBranch } from "./canvas-history.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type CanvasDatabase = ReturnType<
  typeof import("./campaign-pause-guard.js").campaignCanvasDatabase
>;

/**
 * Tokens and token definitions: placement, size, colours, conditions, layer,
 * deletion, controllers. Moved out of routes.ts unchanged (legacy cleanup
 * after the 15.10 audit); every canvas write still goes through canvasTx.
 */
export function registerTokenRoutes(
  app: FastifyInstance,
  db: Database,
  {
    canvasTx,
    broadcast,
    publishToken,
  }: {
    canvasTx: (campaignId: string) => CanvasDatabase;
    broadcast: (campaignId: string) => Promise<void>;
    /** UIX-412: a visibility-preserving token change as a point event. */
    publishToken: (
      campaignId: string,
      tokenId: string,
      envelope: { sequence: number; actionId: string; emittedAt: string },
    ) => Promise<void>;
  },
) {
  app.post("/api/tokens", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createTokenSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (body.assetId) {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.assetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (!asset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
    }
    const [existingDefinition] = body.definitionId
      ? await db
          .select()
          .from(tokenDefinitions)
          .where(
            and(
              eq(tokenDefinitions.id, body.definitionId),
              eq(tokenDefinitions.campaignId, auth.campaignId),
            ),
          )
          .limit(1)
      : [];
    if (body.definitionId && !existingDefinition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (existingDefinition && body.controllerMembershipIds !== undefined)
      return reply
        .code(400)
        .send({ error: "CONTROLLERS_BELONG_TO_DEFINITION" });
    let tokenOwnerMembershipId = body.ownerMembershipId ?? null;
    let seededControllerMembershipId: string | null = null;
    if (body.characterId) {
      const [character] = await db
        .select({ ownerMembershipId: characters.ownerMembershipId })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      tokenOwnerMembershipId = character.ownerMembershipId;
      seededControllerMembershipId = character.ownerMembershipId;
    } else if (tokenOwnerMembershipId) {
      const [owner] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, tokenOwnerMembershipId),
            eq(memberships.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!owner) return reply.code(404).send({ error: "OWNER_NOT_FOUND" });
    }
    const {
      actionId,
      placementId,
      definitionId: _definitionId,
      controllerMembershipIds: explicitControllers,
      ...tokenInput
    } = body;
    let controllerMembershipIds =
      explicitControllers ??
      (seededControllerMembershipId
        ? [seededControllerMembershipId]
        : tokenOwnerMembershipId
          ? [tokenOwnerMembershipId]
          : []);
    if (
      new Set(controllerMembershipIds).size !== controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    if (existingDefinition) {
      controllerMembershipIds = (
        await db
          .select({ membershipId: tokenControllers.membershipId })
          .from(tokenControllers)
          .where(eq(tokenControllers.tokenDefinitionId, existingDefinition.id))
      ).map((item) => item.membershipId);
    }
    if (controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.campaignId, auth.campaignId));
      const validIds = new Set(
        valid
          .filter((member) => member.role === "PLAYER")
          .map((member) => member.id),
      );
      if (controllerMembershipIds.some((id) => !validIds.has(id)))
        return reply.code(404).send({ error: "CONTROLLER_NOT_FOUND" });
    }
    // UIX-400: имя обязательно, когда наследовать не от кого.
    if (!body.name && !body.characterId)
      return reply.code(400).send({ error: "TOKEN_NAME_REQUIRED" });
    if (placementId) {
      const [occupied] = await db
        .select({ id: tokens.id })
        .from(tokens)
        .where(eq(tokens.id, placementId))
        .limit(1);
      if (occupied)
        return reply.code(409).send({ error: "PLACEMENT_ID_CONFLICT" });
    }
    const guardedDb = canvasTx(auth.campaignId);
    const placement = await guardedDb.transaction(async (tx) => {
      await tx.execute(
        sql`select id from scenes where id = ${scene.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedScene] = await tx
        .select({ id: scenes.id })
        .from(scenes)
        .where(
          and(eq(scenes.id, scene.id), eq(scenes.campaignId, auth.campaignId)),
        )
        .limit(1);
      if (!lockedScene) return null;
      // A character's first placement starts through this legacy route before
      // the client has received its linked definition. Serialize that setup on
      // the character so a repeated click cannot create another starter token.
      if (body.characterId) {
        await tx.execute(
          sql`select id from characters where id = ${body.characterId} and campaign_id = ${auth.campaignId} for update`,
        );
        const [existing] = await tx
          .select({ token: tokens })
          .from(tokens)
          .innerJoin(
            tokenDefinitions,
            eq(tokens.definitionId, tokenDefinitions.id),
          )
          .where(
            and(
              eq(tokens.sceneId, scene.id),
              eq(tokenDefinitions.characterId, body.characterId),
              eq(tokens.x, body.x),
              eq(tokens.y, body.y),
            ),
          )
          .limit(1);
        if (existing) return { token: existing.token, created: false };
      }
      await invalidateRedoBranch(tx, auth, scene.id);
      const [definition] = existingDefinition
        ? [existingDefinition]
        : await tx
            .insert(tokenDefinitions)
            .values({
              campaignId: auth.campaignId,
              characterId: body.characterId ?? null,
              defaultAssetId: body.assetId ?? null,
              // UIX-400: без имени определение наследует его от персонажа.
              name: body.name ?? null,
              defaultWidth: body.width,
              defaultHeight: body.height,
            })
            .returning();
      if (!definition) throw new Error("TOKEN_DEFINITION_CREATE_FAILED");
      if (!existingDefinition && controllerMembershipIds.length)
        await tx.insert(tokenControllers).values(
          controllerMembershipIds.map((membershipId) => ({
            tokenDefinitionId: definition.id,
            membershipId,
          })),
        );
      const [created] = await tx
        .insert(tokens)
        .values({
          ...tokenInput,
          ...(placementId ? { id: placementId } : {}),
          // UIX-400: `tokens.name` только пишется и никогда не читается —
          // подпись всегда берётся из определения. Колонка `notNull`, поэтому
          // отсутствующее имя записывается пустой строкой, а не NULL.
          name: tokenInput.name ?? "",
          definitionId: definition.id,
          characterId: definition.characterId,
          ownerMembershipId: tokenOwnerMembershipId,
          assetId: definition.defaultAssetId,
        })
        .returning();
      if (!created) throw new Error("TOKEN_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "token.created",
        entityType: "token",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { tokenId: created.id },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: created.sceneId,
        actorMembershipId: auth.membershipId,
        actionId,
        scope: created.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_CREATE",
        targetType: "TOKEN",
        targetId: created.id,
        before: null,
        after: created,
        afterRevision: created.revision,
        currentRevision: created.revision,
      });
      return {
        token: {
          ...created,
          definitionId: definition.id,
          controllerMembershipIds,
        },
        created: true,
      };
    });
    if (!placement) return reply.code(409).send({ error: "SCENE_CONFLICT" });
    if (placement.created) await broadcast(auth.campaignId);
    return reply.code(placement.created ? 201 : 200).send(placement.token);
  });

  app.post("/api/token-definitions", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createTokenDefinitionSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate?.entityId) {
      const [existing] = await db
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, duplicate.entityId),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (existing) return reply.code(200).send(existing);
    }
    if (body.defaultAssetId) {
      const [asset] = await db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.defaultAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (!asset)
        return reply.code(404).send({ error: "TOKEN_ASSET_NOT_FOUND" });
    }
    if (body.characterId) {
      const [character] = await db
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character)
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    }
    const controllerIds = [...new Set(body.controllerMembershipIds)];
    if (controllerIds.length) {
      const controllers = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
            inArray(memberships.id, controllerIds),
          ),
        );
      if (controllers.length !== controllerIds.length)
        return reply.code(404).send({ error: "CONTROLLER_NOT_FOUND" });
    }
    const created = await db.transaction(async (tx) => {
      const [definition] = await tx
        .insert(tokenDefinitions)
        .values({
          campaignId: auth.campaignId,
          name: body.name,
          characterId: body.characterId,
          defaultAssetId: body.defaultAssetId,
          defaultWidth: body.defaultWidth,
          defaultHeight: body.defaultHeight,
        })
        .returning();
      if (!definition) throw new Error("TOKEN_DEFINITION_CREATE_FAILED");
      if (controllerIds.length)
        await tx.insert(tokenControllers).values(
          controllerIds.map((membershipId) => ({
            tokenDefinitionId: definition.id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token_definition.created",
        entityType: "token_definition",
        entityId: definition.id,
        entityRevision: definition.revision,
      });
      return { ...definition, controllerMembershipIds: controllerIds };
    });
    await broadcast(auth.campaignId);
    return reply.code(201).send(created);
  });

  app.post("/api/token-definitions/:id/placements", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = placeTokenDefinitionSchema.parse({
      ...(request.body as Record<string, unknown>),
      definitionId: id,
    });
    const priorAction = await findAction(db, auth.campaignId, body.actionId);
    if (priorAction) {
      if (priorAction.entityType === "token" && priorAction.entityId) {
        const [priorPlacement] = await db
          .select({ token: tokens })
          .from(tokens)
          .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
          .innerJoin(
            tokenDefinitions,
            eq(tokens.definitionId, tokenDefinitions.id),
          )
          .where(
            and(
              eq(tokens.id, priorAction.entityId),
              eq(tokens.definitionId, id),
              eq(scenes.campaignId, auth.campaignId),
              eq(tokenDefinitions.campaignId, auth.campaignId),
            ),
          )
          .limit(1);
        if (priorPlacement) return reply.code(200).send(priorPlacement.token);
      }
      const [definition] = await db
        .select({ id: tokenDefinitions.id })
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!definition)
        return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
      return reply.code(200).send({ duplicate: true });
    }
    const [campaign] = await db
      .select({ activeSceneId: campaigns.activeSceneId })
      .from(campaigns)
      .where(eq(campaigns.id, auth.campaignId))
      .limit(1);
    const requestedSceneId = body.sceneId ?? campaign?.activeSceneId;
    if (!requestedSceneId)
      return reply.code(409).send({ error: "ACTIVE_SCENE_REQUIRED" });
    if (auth.role !== "GM" && requestedSceneId !== campaign?.activeSceneId)
      return reply.code(403).send({ error: "INACTIVE_SCENE_FORBIDDEN" });
    const [scene] = await db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.id, requestedSceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    const [definition] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene || !definition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    const controllers = await db
      .select({ membershipId: tokenControllers.membershipId })
      .from(tokenControllers)
      .where(eq(tokenControllers.tokenDefinitionId, definition.id));
    if (
      auth.role !== "GM" &&
      !controllers.some((item) => item.membershipId === auth.membershipId)
    )
      return reply.code(403).send({ error: "TOKEN_DEFINITION_FORBIDDEN" });
    if (body.placementId) {
      const [occupied] = await db
        .select({ id: tokens.id })
        .from(tokens)
        .where(eq(tokens.id, body.placementId))
        .limit(1);
      if (occupied)
        return reply.code(409).send({ error: "PLACEMENT_ID_CONFLICT" });
    }
    const guardedDb = canvasTx(auth.campaignId);
    const placement = await guardedDb.transaction(async (tx) => {
      await tx.execute(
        sql`select id from scenes where id = ${scene.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedScene] = await tx
        .select()
        .from(scenes)
        .where(
          and(eq(scenes.id, scene.id), eq(scenes.campaignId, auth.campaignId)),
        )
        .limit(1);
      if (!lockedScene) return null;
      await tx.execute(
        sql`select id from token_definitions where id = ${definition.id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [lockedDefinition] = await tx
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, definition.id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!lockedDefinition) return null;
      const snapX = (value: number) =>
        lockedScene.grid.enabled
          ? Math.round(
              (value - lockedScene.grid.offsetX) / lockedScene.grid.size,
            ) *
              lockedScene.grid.size +
            lockedScene.grid.offsetX
          : value;
      const snapY = (value: number) =>
        lockedScene.grid.enabled
          ? Math.round(
              (value - lockedScene.grid.offsetY) / lockedScene.grid.size,
            ) *
              lockedScene.grid.size +
            lockedScene.grid.offsetY
          : value;
      const x = snapX(
        body.x ?? lockedScene.width / 2 - lockedDefinition.defaultWidth / 2,
      );
      const y = snapY(
        body.y ?? lockedScene.height / 2 - lockedDefinition.defaultHeight / 2,
      );
      if (lockedDefinition.characterId) {
        const [existing] = await tx
          .select()
          .from(tokens)
          .where(
            and(
              eq(tokens.definitionId, lockedDefinition.id),
              eq(tokens.sceneId, scene.id),
              eq(tokens.x, x),
              eq(tokens.y, y),
            ),
          )
          .limit(1);
        if (existing) return { token: existing, created: false };
      }
      await invalidateRedoBranch(tx, auth, scene.id);
      const [created] = await tx
        .insert(tokens)
        .values({
          definitionId: lockedDefinition.id,
          ...(body.placementId ? { id: body.placementId } : {}),
          sceneId: scene.id,
          characterId: lockedDefinition.characterId,
          assetId: lockedDefinition.defaultAssetId,
          // UIX-400: `tokens.name` только пишется и никогда не читается —
          // подпись всегда берётся из определения. Значение здесь остаётся
          // историческим следом, поэтому пустое имя определения замещается
          // разрешённым, а не пишется как NULL в notNull-колонку.
          name: lockedDefinition.name ?? "",
          x,
          y,
          width: lockedDefinition.defaultWidth,
          height: lockedDefinition.defaultHeight,
          layer: "PLAYER",
        })
        .returning();
      if (!created) throw new Error("TOKEN_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token.placed",
        entityType: "token",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { definitionId: definition.id, sceneId: scene.id },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: scene.id,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        type: "TOKEN_CREATE",
        targetType: "TOKEN",
        targetId: created.id,
        before: null,
        after: created,
        afterRevision: created.revision,
        currentRevision: created.revision,
      });
      return { token: created, created: true };
    });
    if (!placement)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_DELETED" });
    if (placement.created) await broadcast(auth.campaignId);
    return reply.code(placement.created ? 201 : 200).send(placement.token);
  });

  app.patch("/api/tokens/:id/size", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = resizeTokenSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    // The client only exposes a proportional handle, but the server remains
    // authoritative so an older or malicious client cannot distort a token.
    const widthScale = body.width / row.token.width;
    const heightScale = body.height / row.token.height;
    const scale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
    const boundedScale = Math.min(
      Math.min(1024 / row.token.width, 1024 / row.token.height),
      Math.max(Math.max(16 / row.token.width, 16 / row.token.height), scale),
    );
    const width = Math.round(row.token.width * boundedScale);
    const height = Math.round(row.token.height * boundedScale);
    const updated = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          width,
          height,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_RESIZED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: saved.revision,
        payload: { width: saved.width, height: saved.height },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_RESIZE",
        targetType: "TOKEN",
        targetId: id,
        before: { width: row.token.width, height: row.token.height },
        after: { width: saved.width, height: saved.height },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return saved;
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcast(auth.campaignId);
    return updated;
  });

  app.patch("/api/tokens/:id/appearance", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = tokenAppearanceSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    const updated = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          baseColor: body.baseColor,
          frameColor: body.frameColor,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "TOKEN_APPEARANCE_UPDATED",
          entityType: "TOKEN",
          entityId: id,
          entityRevision: saved.revision,
          payload: { baseColor: saved.baseColor, frameColor: saved.frameColor },
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_APPEARANCE",
        targetType: "TOKEN",
        targetId: id,
        before: {
          baseColor: row.token.baseColor,
          frameColor: row.token.frameColor,
        },
        after: { baseColor: saved.baseColor, frameColor: saved.frameColor },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return { saved, event };
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await publishToken(auth.campaignId, id, {
      sequence: Number(updated.event.sequence),
      actionId: body.actionId,
      emittedAt: updated.event.createdAt.toISOString(),
    });
    return updated.saved;
  });

  /**
   * UIX-471 — состояния фигуры: отравлен, без сознания, обездвижен, распластан.
   *
   * Правит мастер, а также тот, кто ведёт эту фигуру: состояния меняются каждый
   * ход, и гонять их через мастера значило бы повторить историю с бросками
   * инициативы, где посредник был самым частым узким местом (UIX-466).
   *
   * Набор нормализуется схемой: порядок значков не должен зависеть от порядка
   * нажатий, а повторы — множить одну и ту же иконку.
   */
  app.patch("/api/tokens/:id/conditions", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = updateTokenConditionsSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens, definitionId: tokens.definitionId })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (auth.role !== "GM") {
      /**
       * Игроку — только своя фигура, и только та, что он и так видит. Скрытая
       * или лежащая на слое мастера не должна выдавать себя даже отказом,
       * отличным от «нет такой»: это тот же запрет, что в UIX-449.
       */
      if (!row.token.visible || row.token.layer === "GM")
        return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
      const [controlled] = await db
        .select({ membershipId: tokenControllers.membershipId })
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, row.definitionId),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (!controlled)
        return reply.code(403).send({ error: "TOKEN_FORBIDDEN" });
    }
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    const updated = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [saved] = await tx
        .update(tokens)
        .set({
          conditions: body.conditions,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!saved) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "TOKEN_CONDITIONS_UPDATED",
          entityType: "TOKEN",
          entityId: id,
          entityRevision: saved.revision,
          payload: { conditions: saved.conditions },
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: saved.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: saved.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_CONDITIONS",
        targetType: "TOKEN",
        targetId: id,
        before: { conditions: row.token.conditions },
        after: { conditions: saved.conditions },
        beforeRevision: row.token.revision,
        afterRevision: saved.revision,
        currentRevision: saved.revision,
      });
      return { saved, event };
    });
    if (!updated) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await publishToken(auth.campaignId, id, {
      sequence: Number(updated.event.sequence),
      actionId: body.actionId,
      emittedAt: updated.event.createdAt.toISOString(),
    });
    return updated.saved;
  });

  app.delete("/api/tokens/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = deleteTokenSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ ok: true, duplicate: true });
    const [row] = await db
      .select({
        token: tokens,
        definition: tokenDefinitions,
        campaignId: scenes.campaignId,
        activeSceneId: campaigns.activeSceneId,
      })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
      .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row || row.definition.campaignId !== auth.campaignId)
      return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "STALE_REVISION" });
    if (auth.role !== "GM") {
      const [controller] = await db
        .select()
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, row.definition.id),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (
        !controller ||
        row.token.locked ||
        !row.token.visible ||
        row.token.layer === "GM" ||
        row.token.sceneId !== row.activeSceneId
      )
        return reply.code(403).send({ error: "TOKEN_FORBIDDEN" });
    }
    const deleted = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [placement] = await tx
        .delete(tokens)
        .where(and(eq(tokens.id, id), eq(tokens.revision, body.revision)))
        .returning();
      if (!placement) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "TOKEN_DELETED",
        entityType: "TOKEN",
        entityId: id,
        entityRevision: body.revision,
        payload: {
          definitionId: row.definition.id,
          sceneId: placement.sceneId,
        },
      });
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: placement.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope: placement.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_DELETE",
        targetType: "TOKEN",
        targetId: placement.id,
        before: placement,
        after: null,
        beforeRevision: placement.revision,
        currentRevision: placement.revision,
      });
      return placement;
    });
    if (!deleted) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcast(auth.campaignId);
    return { ok: true };
  });

  app.put("/api/token-definitions/:id/controllers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = replaceTokenControllersSchema.parse(request.body);
    if (
      new Set(body.controllerMembershipIds).size !==
      body.controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [definition] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!definition)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (body.controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
          ),
        );
      const ids = new Set(valid.map((item) => item.id));
      if (
        body.controllerMembershipIds.some(
          (membershipId) => !ids.has(membershipId),
        )
      )
        return reply.code(400).send({ error: "INVALID_CONTROLLER" });
    }
    const replaced = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tokenDefinitions)
        .set({ revision: definition.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, body.revision),
          ),
        )
        .returning();
      if (!updated) return null;
      await tx
        .delete(tokenControllers)
        .where(eq(tokenControllers.tokenDefinitionId, id));
      if (body.controllerMembershipIds.length)
        await tx.insert(tokenControllers).values(
          body.controllerMembershipIds.map((membershipId) => ({
            tokenDefinitionId: id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token.controllers_replaced",
        entityType: "token_definition",
        entityId: id,
        payload: { controllerMembershipIds: body.controllerMembershipIds },
      });
      return updated;
    });
    if (!replaced) {
      const [latest] = await db
        .select({ revision: tokenDefinitions.revision })
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      return reply.code(409).send({
        error: "TOKEN_DEFINITION_CONFLICT",
        revision: latest?.revision ?? null,
      });
    }
    await broadcast(auth.campaignId);
    return {
      ok: true,
      controllerMembershipIds: body.controllerMembershipIds,
      revision: replaced.revision,
    };
  });

  app.patch("/api/token-definitions/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = tokenDefinitionUpdateSchema.parse(request.body);
    if (body.controllerMembershipIds !== undefined) {
      if (auth.role !== "GM")
        return reply.code(403).send({ error: "GM_REQUIRED" });
      if (
        new Set(body.controllerMembershipIds).size !==
        body.controllerMembershipIds.length
      )
        return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    }
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(tokenDefinitions)
      .where(
        and(
          eq(tokenDefinitions.id, id),
          eq(tokenDefinitions.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current)
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    /**
     * UIX-400: определение без имени и без персонажа наследовать не от кого.
     *
     * Здесь, в отличие от архивации, отвечаем отказом, а не подставляем имя
     * молча: это диалог, мастер на месте, и «сохранили какое-то имя» хуже
     * явного «введите имя». Проверяется состояние **после** патча, иначе
     * снятие персонажа и снятие имени по отдельности прошли бы обе.
     */
    const nextName = body.name === undefined ? current.name : body.name;
    const nextCharacterId =
      body.characterId === undefined ? current.characterId : body.characterId;
    if (!nextName && !nextCharacterId)
      return reply.code(400).send({ error: "TOKEN_NAME_REQUIRED" });
    if (auth.role !== "GM") {
      if (body.defaultWidth !== undefined || body.defaultHeight !== undefined)
        return reply.code(403).send({ error: "TOKEN_SIZE_FORBIDDEN" });
      const [controller] = await db
        .select()
        .from(tokenControllers)
        .where(
          and(
            eq(tokenControllers.tokenDefinitionId, id),
            eq(tokenControllers.membershipId, auth.membershipId),
          ),
        )
        .limit(1);
      if (!controller)
        return reply.code(403).send({ error: "TOKEN_DEFINITION_FORBIDDEN" });
    }
    if (body.defaultAssetId) {
      const [asset] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, body.defaultAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "TOKEN"),
          ),
        )
        .limit(1);
      if (
        !asset ||
        (auth.role !== "GM" &&
          asset.uploadedByMembershipId !== auth.membershipId)
      )
        return reply.code(404).send({ error: "TOKEN_ASSET_NOT_FOUND" });
    }
    if (body.characterId) {
      const [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!character || !(await canAccessCharacter(db, auth, character)))
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    }
    if (body.controllerMembershipIds?.length) {
      const valid = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
          ),
        );
      const validIds = new Set(valid.map((item) => item.id));
      if (
        body.controllerMembershipIds.some(
          (membershipId) => !validIds.has(membershipId),
        )
      )
        return reply.code(400).send({ error: "INVALID_CONTROLLER" });
    }
    const {
      actionId,
      revision: _revision,
      controllerMembershipIds,
      ...changes
    } = body;
    const updated = await canvasTx(auth.campaignId).transaction(async (tx) => {
      const [next] = await tx
        .update(tokenDefinitions)
        .set({
          ...changes,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      if (body.defaultAssetId !== undefined) {
        // Размещённый токен хранит снимок изображения определения. Меняем
        // только экземпляры этого definition в той же транзакции: общий asset
        // может использоваться другими определениями и не должен
        // перезаписываться вместе с одним токеном.
        await tx
          .update(tokens)
          .set({ assetId: body.defaultAssetId, updatedAt: new Date() })
          .where(eq(tokens.definitionId, id));
      }
      if (controllerMembershipIds !== undefined) {
        await tx
          .delete(tokenControllers)
          .where(eq(tokenControllers.tokenDefinitionId, id));
        if (controllerMembershipIds.length)
          await tx.insert(tokenControllers).values(
            controllerMembershipIds.map((membershipId) => ({
              tokenDefinitionId: id,
              membershipId,
            })),
          );
      }
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "token_definition.updated",
        entityType: "token_definition",
        entityId: id,
        entityRevision: next.revision,
      });
      return next;
    });
    if (!updated)
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    await broadcast(auth.campaignId);
    return updated;
  });

  app.delete("/api/token-definitions/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revisionCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const result = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await tx.execute(
        sql`select id from token_definitions where id = ${id} and campaign_id = ${auth.campaignId} for update`,
      );
      const [current] = await tx
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current) return { outcome: "missing" as const };
      if (current.revision !== body.revision)
        return { outcome: "conflict" as const };
      await tx.execute(
        sql`select id from tokens where definition_id = ${id} for update`,
      );
      const placementRows = await tx
        .select({ id: tokens.id, sceneId: tokens.sceneId })
        .from(tokens)
        .where(eq(tokens.definitionId, id));
      const sceneIds = [...new Set(placementRows.map((row) => row.sceneId))];
      const dependentJournalRows = await tx
        .select({ targetId: actionJournal.targetId })
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.targetType, "TOKEN"),
            sql`(${actionJournal.before}->>'definitionId' = ${id} or ${actionJournal.after}->>'definitionId' = ${id})`,
          ),
        );
      const affectedTokenIds = [
        ...new Set([
          ...placementRows.map((row) => row.id),
          ...dependentJournalRows.map((row) => row.targetId),
        ]),
      ];
      if (affectedTokenIds.length)
        await tx
          .update(actionJournal)
          .set({
            status: "INVALIDATED",
            transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(actionJournal.campaignId, auth.campaignId),
              eq(actionJournal.targetType, "TOKEN"),
              inArray(actionJournal.targetId, affectedTokenIds),
              sql`${actionJournal.status} in ('APPLIED', 'UNDONE')`,
            ),
          );
      const [deleted] = await tx
        .delete(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.id, id),
            eq(tokenDefinitions.revision, current.revision),
          ),
        )
        .returning();
      if (!deleted) throw new Error("TOKEN_DEFINITION_CONFLICT");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "token_definition.deleted",
        entityType: "token_definition",
        entityId: id,
        entityRevision: current.revision,
        payload: {
          placementsRemoved: placementRows.length,
          sceneIds,
          undoable: false,
          reason: "destructive definition deletion cascades placements",
        },
      });
      return {
        outcome: "deleted" as const,
        placementsRemoved: placementRows.length,
        sceneIds,
      };
    });
    if (result.outcome === "missing")
      return reply.code(404).send({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    if (result.outcome === "conflict")
      return reply.code(409).send({ error: "TOKEN_DEFINITION_CONFLICT" });
    await broadcast(auth.campaignId);
    return reply.code(204).send();
  });

  app.patch("/api/tokens/:id/layer", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = changeTokenLayerSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [row] = await db
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(eq(tokens.id, id), eq(scenes.campaignId, auth.campaignId)))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "TOKEN_NOT_FOUND" });
    if (row.token.revision !== body.revision)
      return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    const saved = await canvasTx(auth.campaignId).transaction(async (tx) => {
      await invalidateRedoBranch(tx, auth, row.token.sceneId);
      const [updated] = await tx
        .update(tokens)
        .set({
          layer: body.layer,
          revision: row.token.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tokens.id, id), eq(tokens.revision, row.token.revision)))
        .returning();
      if (!updated) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "token.layer",
          entityType: "token",
          entityId: id,
          entityRevision: updated.revision,
          payload: updated,
        })
        .returning();
      await tx.insert(actionJournal).values({
        campaignId: auth.campaignId,
        sceneId: updated.sceneId,
        actorMembershipId: auth.membershipId,
        actionId: body.actionId,
        scope:
          updated.layer === "GM" || row.token.layer === "GM" ? "GM" : "PUBLIC",
        type: "TOKEN_LAYER",
        targetType: "TOKEN",
        targetId: id,
        before: { layer: row.token.layer },
        after: { layer: updated.layer },
        beforeRevision: row.token.revision,
        afterRevision: updated.revision,
        currentRevision: updated.revision,
      });
      return { updated, event };
    });
    if (!saved) return reply.code(409).send({ error: "TOKEN_CONFLICT" });
    await broadcast(auth.campaignId);
    return saved.updated;
  });
}
