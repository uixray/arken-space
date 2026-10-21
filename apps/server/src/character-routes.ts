import type { FastifyInstance } from "fastify";
import type { CharacterDto, ChatMessageDto } from "@arken/contracts";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  actionIdSchema,
  characterCommandSchema,
  createCharacterSchema,
  assignCatalogEntrySchema,
  catalogEntryCommandSchema,
  characterCatalogEntryCommandSchema,
  replaceCharacterControllersSchema,
  revisionCommandSchema,
} from "@arken/contracts";
import {
  assets,
  catalogEntries,
  characterCatalogEntries,
  characterControllers,
  characters,
  gameEvents,
  memberships,
} from "@arken/db";
import { createStarterCharacter } from "@arken/system";
import { requireAuth } from "./auth.js";
import { characterDto } from "./character-dto.js";
import { findAction } from "./action-lookup.js";
import { isCampaignDiceFrame } from "./member-dice-frame-routes.js";
import {
  canAccessCharacter,
  campaignDefaultStatLayout,
  characterControllerIds,
  sameResourceImages,
} from "./character-access.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type PublishCharacter = (
  campaignId: string,
  change: {
    character: { ownerMembershipId: string | null };
    controllerIds: string[];
    project: (visibleControllerIds: string[]) => CharacterDto;
    message: ChatMessageDto | null;
    envelope: { sequence: number; actionId: string; emittedAt: string };
  },
) => Promise<void>;

/**
 * Characters and the item catalog: creation, controllers, character edits,
 * catalog entries and their assignment to characters. Moved out of
 * routes.ts unchanged (legacy cleanup after the 15.10 audit).
 */
