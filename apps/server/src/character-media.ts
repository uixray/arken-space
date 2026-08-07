import { and, asc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characterMedia, characters, assets, gameEvents } from "@arken/db";
import {
  createCharacterMediaSchema,
  detachCharacterMediaSchema,
  reorderCharacterMediaSchema,
  updateCharacterMediaSchema,
  type CharacterMediaDto,
  type CharacterMediaVisibility,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";

/**
 * Server-side ACL core for character-media galleries (UIX-292 Stage 1).
 *
 * This module intentionally has no HTTP routes: Stage 2/3/4 route handlers
 * are expected to call `characterMediaVisibility` for list/query filtering
 * (mirrors `visibility()` in ./player-requests.ts) and `canView*` /
 * `canMutate*` / `canDetach*` for single-row authorization once a row has
 * already been loaded.
 */

export interface CharacterMediaAuthContext {
  role: "GM" | "PLAYER";
  membershipId: string;
}

/** The minimal shape needed to decide access to one attachment. */
export interface CharacterMediaSubject {
  visibility: CharacterMediaVisibility;
  /** `characters.ownerMembershipId` for the attachment's character; can be null (unassigned character). */
  characterOwnerMembershipId: string | null;
}

function isOwner(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  return (
    subject.characterOwnerMembershipId !== null &&
    auth.membershipId === subject.characterOwnerMembershipId
  );
}

/**
 * AC3 + AC8 decision matrix:
 *  - GM: sees everything, including GM_ONLY (AC8).
 *  - Owner: sees OWNER_GM (default) and PARTY, never GM_ONLY (AC8 — hidden
 *    from the owner too).
 *  - Any other player: sees PARTY only.
 */
export function canViewCharacterMedia(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  if (auth.role === "GM") return true;
  if (subject.visibility === "GM_ONLY") return false;
  if (subject.visibility === "PARTY") return true;
  return isOwner(auth, subject);
}

/**
 * Mutation (caption, ordering, visibility) is restricted to the GM and the
 * character's owner — never other players, even for PARTY-shared media.
 * GM_ONLY entries stay invisible (and thus immutable) to the owner.
 */
export function canMutateCharacterMedia(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  if (auth.role === "GM") return true;
  if (subject.visibility === "GM_ONLY") return false;
  return isOwner(auth, subject);
}

/**
 * Detach (soft-remove from the gallery) uses the same authority as mutate.
 * It never hard-deletes the underlying asset — that stays a separate,
 * GM-only flow (see UIX-293 asset lifecycle) that this stage does not wire.
 */
export function canDetachCharacterMedia(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  return canMutateCharacterMedia(auth, subject);
}

/**
 * SQL predicate for listing/filtering character_media rows, analogous to
 * `visibility()` in ./player-requests.ts. Requires the query to join
 * `characters` on `characterMedia.characterId = characters.id` so
 * `characters.ownerMembershipId` is available. Does not filter on
 * `detachedAt` — callers decide whether detached rows are included.
 */
export function characterMediaVisibility(
  auth: CharacterMediaAuthContext,
): SQL {
  if (auth.role === "GM") return sql`true`;
  return or(
    eq(characterMedia.visibility, "PARTY"),
    and(
      eq(characterMedia.visibility, "OWNER_GM"),
      eq(characters.ownerMembershipId, auth.membershipId),
    ),
  )!;
}

/**
 * HTTP routes for UIX-292 Stage 2: attach/list/edit/reorder/detach/delete.
 * Mirrors the conventions used by ./player-requests.ts and the `/api/drawings`
 * handlers in ./routes.ts — actionId-scoped idempotency via a campaign-scoped
 * `gameEvents` lookup, and compare-and-swap `revision` checks returning 409
 * on mismatch. Upload itself is out of scope (see `createCharacterMediaSchema`
 * doc comment): callers must already hold an `assetId` from `POST /api/assets`.
 */

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RequestDb = Database | Transaction;
type CharacterMediaRow = typeof characterMedia.$inferSelect;

function fail(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, status: number, error: string) {
  return reply.code(status).send({ error });
}

async function findAction(db: RequestDb, campaignId: string, actionId: string) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(and(eq(gameEvents.campaignId, campaignId), eq(gameEvents.actionId, actionId)))
    .limit(1);
  return event ?? null;
}

