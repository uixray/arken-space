import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@arken/contracts";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, gt, inArray } from "drizzle-orm";
import {
  characterControllers,
  characters,
  invites,
  memberships,
  sessions,
  gameEvents,
  gmAccessCredentials,
  playerAccessGrants,
} from "@arken/db";
import { defaultThemeForMembership } from "./player-themes.js";
import { env } from "./env.js";
import { hashToken, safeEqual } from "./security.js";
import { sessionRoom, memberRoom } from "./rooms.js";
import { z } from "zod";
import {
  gmLoginSchema,
  inviteClaimSchema,
  rotateGmAccessSchema,
} from "@arken/contracts";
import { createSession, requireAuth } from "./auth.js";
import { buildSnapshot, withoutPersonalTheme } from "./snapshot.js";
import { findAction } from "./action-lookup.js";
import { errorMessage } from "./error-message.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

export async function claimInviteOwnership(
  db: Database,
  invite: typeof invites.$inferSelect,
  displayName: string,
) {
  return db.transaction(async (tx) => {
    const [lockedInvite] = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.id, invite.id),
          eq(invites.campaignId, invite.campaignId),
        ),
      )
      .for("update")
      .limit(1);
    if (!lockedInvite) throw new Error("INVITE_UNAVAILABLE");
    const [claimed] = await tx
      .update(invites)
      .set({ claimedAt: new Date() })
      .where(
        and(
          eq(invites.id, invite.id),
          eq(invites.campaignId, invite.campaignId),
          isNull(invites.claimedAt),
          isNull(invites.revokedAt),
          sql`${invites.expiresAt} > clock_timestamp()`,
        ),
      )
      .returning({ id: invites.id });
    if (!claimed) throw new Error("INVITE_UNAVAILABLE");
    const membershipId = randomUUID();
    const [member] = await tx
      .insert(memberships)
      .values({
        id: membershipId,
        campaignId: invite.campaignId,
        role: "PLAYER",
        displayName,
        defaultThemeId: defaultThemeForMembership(membershipId),
      })
      .returning();
    if (!member) throw new Error("MEMBER_CREATE_FAILED");
    await tx
      .update(characters)
      .set({ ownerMembershipId: member.id, updatedAt: new Date() })
      .where(
        and(
          eq(characters.id, invite.characterId),
          eq(characters.campaignId, invite.campaignId),
        ),
      );
    await tx
      .insert(characterControllers)
      .values({ characterId: invite.characterId, membershipId: member.id })
      .onConflictDoNothing();
    await tx.execute(sql`insert into token_controllers (token_definition_id, membership_id)
      select d.id, ${member.id} from token_definitions d
      where d.character_id = ${invite.characterId} and d.campaign_id = ${invite.campaignId}
      and not exists (select 1 from token_controllers c where c.token_definition_id = d.id)
      on conflict do nothing`);
    await tx
      .update(invites)
      .set({ claimedByMembershipId: member.id })
      .where(eq(invites.id, invite.id));
    return member;
  });
}

/**
 * Game sessions: health, GM and invite sign-in, player handles, logout,
 * GM access rotation, bootstrap, diagnostics and GM preview. Moved out of
 * routes.ts unchanged (legacy cleanup after the 15.10 audit).
 */