export function registerCharacterRoutes(
  app: FastifyInstance,
  db: Database,
  {
    broadcast,
    publishCharacter,
  }: {
    broadcast: (campaignId: string) => Promise<void>;
    /** UIX-412: a character change as a point event to those who see it. */
    publishCharacter: PublishCharacter;
  },
) {
  app.post("/api/characters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createCharacterSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    // A template preset carries over structural fields only (stats/skills/spells/
    // inventory/resources); the client derives it from an existing character and
    // sends a deep-cloned snapshot, so the new character is independent from
    // the moment it is created — never a live-linked clone of its source.
    const starter = createStarterCharacter();
    const template = body.template ?? {};
    const ownerMembershipId = auth.role === "PLAYER" ? auth.membershipId : null;
    const character = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(characters)
        .values({
          campaignId: auth.campaignId,
          ownerMembershipId,
          name: body.name,
          stats: { ...starter.stats, ...template.stats },
          skills: template.skills ?? starter.skills,
          spells: template.spells ?? starter.spells,
          inventory: template.inventory ?? [],
          resources: template.resources ?? starter.resources,
        })
        .returning();
      if (!created) throw new Error("CHARACTER_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.created",
        entityType: "character",
        entityId: created.id,
        entityRevision: created.revision,
        payload: { characterId: created.id },
      });
      return created;
    });
    await broadcast(auth.campaignId);
    return reply.code(201).send(character);
  });

  app.put("/api/characters/:id/controllers", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = replaceCharacterControllersSchema.parse(request.body);
    if (
      new Set(body.controllerMembershipIds).size !==
      body.controllerMembershipIds.length
    )
      return reply.code(400).send({ error: "DUPLICATE_CONTROLLERS" });
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!character)
      return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    const requestedIds = new Set(body.controllerMembershipIds);
    if (character.ownerMembershipId)
      requestedIds.add(character.ownerMembershipId);
    const controllerMembershipIds = [...requestedIds];
    if (controllerMembershipIds.length) {
      const valid = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "PLAYER"),
          ),
        );
      const validIds = new Set(valid.map((member) => member.id));
      if (
        controllerMembershipIds.some(
          (membershipId) => !validIds.has(membershipId),
        )
      )
        return reply.code(400).send({ error: "INVALID_CONTROLLER" });
    }
    const replaced = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({ revision: character.revision + 1, updatedAt: new Date() })
        .where(
          and(eq(characters.id, id), eq(characters.revision, body.revision)),
        )
        .returning();
      if (!updated) return null;
      await tx
        .delete(characterControllers)
        .where(eq(characterControllers.characterId, id));
      if (controllerMembershipIds.length)
        await tx.insert(characterControllers).values(
          controllerMembershipIds.map((membershipId) => ({
            characterId: id,
            membershipId,
          })),
        );
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character.controllers_replaced",
        entityType: "character",
        entityId: id,
        entityRevision: updated.revision,
        payload: { controllerMembershipIds },
      });
      return updated;
    });
    if (!replaced)
      return reply.code(409).send({
        error: "CHARACTER_CONFLICT",
        revision: character.revision,
      });
    await broadcast(auth.campaignId);
    return {
      ok: true,
      controllerMembershipIds,
      revision: replaced.revision,
    };
  });

  app.patch("/api/characters/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = characterCommandSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(characters)
      .where(
        and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    if (!(await canAccessCharacter(db, auth, current)))
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    if (body.revision !== undefined && body.revision !== current.revision)
      return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    const { actionId, revision: _revision, ...updates } = body;
    if (
      auth.role !== "GM" &&
      Object.keys(updates).some(
        (key) =>
          ![
            "name",
            "portraitAssetId",
            "stats",
            "backstory",
            "inventory",
            "notes",
            "resources",
            "skills",
            "spells",
            "wallet",
          ].includes(key),
      )
    )
      return reply.code(403).send({ error: "CHARACTER_FIELD_FORBIDDEN" });
    if (updates.portraitAssetId) {
      const [portrait] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, updates.portraitAssetId),
            eq(assets.campaignId, auth.campaignId),
            eq(assets.kind, "PORTRAIT"),
          ),
        )
        .limit(1);
      if (!portrait)
        return reply.code(400).send({ error: "INVALID_PORTRAIT_ASSET" });
      if (
        auth.role !== "GM" &&
        portrait.uploadedByMembershipId !== auth.membershipId
      )
        return reply.code(403).send({ error: "PORTRAIT_ASSET_FORBIDDEN" });
    }
    const mergedUpdates = updates.stats
      ? {
          ...updates,
          stats: {
            ...(current.stats as Record<string, number>),
            ...updates.stats,
          },
        }
      : updates;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(characters)
        .set({
          ...mergedUpdates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(characters.id, id), eq(characters.revision, current.revision)),
        )
        .returning();
      if (!next) return null;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "character.updated",
          entityType: "character",
          entityId: next.id,
          entityRevision: next.revision,
          payload: { characterId: next.id },
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { next, event };
    });
    if (!updated) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    /**
     * UIX-412: the name and portrait reach everyone (identities, token
     * labels) and a resource image enters snapshot.assets; those keep the
     * full broadcast. Every other field is seen only by those who see the
     * character, so a point event carries it.
     */
    if (
      "name" in updates ||
      "portraitAssetId" in updates ||
      !sameResourceImages(current.resources, updated.next.resources)
    )
      await broadcast(auth.campaignId);
    else {
      const assignedEntries = await db
        .select()
        .from(characterCatalogEntries)
        .where(eq(characterCatalogEntries.characterId, id));
      const statLayout = await campaignDefaultStatLayout(db, auth.campaignId);
      await publishCharacter(auth.campaignId, {
        character: updated.next,
        controllerIds: await characterControllerIds(db, id),
        project: (visibleControllerIds) =>
          characterDto(
            updated.next,
            assignedEntries,
            visibleControllerIds,
            statLayout,
          ),
        message: null,
        envelope: {
          sequence: Number(updated.event.sequence),
          actionId,
          emittedAt: updated.event.createdAt.toISOString(),
        },
      });
    }
    return updated.next;
  });

  app.post("/api/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const parsedBody = catalogEntryCommandSchema.safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({
        error: "INVALID_CATALOG_ENTRY",
        message: "Проверьте заполнение полей навыка или способности.",
        fieldErrors: parsedBody.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.map(String).join("."),
          code: issue.code,
        })),
      });
    const body = parsedBody.data;
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (
      body.diceFrameAssetId &&
      !(await isCampaignDiceFrame(db, auth.campaignId, body.diceFrameAssetId))
    )
      return reply.code(404).send({ error: "DICE_FRAME_NOT_FOUND" });
    const { actionId, ...input } = body;
    const created = await db.transaction(async (tx) => {
      const [entry] = await tx
        .insert(catalogEntries)
        .values({ campaignId: auth.campaignId, ...input })
        .returning();
      if (!entry) throw new Error("CATALOG_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "catalog.created",
        entityType: "catalog_entry",
        entityId: entry.id,
        entityRevision: 0,
      });
      return entry;
    });
    await broadcast(auth.campaignId);
    return reply.code(201).send(created);
  });

  app.patch("/api/catalog/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const parsedBody = catalogEntryCommandSchema
      .partial()
      .extend({
        actionId: actionIdSchema,
        revision: z.number().int().nonnegative().optional(),
      })
      .safeParse(request.body);
    if (!parsedBody.success)
      return reply.code(400).send({
        error: "INVALID_CATALOG_ENTRY",
        message: "Проверьте заполнение полей навыка или способности.",
        fieldErrors: parsedBody.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.map(String).join("."),
          code: issue.code,
        })),
      });
    const body = parsedBody.data;
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [current] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, id),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CATALOG_NOT_FOUND" });
    if (body.revision !== undefined && body.revision !== current.revision)
      return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    if (
      body.diceFrameAssetId &&
      !(await isCampaignDiceFrame(db, auth.campaignId, body.diceFrameAssetId))
    )
      return reply.code(404).send({ error: "DICE_FRAME_NOT_FOUND" });
    const { actionId, revision: _revision, ...updates } = body;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(catalogEntries)
        .set({
          ...updates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogEntries.id, id),
            eq(catalogEntries.revision, current.revision),
          ),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "catalog.updated",
        entityType: "catalog_entry",
        entityId: id,
        entityRevision: next.revision,
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    await broadcast(auth.campaignId);
    return updated;
  });

  app.delete("/api/catalog/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revisionCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ ok: true, duplicate: true });
    const [current] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, id),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!current) return reply.code(404).send({ error: "CATALOG_NOT_FOUND" });
    if (current.revision !== body.revision)
      return reply.code(409).send({ error: "CATALOG_CONFLICT" });
    let deleted;
    try {
      deleted = await db.transaction(async (tx) => {
        // Assigned entries are snapshots. Removing a template only severs their
        // provenance link; it must never remove or mutate the character copies.
        await tx
          .update(characterCatalogEntries)
          .set({ sourceCatalogEntryId: null })
          .where(eq(characterCatalogEntries.sourceCatalogEntryId, id));
        const [entry] = await tx
          .delete(catalogEntries)
          .where(
            and(
              eq(catalogEntries.id, id),
              eq(catalogEntries.campaignId, auth.campaignId),
              eq(catalogEntries.revision, body.revision),
            ),
          )
          .returning();
        if (!entry) throw new Error("CATALOG_DELETE_CONFLICT");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "catalog.deleted",
          entityType: "catalog_entry",
          entityId: id,
          entityRevision: body.revision,
        });
        return entry;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CATALOG_DELETE_CONFLICT")
        return reply.code(409).send({ error: "CATALOG_CONFLICT" });
      throw error;
    }
    await broadcast(auth.campaignId);
    return { ok: true, deleted };
  });

  app.post("/api/characters/:id/catalog", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const characterId = z
      .object({ id: z.string().uuid() })
      .parse(request.params).id;
    const [character] = await db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!character)
      return reply.code(404).send({ error: "ASSIGNMENT_SOURCE_NOT_FOUND" });
    if (!(await canAccessCharacter(db, auth, character)))
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    // Personal entries live on the character, never in the shared catalog.
    const isAssignment =
      typeof request.body === "object" &&
      request.body !== null &&
      "catalogEntryId" in request.body;
    if (!isAssignment) {
      const parsed = catalogEntryCommandSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: "INVALID_CATALOG_ENTRY",
          message: "Проверьте заполнение полей навыка или способности.",
          fieldErrors: parsed.error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.map(String).join("."),
            code: issue.code,
          })),
        });
      const { actionId, ...input } = parsed.data;
      const previous = await findAction(db, auth.campaignId, actionId);
      if (previous) {
        if (previous.type !== "character_catalog.created" || !previous.entityId)
          return reply.code(409).send({ error: "ACTION_CONFLICT" });
        const [entry] = await db
          .select()
          .from(characterCatalogEntries)
          .where(
            and(
              eq(characterCatalogEntries.id, previous.entityId),
              eq(characterCatalogEntries.characterId, characterId),
            ),
          )
          .limit(1);
        if (!entry) return reply.code(409).send({ error: "ACTION_CONFLICT" });
        return reply.code(200).send(entry);
      }
      const created = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(characterCatalogEntries)
          .values({ characterId, sourceCatalogEntryId: null, ...input })
          .returning();
        if (!entry) throw new Error("CHARACTER_CATALOG_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.created",
          entityType: "character_catalog_entry",
          entityId: entry.id,
          entityRevision: 0,
        });
        return entry;
      });
      await broadcast(auth.campaignId);
      return reply.code(201).send(created);
    }
    const body = assignCatalogEntrySchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const [source] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.id, body.catalogEntryId),
          eq(catalogEntries.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!source)
      return reply.code(404).send({ error: "ASSIGNMENT_SOURCE_NOT_FOUND" });
    const [existingAssignment] = await db
      .select({ id: characterCatalogEntries.id })
      .from(characterCatalogEntries)
      .where(
        and(
          eq(characterCatalogEntries.characterId, characterId),
          eq(characterCatalogEntries.sourceCatalogEntryId, source.id),
        ),
      )
      .limit(1);
    if (existingAssignment)
      return reply.code(409).send({ error: "CATALOG_ALREADY_ASSIGNED" });
    let assigned;
    try {
      assigned = await db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(characterCatalogEntries)
          .values({
            characterId,
            sourceCatalogEntryId: source.id,
            kind: source.kind,
            name: source.name,
            description: source.description,
            data: source.data,
          })
          .returning();
        if (!entry) throw new Error("ASSIGNMENT_CREATE_FAILED");
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.assigned",
          entityType: "character_catalog_entry",
          entityId: entry.id,
          entityRevision: 0,
        });
        return entry;
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        return reply.code(409).send({ error: "CATALOG_ALREADY_ASSIGNED" });
      throw error;
    }
    await broadcast(auth.campaignId);
    return reply.code(201).send(assigned);
  });

  app.patch(
    "/api/characters/:characterId/catalog/:id",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), id: z.string().uuid() })
        .parse(request.params);
      const body = characterCatalogEntryCommandSchema
        .extend({ revision: z.number().int().nonnegative().optional() })
        .parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const [current] = await db
        .select({ entry: characterCatalogEntries, character: characters })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characterCatalogEntries.id, params.id),
            eq(characterCatalogEntries.characterId, params.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "CHARACTER_ENTRY_NOT_FOUND" });
      if (!(await canAccessCharacter(db, auth, current.character)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      if (
        body.revision !== undefined &&
        body.revision !== current.entry.revision
      )
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      const { actionId, revision: _revision, ...updates } = body;
      const updated = await db.transaction(async (tx) => {
        const [next] = await tx
          .update(characterCatalogEntries)
          .set({
            ...updates,
            revision: current.entry.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, params.id),
              eq(characterCatalogEntries.revision, current.entry.revision),
            ),
          )
          .returning();
        if (!next) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.updated",
          entityType: "character_catalog_entry",
          entityId: next.id,
          entityRevision: next.revision,
        });
        return next;
      });
      if (!updated)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      await broadcast(auth.campaignId);
      return updated;
    },
  );

  app.delete(
    "/api/characters/:characterId/catalog/:id",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = z
        .object({ characterId: z.string().uuid(), id: z.string().uuid() })
        .parse(request.params);
      const body = revisionCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ ok: true, duplicate: true });
      const [current] = await db
        .select({ entry: characterCatalogEntries, character: characters })
        .from(characterCatalogEntries)
        .innerJoin(
          characters,
          eq(characterCatalogEntries.characterId, characters.id),
        )
        .where(
          and(
            eq(characterCatalogEntries.id, params.id),
            eq(characterCatalogEntries.characterId, params.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!current)
        return reply.code(404).send({ error: "CHARACTER_ENTRY_NOT_FOUND" });
      if (!(await canAccessCharacter(db, auth, current.character)))
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
      if (current.entry.revision !== body.revision)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      const deleted = await db.transaction(async (tx) => {
        const [entry] = await tx
          .delete(characterCatalogEntries)
          .where(
            and(
              eq(characterCatalogEntries.id, params.id),
              eq(characterCatalogEntries.characterId, params.characterId),
              eq(characterCatalogEntries.revision, body.revision),
            ),
          )
          .returning();
        if (!entry) return null;
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "character_catalog.deleted",
          entityType: "character_catalog_entry",
          entityId: params.id,
          entityRevision: body.revision,
          payload: { characterId: params.characterId },
        });
        return entry;
      });
      if (!deleted)
        return reply.code(409).send({ error: "CHARACTER_ENTRY_CONFLICT" });
      await broadcast(auth.campaignId);
      return { ok: true };
    },
  );
}
