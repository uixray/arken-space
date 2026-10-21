import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { randomUUID } from "node:crypto";
import { and, eq, sql, desc, isNull } from "drizzle-orm";
import {
  characterControllers,
  characters,
  gameEvents,
  playerAccessGrants,
  memberships,
  sessions,
  invites,
} from "@arken/db";
import { hashToken, randomToken } from "./security.js";
import { defaultThemeForMembership } from "./player-themes.js";
import { z } from "zod";
import {
  createInviteSchema,
  rotatePlayerAccessSchema,
  revokePlayerAccessSchema,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import { env } from "./env.js";
import { findAction } from "./action-lookup.js";
import { errorMessage } from "./error-message.js";
import { memberRoom, sessionRoom } from "./rooms.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

function playerAccessDto(
  grant: typeof playerAccessGrants.$inferSelect,
  characterId: string | null,
) {
  return {
    id: grant.id,
    membershipId: grant.membershipId,
    characterId,
    label: grant.label,
    revision: grant.revision,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}

async function createPlayerAccess(
  db: Database,
  campaignId: string,
  characterId: string,
  label: string,
  actionId: string,
  actorMembershipId: string,
) {
  const token = randomToken();
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from characters where id = ${characterId} and campaign_id = ${campaignId} for update`,
    );
    const [character] = await tx
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
        ),
      )
      .limit(1);
    if (!character) throw new Error("CHARACTER_NOT_FOUND");
    if (character.ownerMembershipId) {
      const [existing] = await tx
        .select()
        .from(playerAccessGrants)
        .where(
          and(
            eq(playerAccessGrants.campaignId, campaignId),
            eq(playerAccessGrants.membershipId, character.ownerMembershipId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.revokedAt) {
          const [reactivated] = await tx
            .update(playerAccessGrants)
            .set({
              label,
              tokenHash: hashToken(token),
              revokedAt: null,
              updatedAt: new Date(),
              revision: sql`${playerAccessGrants.revision} + 1`,
            })
            .where(
              and(
                eq(playerAccessGrants.id, existing.id),
                eq(playerAccessGrants.campaignId, campaignId),
                eq(playerAccessGrants.revision, existing.revision),
                sql`${playerAccessGrants.revokedAt} is not null`,
              ),
            )
            .returning();
          if (!reactivated) throw new Error("PLAYER_ACCESS_CONFLICT");
          await tx
            .delete(sessions)
            .where(eq(sessions.membershipId, existing.membershipId));
          await tx.insert(gameEvents).values({
            campaignId,
            actionId,
            membershipId: actorMembershipId,
            type: "player_access.reactivated",
            entityType: "player_access",
            entityId: existing.id,
            payload: { characterId },
          });
          return {
            grant: reactivated,
            memberId: existing.membershipId,
            created: true,
          };
        }
        await tx.insert(gameEvents).values({
          campaignId,
          actionId,
          membershipId: actorMembershipId,
          type: "player_access.reused",
          entityType: "player_access",
          entityId: existing.id,
          payload: { characterId },
        });
        return {
          grant: existing,
          memberId: existing.membershipId,
          created: false,
        };
      }
    }
    const membershipId = randomUUID();
    const [member] = await tx
      .insert(memberships)
      .values({
        id: membershipId,
        campaignId,
        role: "PLAYER",
        displayName: label,
        defaultThemeId: defaultThemeForMembership(membershipId),
      })
      .returning();
    if (!member) throw new Error("MEMBER_CREATE_FAILED");
    await tx
      .update(characters)
      .set({ ownerMembershipId: member.id, updatedAt: new Date() })
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
        ),
      );
    await tx
      .insert(characterControllers)
      .values({ characterId, membershipId: member.id })
      .onConflictDoNothing();
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${characterId} and d.campaign_id = ${campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    const [grant] = await tx
      .insert(playerAccessGrants)
      .values({
        campaignId,
        membershipId: member.id,
        label,
        tokenHash: hashToken(token),
      })
      .returning();
    if (!grant) throw new Error("ACCESS_GRANT_CREATE_FAILED");
    await tx.insert(gameEvents).values({
      campaignId,
      actionId,
      membershipId: actorMembershipId,
      type: "player_access.created",
      entityType: "player_access",
      entityId: grant.id,
      payload: { membershipId: member.id, characterId },
    });
    return { grant, memberId: member.id, created: true };
  });
  return { ...result, token: result.created ? token : null };
}

/**
 * Invites and player access links: create, revoke, rotate. Revoking drops
 * the affected sockets. Moved out of routes.ts unchanged (legacy cleanup
 * after the 15.10 audit).
 */
export function registerAccessRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  app.post("/api/invites", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createInviteSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    let access;
    try {
      access = await createPlayerAccess(
        db,
        auth.campaignId,
        body.characterId,
        body.label,
        body.actionId,
        auth.membershipId,
      );
    } catch (error) {
      if (errorMessage(error).includes("CHARACTER_NOT_FOUND"))
        return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
      if (errorMessage(error).includes("PLAYER_ACCESS_CONFLICT"))
        return reply.code(409).send({ error: "PLAYER_ACCESS_CONFLICT" });
      throw error;
    }
    return reply.code(access.created ? 201 : 200).send({
      grant: playerAccessDto(access.grant, body.characterId),
      created: access.created,
      url: access.token ? `${env.PUBLIC_URL}/join/${access.token}` : null,
    });
  });

  app.post("/api/invites/:id/revoke", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revokePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const now = new Date();
    const revoked = await db.transaction(async (tx) => {
      const [invite] = await tx
        .update(invites)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invites.id, id),
            eq(invites.campaignId, auth.campaignId),
            isNull(invites.revokedAt),
          ),
        )
        .returning({ id: invites.id });
      if (!invite) return null;
      const stale = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.legacyInviteId, invite.id));
      if (stale.length)
        await tx
          .update(sessions)
          .set({ expiresAt: now })
          .where(eq(sessions.legacyInviteId, invite.id));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "invite.revoked",
        entityType: "invite",
        entityId: invite.id,
      });
      return { invite, sessionIds: stale.map((session) => session.id) };
    });
    if (!revoked) return reply.code(404).send({ error: "INVITE_NOT_FOUND" });
    for (const sessionId of revoked.sessionIds)
      io.in(sessionRoom(sessionId)).disconnectSockets(true);
    return reply.send({ ok: true });
  });

  app.get("/api/player-access", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const rows = await db
      .select({ grant: playerAccessGrants, characterId: characters.id })
      .from(playerAccessGrants)
      .leftJoin(
        characters,
        and(
          eq(characters.campaignId, playerAccessGrants.campaignId),
          eq(characters.ownerMembershipId, playerAccessGrants.membershipId),
        ),
      )
      .where(eq(playerAccessGrants.campaignId, auth.campaignId))
      .orderBy(desc(playerAccessGrants.createdAt));
    return rows.map(({ grant, characterId }) =>
      playerAccessDto(grant, characterId),
    );
  });
  app.post("/api/player-access/:id/revoke", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = revokePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const [grant] = await db
      .select()
      .from(playerAccessGrants)
      .where(
        and(
          eq(playerAccessGrants.id, id),
          eq(playerAccessGrants.campaignId, auth.campaignId),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grant)
      return reply.code(404).send({ error: "PLAYER_ACCESS_NOT_FOUND" });
    const revoked = await db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(playerAccessGrants)
        .set({
          revokedAt: new Date(),
          updatedAt: new Date(),
          revision: sql`${playerAccessGrants.revision} + 1`,
        })
        .where(
          and(
            eq(playerAccessGrants.id, grant.id),
            isNull(playerAccessGrants.revokedAt),
            eq(playerAccessGrants.tokenHash, grant.tokenHash),
          ),
        )
        .returning();
      if (!revoked) return false;
      await tx
        .delete(sessions)
        .where(eq(sessions.membershipId, grant.membershipId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "player_access.revoked",
        entityType: "player_access",
        entityId: grant.id,
      });
      return true;
    });
    if (!revoked)
      return reply.code(409).send({ error: "PLAYER_ACCESS_CONFLICT" });
    io.in(memberRoom(grant.membershipId)).disconnectSockets(true);
    return { ok: true };
  });

  app.post("/api/player-access/:id/rotate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = rotatePlayerAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
    const [grant] = await db
      .select()
      .from(playerAccessGrants)
      .where(
        and(
          eq(playerAccessGrants.id, id),
          eq(playerAccessGrants.campaignId, auth.campaignId),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (!grant)
      return reply.code(404).send({ error: "PLAYER_ACCESS_NOT_FOUND" });
    const token = randomToken();
    const rotated = await db.transaction(async (tx) => {
      const [rotated] = await tx
        .update(playerAccessGrants)
        .set({
          tokenHash: hashToken(token),
          updatedAt: new Date(),
          revision: sql`${playerAccessGrants.revision} + 1`,
        })
        .where(
          and(
            eq(playerAccessGrants.id, grant.id),
            eq(playerAccessGrants.campaignId, auth.campaignId),
            eq(playerAccessGrants.revision, body.revision),
            isNull(playerAccessGrants.revokedAt),
          ),
        )
        .returning();
      if (!rotated) return null;
      await tx
        .delete(sessions)
        .where(eq(sessions.membershipId, grant.membershipId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "player_access.rotated",
        entityType: "player_access",
        entityId: grant.id,
      });
      return rotated;
    });
    if (!rotated)
      return reply.code(409).send({ error: "PLAYER_ACCESS_CONFLICT" });
    io.in(memberRoom(grant.membershipId)).disconnectSockets(true);
    return {
      grant: playerAccessDto(rotated, null),
      created: false,
      url: `${env.PUBLIC_URL}/join/${token}`,
    };
  });
}