function toDto(row: CharacterMediaRow): CharacterMediaDto {
  return {
    id: row.id,
    campaignId: row.campaignId,
    characterId: row.characterId,
    assetId: row.assetId,
    category: row.category,
    caption: row.caption,
    ordering: row.ordering,
    visibility: row.visibility,
    relatedEntityId: row.relatedEntityId,
    uploadedByMembershipId: row.uploadedByMembershipId,
    detachedAt: row.detachedAt ? row.detachedAt.toISOString() : null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findCharacter(db: RequestDb, campaignId: string, characterId: string) {
  const [row] = await db
    .select({ id: characters.id, ownerMembershipId: characters.ownerMembershipId })
    .from(characters)
    .where(and(eq(characters.campaignId, campaignId), eq(characters.id, characterId)))
    .limit(1);
  return row ?? null;
}

/** Loads a character_media row plus the owning character's ownerMembershipId, for ACL checks. */
async function findMediaRow(db: RequestDb, campaignId: string, id: string) {
  const [row] = await db
    .select({ media: characterMedia, characterOwnerMembershipId: characters.ownerMembershipId })
    .from(characterMedia)
    .innerJoin(characters, eq(characterMedia.characterId, characters.id))
    .where(and(eq(characterMedia.campaignId, campaignId), eq(characterMedia.id, id)))
    .limit(1);
  return row ?? null;
}

export function registerCharacterMediaRoutes(app: FastifyInstance, db: Database) {
  app.post("/api/characters/:characterId/media", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { characterId } = z
      .object({ characterId: z.string().uuid() })
      .parse(request.params);
    const body = createCharacterMediaSchema.parse(request.body);
    if (body.characterId !== characterId)
      return fail(reply, 400, "CHARACTER_ID_MISMATCH");
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const character = await findCharacter(db, auth.campaignId, characterId);
    if (!character) return fail(reply, 404, "CHARACTER_NOT_FOUND");
    const [asset] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, body.assetId), eq(assets.campaignId, auth.campaignId)))
      .limit(1);
    if (!asset) return fail(reply, 404, "ASSET_NOT_FOUND");
    const visibility = body.visibility ?? "OWNER_GM";
    const authCtx: CharacterMediaAuthContext = {
      role: auth.role,
      membershipId: auth.membershipId,
    };
    if (
      !canMutateCharacterMedia(authCtx, {
        visibility,
        characterOwnerMembershipId: character.ownerMembershipId,
      })
    )
      return fail(reply, 403, "CHARACTER_MEDIA_FORBIDDEN");
    const created = await db.transaction(async (tx) => {
      const [orderingRow] = await tx
        .select({
          nextOrdering: sql<number>`coalesce(max(${characterMedia.ordering}), -1) + 1`,
        })
        .from(characterMedia)
        .where(eq(characterMedia.characterId, characterId));
      const nextOrdering = orderingRow?.nextOrdering ?? 0;
      const [row] = await tx
        .insert(characterMedia)
        .values({
          campaignId: auth.campaignId,
          characterId,
          assetId: body.assetId,
          category: body.category,
          caption: body.caption ?? null,
          ordering: nextOrdering,
          visibility,
          uploadedByMembershipId: auth.membershipId,
        })
        .returning();
      if (!row) throw new Error("CHARACTER_MEDIA_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character_media.created",
        entityType: "character_media",
        entityId: row.id,
        entityRevision: row.revision,
        payload: row,
      });
      return row;
    });
    return reply.code(201).send(toDto(created));
  });

  app.get("/api/characters/:characterId/media", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { characterId } = z
      .object({ characterId: z.string().uuid() })
      .parse(request.params);
    const character = await findCharacter(db, auth.campaignId, characterId);
    if (!character) return fail(reply, 404, "CHARACTER_NOT_FOUND");
    const authCtx: CharacterMediaAuthContext = {
      role: auth.role,
      membershipId: auth.membershipId,
    };
    const rows = await db
      .select({ media: characterMedia })
      .from(characterMedia)
      .innerJoin(characters, eq(characterMedia.characterId, characters.id))
      .where(
        and(
          eq(characterMedia.campaignId, auth.campaignId),
          eq(characterMedia.characterId, characterId),
          isNull(characterMedia.detachedAt),
          characterMediaVisibility(authCtx),
        ),
      )
      .orderBy(asc(characterMedia.ordering));
    return reply.send(rows.map((row) => toDto(row.media)));
  });

  app.patch("/api/character-media/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateCharacterMediaSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const found = await findMediaRow(db, auth.campaignId, id);
    if (!found) return fail(reply, 404, "CHARACTER_MEDIA_NOT_FOUND");
    const authCtx: CharacterMediaAuthContext = {
      role: auth.role,
      membershipId: auth.membershipId,
    };
    const subject: CharacterMediaSubject = {
      visibility: found.media.visibility,
      characterOwnerMembershipId: found.characterOwnerMembershipId,
    };
    if (!canMutateCharacterMedia(authCtx, subject))
      return fail(reply, 403, "CHARACTER_MEDIA_FORBIDDEN");
    if (found.media.revision !== body.revision)
      return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    const { actionId, revision: _revision, ...changes } = body;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(characterMedia)
        .set({ ...changes, revision: found.media.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(characterMedia.id, id),
            eq(characterMedia.revision, found.media.revision),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "character_media.updated",
        entityType: "character_media",
        entityId: id,
        entityRevision: row.revision,
        payload: row,
      });
      return row;
    });
    if (!updated) return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    return reply.send(toDto(updated));
  });

  app.post("/api/character-media/:id/reorder", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = reorderCharacterMediaSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const found = await findMediaRow(db, auth.campaignId, id);
    if (!found) return fail(reply, 404, "CHARACTER_MEDIA_NOT_FOUND");
    const authCtx: CharacterMediaAuthContext = {
      role: auth.role,
      membershipId: auth.membershipId,
    };
    const subject: CharacterMediaSubject = {
      visibility: found.media.visibility,
      characterOwnerMembershipId: found.characterOwnerMembershipId,
    };
    if (!canMutateCharacterMedia(authCtx, subject))
      return fail(reply, 403, "CHARACTER_MEDIA_FORBIDDEN");
    if (found.media.revision !== body.revision)
      return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(characterMedia)
        .set({ ordering: body.ordering, revision: found.media.revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(characterMedia.id, id),
            eq(characterMedia.revision, found.media.revision),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character_media.reordered",
        entityType: "character_media",
        entityId: id,
        entityRevision: row.revision,
        payload: row,
      });
      return row;
    });
    if (!updated) return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    return reply.send(toDto(updated));
  });

  app.post("/api/character-media/:id/detach", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = detachCharacterMediaSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const found = await findMediaRow(db, auth.campaignId, id);
    if (!found) return fail(reply, 404, "CHARACTER_MEDIA_NOT_FOUND");
    const authCtx: CharacterMediaAuthContext = {
      role: auth.role,
      membershipId: auth.membershipId,
    };
    const subject: CharacterMediaSubject = {
      visibility: found.media.visibility,
      characterOwnerMembershipId: found.characterOwnerMembershipId,
    };
    if (!canDetachCharacterMedia(authCtx, subject))
      return fail(reply, 403, "CHARACTER_MEDIA_FORBIDDEN");
    if (found.media.detachedAt)
      return fail(reply, 409, "CHARACTER_MEDIA_ALREADY_DETACHED");
    if (found.media.revision !== body.revision)
      return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(characterMedia)
        .set({
          detachedAt: new Date(),
          detachedByMembershipId: auth.membershipId,
          revision: found.media.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characterMedia.id, id),
            eq(characterMedia.revision, found.media.revision),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character_media.detached",
        entityType: "character_media",
        entityId: id,
        entityRevision: row.revision,
        payload: row,
      });
      return row;
    });
    if (!updated) return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    return reply.send(toDto(updated));
  });

  /**
   * GM-only hard delete of the gallery entry. Deliberately does NOT delete
   * the underlying `assets` row/file: safe, cross-reference-aware asset
   * deletion is the separate UIX-293 asset-lifecycle mechanism, which (as of
   * this stage) has not been merged into this branch. Once it lands, this
   * handler should be revisited to invoke it instead of leaving the asset
   * untouched.
   */
  app.delete("/api/character-media/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM") return fail(reply, 403, "GM_REQUIRED");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = detachCharacterMediaSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    const found = await findMediaRow(db, auth.campaignId, id);
    if (!found) return fail(reply, 404, "CHARACTER_MEDIA_NOT_FOUND");
    if (found.media.revision !== body.revision)
      return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(characterMedia)
        .where(
          and(
            eq(characterMedia.id, id),
            eq(characterMedia.revision, found.media.revision),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "character_media.deleted",
        entityType: "character_media",
        entityId: id,
        entityRevision: row.revision,
      });
      return row;
    });
    if (!deleted) return fail(reply, 409, "CHARACTER_MEDIA_CONFLICT");
    return reply.code(204).send();
  });
}