export function registerSessionRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  const requireCampaignLinkOrigin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!env.CAMPAIGN_LINK_ACCESS_ENABLED) {
      await reply.code(410).send({ error: "CAMPAIGN_LINK_ACCESS_DISABLED" });
      return false;
    }
    if (request.headers.origin !== env.WEB_ORIGIN) {
      await reply.code(403).send({ error: "ORIGIN_FORBIDDEN" });
      return false;
    }
    return true;
  };
  const rotateCurrentGameCookieSession = async (request: FastifyRequest) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (!token) return;
    const [old] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);
    if (!old) return;
    await db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, old.id));
    io.in(sessionRoom(old.id)).disconnectSockets(true);
  };

  app.get("/healthz", { logLevel: "silent" }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return {
        status: "ok",
        database: "ok",
        buildVersion: env.APP_VERSION,
        buildRevision: env.BUILD_REVISION,
        schemaVersion: env.SCHEMA_VERSION,
        time: new Date().toISOString(),
      };
    } catch (error) {
      app.log.error({ error }, "health.database_unavailable");
      return reply.code(503).send({
        status: "error",
        database: "unavailable",
        time: new Date().toISOString(),
      });
    }
  });

  app.post("/api/auth/gm", async (request, reply) => {
    if (!(await requireCampaignLinkOrigin(request, reply))) return;
    const body = gmLoginSchema.parse(request.body);
    const credentials = await db
      .select({
        membershipId: memberships.id,
        campaignId: gmAccessCredentials.campaignId,
        credentialRevision: gmAccessCredentials.revision,
        tokenHash: gmAccessCredentials.tokenHash,
      })
      .from(gmAccessCredentials)
      .innerJoin(
        memberships,
        eq(memberships.campaignId, gmAccessCredentials.campaignId),
      )
      .where(eq(memberships.role, "GM"));
    const gm = credentials.find((credential) =>
      safeEqual(hashToken(body.token), credential.tokenHash),
    );
    if (!gm) return reply.code(403).send({ error: "INVALID_MASTER_TOKEN" });
    await rotateCurrentGameCookieSession(request);
    await createSession(db, reply, gm.membershipId, {
      source: "GM_LINK",
      campaignId: gm.campaignId,
      credentialRevision: gm.credentialRevision,
    });
    return { ok: true };
  });

  app.post("/api/auth/invite", async (request, reply) => {
    if (!(await requireCampaignLinkOrigin(request, reply))) return;
    const body = inviteClaimSchema.parse(request.body);
    const tokenHash = hashToken(body.token);
    const [grant] = await db
      .select({
        membershipId: playerAccessGrants.membershipId,
        id: playerAccessGrants.id,
        campaignId: playerAccessGrants.campaignId,
        revision: playerAccessGrants.revision,
      })
      .from(playerAccessGrants)
      .innerJoin(
        memberships,
        eq(playerAccessGrants.membershipId, memberships.id),
      )
      .where(
        and(
          eq(playerAccessGrants.tokenHash, tokenHash),
          isNull(playerAccessGrants.revokedAt),
        ),
      )
      .limit(1);
    if (grant) {
      if (body.displayName)
        await db
          .update(memberships)
          .set({ displayName: body.displayName })
          .where(eq(memberships.id, grant.membershipId));
      await rotateCurrentGameCookieSession(request);
      await createSession(db, reply, grant.membershipId, {
        source: "PLAYER_GRANT",
        grantId: grant.id,
        grantRevision: grant.revision,
      });
      return { ok: true };
    }

    const [invite] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.claimedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite) return reply.code(410).send({ error: "INVITE_EXPIRED" });

    let result: Awaited<ReturnType<typeof claimInviteOwnership>>;
    try {
      result = await claimInviteOwnership(
        db,
        invite,
        body.displayName ?? invite.label,
      );
    } catch (error) {
      if (errorMessage(error).includes("INVITE_UNAVAILABLE"))
        return reply.code(410).send({ error: "INVITE_EXPIRED" });
      throw error;
    }
    await rotateCurrentGameCookieSession(request);
    await createSession(db, reply, result.id, {
      source: "LEGACY_INVITE",
      inviteId: invite.id,
    });
    return { ok: true };
  });

  // Temporary closed-beta shortcut. This intentionally authenticates by a
  // public alias and must be removed when UIX-232's recorded debt is paid.
  app.post("/api/auth/player/:handle", async (request, reply) => {
    return reply.code(410).send({ error: "PUBLIC_ALIAS_LOGIN_DISABLED" });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token) {
      const deleted = await db
        .delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)))
        .returning({ id: sessions.id });
      for (const session of deleted)
        io.in(sessionRoom(session.id)).disconnectSockets(true);
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.post("/api/gm-access/rotate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = rotateGmAccessSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ ok: true, duplicate: true });
    const result = await db.transaction(async (tx) => {
      const [credential] = await tx
        .select()
        .from(gmAccessCredentials)
        .where(eq(gmAccessCredentials.campaignId, auth.campaignId))
        .limit(1);
      if (!credential) return null;
      const [rotated] = await tx
        .update(gmAccessCredentials)
        .set({
          tokenHash: hashToken(body.token),
          revision: credential.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(gmAccessCredentials.campaignId, auth.campaignId),
            eq(gmAccessCredentials.tokenHash, credential.tokenHash),
            eq(gmAccessCredentials.revision, credential.revision),
          ),
        )
        .returning();
      if (!rotated) return null;
      const gmRows = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.campaignId, auth.campaignId),
            eq(memberships.role, "GM"),
          ),
        );
      const gmMembershipIds = gmRows.map((member) => member.id);
      await tx
        .delete(sessions)
        .where(inArray(sessions.membershipId, gmMembershipIds));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "gm_access.rotated",
        entityType: "campaign",
        entityId: auth.campaignId,
      });
      return gmMembershipIds;
    });
    if (!result) return reply.code(409).send({ error: "GM_ACCESS_CONFLICT" });
    for (const membershipId of result)
      io.in(memberRoom(membershipId)).disconnectSockets(true);
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/bootstrap", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    return buildSnapshot(db, auth);
  });

  app.get("/api/diagnostics", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const snapshot = await buildSnapshot(db, auth);
    return {
      status: "ok",
      requestId: request.id,
      buildVersion: snapshot.buildVersion,
      buildRevision: snapshot.buildRevision,
      schemaVersion: snapshot.schemaVersion,
      snapshotVersion: snapshot.snapshotVersion,
      serverTime: snapshot.serverTime,
    };
  });

  app.get("/api/preview/:membershipId", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { membershipId } = z
      .object({ membershipId: z.string().uuid() })
      .parse(request.params);
    const [target] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.campaignId, auth.campaignId),
          eq(memberships.role, "PLAYER"),
        ),
      )
      .limit(1);
    if (!target) return reply.code(404).send({ error: "PLAYER_NOT_FOUND" });
    return withoutPersonalTheme(
      await buildSnapshot(db, {
        membershipId: target.id,
        campaignId: target.campaignId,
        role: target.role,
        displayName: target.displayName,
      }),
    );
  });
}
