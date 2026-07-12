import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import { and, desc, eq, gt, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  activateSceneSchema,
  actionIdSchema,
  assetKindSchema,
  characterCommandSchema,
  createChatMessageSchema,
  createFogRevealSchema,
  createInviteSchema,
  createSceneSchema,
  createTokenSchema,
  diceRequestSchema,
  gmLoginSchema,
  inviteClaimSchema,
  undoFogRevealSchema,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import {
  assets,
  campaigns,
  characters,
  chatMessages,
  fogReveals,
  gameEvents,
  invites,
  memberships,
  scenes,
  sessions,
  tokens,
} from "@arken/db";
import { createStarterCharacter } from "@arken/system";
import { createSession, requireAuth } from "./auth.js";
import { DiceFormulaError, rollFormula } from "./dice.js";
import { env } from "./env.js";
import { hashToken, randomToken, safeEqual } from "./security.js";
import { buildSnapshot } from "./snapshot.js";
import {
  assertStorageCapacity,
  displayNameFromUpload,
  openStoredFile,
  removeStoredUpload,
  storeUpload,
} from "./storage.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
const campaignRoom = (id: string) => `campaign:${id}`;
const gmRoom = (id: string) => `campaign:${id}:gm`;
const memberRoom = (id: string) => `member:${id}`;

async function broadcastSnapshots(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
) {
  const sockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  await Promise.all(
    sockets.map(async (socket) => {
      const auth = socket.data.auth;
      if (auth?.campaignId === campaignId) {
        socket.emit("game:snapshot", await buildSnapshot(db, auth));
      }
    }),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

async function findAction(db: Database, campaignId: string, actionId: string) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  return event ?? null;
}

export function registerRoutes(
  app: FastifyInstance,
  db: Database,
  io: RealtimeServer,
) {
  app.get("/healthz", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return {
        status: "ok",
        database: "ok",
        buildVersion: env.APP_VERSION,
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
    const body = gmLoginSchema.parse(request.body);
    if (!safeEqual(hashToken(body.token), hashToken(env.GM_ACCESS_TOKEN)))
      return reply.code(403).send({ error: "INVALID_MASTER_TOKEN" });
    const [gm] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.role, "GM"))
      .limit(1);
    if (!gm) return reply.code(503).send({ error: "MASTER_NOT_SEEDED" });
    await createSession(db, reply, gm.id);
    return { ok: true };
  });

  app.post("/api/auth/invite", async (request, reply) => {
    const body = inviteClaimSchema.parse(request.body);
    const tokenHash = hashToken(body.token);
    const [invite] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.tokenHash, tokenHash),
          isNull(invites.claimedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invite) return reply.code(410).send({ error: "INVITE_EXPIRED" });

    const result = await db.transaction(async (tx) => {
      const [member] = await tx
        .insert(memberships)
        .values({
          campaignId: invite.campaignId,
          role: "PLAYER",
          displayName: body.displayName,
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
      const [claimed] = await tx
        .update(invites)
        .set({ claimedAt: new Date(), claimedByMembershipId: member.id })
        .where(and(eq(invites.id, invite.id), isNull(invites.claimedAt)))
        .returning();
      if (!claimed) throw new Error("INVITE_ALREADY_CLAIMED");
      return member;
    });
    await createSession(db, reply, result.id);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[env.SESSION_COOKIE_NAME];
    if (token)
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
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
    return buildSnapshot(db, {
      membershipId: target.id,
      campaignId: target.campaignId,
      role: target.role,
      displayName: target.displayName,
    });
  });

  app.post("/api/client-logs", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = z
      .object({
        level: z.enum(["info", "warn", "error"]),
        event: z.string().trim().min(1).max(120),
        message: z.string().max(2000).optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body);
    app.log[body.level](
      {
        source: "browser",
        membershipId: auth.membershipId,
        campaignId: auth.campaignId,
        event: body.event,
        message: body.message,
        context: body.context,
        requestId: request.id,
      },
      "client.event",
    );
    return reply.code(202).send({ ok: true });
  });

  app.post("/api/characters", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        actionId: actionIdSchema,
      })
      .parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const character = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(characters)
        .values({
          campaignId: auth.campaignId,
          name: body.name,
          ...createStarterCharacter(),
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
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(character);
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
    if (auth.role !== "GM" && current.ownerMembershipId !== auth.membershipId)
      return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    const { actionId, ...updates } = body;
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx
        .update(characters)
        .set({
          ...updates,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(characters.id, id), eq(characters.revision, current.revision)),
        )
        .returning();
      if (!next) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "character.updated",
        entityType: "character",
        entityId: next.id,
        entityRevision: next.revision,
        payload: { characterId: next.id },
      });
      return next;
    });
    if (!updated) return reply.code(409).send({ error: "CHARACTER_CONFLICT" });
    if (updated) {
      await broadcastSnapshots(io, db, auth.campaignId);
    }
    return updated;
  });

  app.post("/api/invites", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createInviteSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(409).send({ error: "ACTION_ALREADY_APPLIED" });
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
    if (!character)
      return reply.code(404).send({ error: "CHARACTER_NOT_FOUND" });
    const token = randomToken();
    const expiresAt = new Date(Date.now() + body.expiresInHours * 3600_000);
    await db.transaction(async (tx) => {
      const [invite] = await tx
        .insert(invites)
        .values({
          campaignId: auth.campaignId,
          characterId: body.characterId,
          label: body.label,
          tokenHash: hashToken(token),
          expiresAt,
        })
        .returning();
      if (!invite) throw new Error("INVITE_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "invite.created",
        entityType: "invite",
        entityId: invite.id,
        payload: { characterId: body.characterId, label: body.label },
      });
    });
    return reply.code(201).send({
      url: `${env.PUBLIC_URL}/join/${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.post("/api/scenes", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const { actionId, ...sceneInput } = body;
    const scene = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(scenes)
        .values({
          campaignId: auth.campaignId,
          ...sceneInput,
          mapAssetId: body.mapAssetId ?? null,
        })
        .returning();
      if (!created) throw new Error("SCENE_CREATE_FAILED");
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.created",
        entityType: "scene",
        entityId: created.id,
        payload: { sceneId: created.id },
      });
      return created;
    });
    return reply.code(201).send(scene);
  });

  app.patch("/api/scenes/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = createSceneSchema
      .partial()
      .extend({ actionId: actionIdSchema })
      .parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const { actionId, ...sceneUpdates } = body;
    const scene = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(scenes)
        .set({ ...sceneUpdates, updatedAt: new Date() })
        .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
        .returning();
      if (!updated) return null;
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId,
        membershipId: auth.membershipId,
        type: "scene.updated",
        entityType: "scene",
        entityId: updated.id,
        payload: { sceneId: updated.id },
      });
      return updated;
    });
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    await broadcastSnapshots(io, db, auth.campaignId);
    return scene;
  });

  app.post("/api/scenes/activate", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = activateSceneSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return { ok: true, duplicate: true };
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
    await db.transaction(async (tx) => {
      await tx
        .update(campaigns)
        .set({ activeSceneId: scene.id, updatedAt: new Date() })
        .where(eq(campaigns.id, auth.campaignId));
      await tx.insert(gameEvents).values({
        campaignId: auth.campaignId,
        actionId: body.actionId,
        membershipId: auth.membershipId,
        type: "scene.activated",
        entityType: "scene",
        entityId: scene.id,
        payload: { sceneId: scene.id },
      });
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return { ok: true };
  });

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
    const { actionId, ...tokenInput } = body;
    const token = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tokens)
        .values({
          ...tokenInput,
          characterId: body.characterId ?? null,
          ownerMembershipId: body.ownerMembershipId ?? null,
          assetId: body.assetId ?? null,
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
      return created;
    });
    await broadcastSnapshots(io, db, auth.campaignId);
    return reply.code(201).send(token);
  });

  app.post("/api/fog-reveals", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = createFogRevealSchema.parse(request.body);
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
    const { actionId, ...revealInput } = body;
    const result = await db.transaction(async (tx) => {
      const [reveal] = await tx
        .insert(fogReveals)
        .values(revealInput)
        .returning();
      if (!reveal) throw new Error("FOG_CREATE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId,
          membershipId: auth.membershipId,
          type: "fog.created",
          entityType: "fog",
          entityId: reveal.id,
          payload: reveal,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { reveal, event };
    });
    const { reveal, event } = result;
    if (reveal) {
      io.to(campaignRoom(auth.campaignId)).emit("fog:created", {
        sequence: Number(event.sequence),
        actionId,
        emittedAt: event.createdAt.toISOString(),
        data: reveal,
      });
    }
    return reply.code(201).send(reveal);
  });

  app.delete("/api/fog-reveals/latest", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const body = undoFogRevealSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return { ok: true, duplicate: true };
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, body.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });

    const result = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select()
        .from(fogReveals)
        .where(eq(fogReveals.sceneId, scene.id))
        .orderBy(desc(fogReveals.createdAt), desc(fogReveals.id))
        .limit(1);
      if (!latest) return null;
      await tx.delete(fogReveals).where(eq(fogReveals.id, latest.id));
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "fog.removed",
          entityType: "fog",
          entityId: latest.id,
          payload: { fogRevealId: latest.id, sceneId: latest.sceneId },
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { latest, event };
    });
    if (!result) return reply.code(404).send({ error: "FOG_REVEAL_NOT_FOUND" });
    const data = {
      fogRevealId: result.latest.id,
      sceneId: result.latest.sceneId,
    };
    io.to(campaignRoom(auth.campaignId)).emit("fog:removed", {
      sequence: Number(result.event.sequence),
      actionId: body.actionId,
      emittedAt: result.event.createdAt.toISOString(),
      data,
    });
    return { ok: true, ...data };
  });

  app.post("/api/chat", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = createChatMessageSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    const saved = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: body.characterId ?? null,
          body: body.body,
          visibility: body.visibility,
        })
        .returning();
      if (!row) throw new Error("MESSAGE_CREATE_FAILED");
      const dto = {
        id: row.id,
        membershipId: row.membershipId,
        displayName: auth.displayName,
        characterId: row.characterId,
        body: row.body,
        visibility: row.visibility,
        kind: row.kind,
        dice: null,
        createdAt: row.createdAt.toISOString(),
      } as const;
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "chat.created",
          entityType: "chat",
          entityId: row.id,
          payload: dto,
        })
        .returning();
      if (!event) throw new Error("EVENT_RECORD_FAILED");
      return { row, dto, event };
    });
    const { row, dto, event } = saved;
    const envelope = {
      sequence: Number(event.sequence),
      actionId: body.actionId,
      emittedAt: event.createdAt.toISOString(),
      data: dto,
    };
    if (row.visibility === "PUBLIC")
      io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
    else {
      io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
      io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
    }
    return reply.code(201).send(dto);
  });

  app.post("/api/dice", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = diceRequestSchema.parse(request.body);
    const duplicate = await findAction(db, auth.campaignId, body.actionId);
    if (duplicate) return reply.code(200).send({ duplicate: true });
    let character = null;
    if (body.characterId) {
      [character] = await db
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, body.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (
        !character ||
        (auth.role !== "GM" &&
          character.ownerMembershipId !== auth.membershipId)
      )
        return reply.code(403).send({ error: "CHARACTER_FORBIDDEN" });
    } else if (auth.role === "PLAYER") {
      [character] = await db
        .select()
        .from(characters)
        .where(eq(characters.ownerMembershipId, auth.membershipId))
        .limit(1);
    }
    try {
      const result = rollFormula(
        body.formula,
        character?.stats ?? {},
        randomInt,
        body.label,
      );
      const saved = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(chatMessages)
          .values({
            campaignId: auth.campaignId,
            membershipId: auth.membershipId,
            characterId: character?.id ?? null,
            kind: "DICE",
            visibility: body.visibility,
            body: body.label ?? body.formula,
            dice: result,
          })
          .returning();
        if (!row) throw new Error("ROLL_SAVE_FAILED");
        const dto = {
          id: row.id,
          membershipId: row.membershipId,
          displayName: auth.displayName,
          characterId: row.characterId,
          body: row.body,
          visibility: row.visibility,
          kind: row.kind,
          dice: result,
          createdAt: row.createdAt.toISOString(),
        } as const;
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: body.actionId,
            membershipId: auth.membershipId,
            type: "dice.created",
            entityType: "chat",
            entityId: row.id,
            payload: dto,
          })
          .returning();
        if (!event) throw new Error("EVENT_RECORD_FAILED");
        return { row, dto, event };
      });
      const { row, dto, event } = saved;
      const envelope = {
        sequence: Number(event.sequence),
        actionId: body.actionId,
        emittedAt: event.createdAt.toISOString(),
        data: dto,
      };
      if (row.visibility === "PUBLIC")
        io.to(campaignRoom(auth.campaignId)).emit("chat:created", envelope);
      else {
        io.to(gmRoom(auth.campaignId)).emit("chat:created", envelope);
        io.to(memberRoom(auth.membershipId)).emit("chat:created", envelope);
      }
      return reply.code(201).send(dto);
    } catch (error) {
      if (error instanceof DiceFormulaError)
        return reply
          .code(400)
          .send({ error: "INVALID_DICE_FORMULA", message: error.message });
      throw error;
    }
  });

  app.post("/api/assets", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z.object({ kind: assetKindSchema }).parse(request.query);
    if (auth.role !== "GM" && !["TOKEN", "PORTRAIT"].includes(query.kind))
      return reply.code(403).send({ error: "ASSET_FORBIDDEN" });
    const actionId = actionIdSchema.parse(request.headers["x-action-id"]);
    const duplicate = await findAction(db, auth.campaignId, actionId);
    if (duplicate?.entityId) {
      const [existing] = await db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, duplicate.entityId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (existing) return reply.code(200).send(existing);
    }
    const file = await request.file({
      limits: {
        fileSize:
          query.kind === "AUDIO" ? env.MAX_AUDIO_BYTES : env.MAX_IMAGE_BYTES,
        files: 1,
      },
    });
    if (!file) return reply.code(400).send({ error: "FILE_REQUIRED" });
    const buffer = await file.toBuffer();
    const [usage] = await db
      .select({ used: sum(assets.sizeBytes) })
      .from(assets)
      .where(eq(assets.campaignId, auth.campaignId));
    await assertStorageCapacity(Number(usage?.used ?? 0), buffer.length);
    try {
      const stored = await storeUpload(
        buffer,
        query.kind === "AUDIO" ? "audio" : "image",
      );
      const asset = await db
        .transaction(async (tx) => {
          const [created] = await tx
            .insert(assets)
            .values({
              campaignId: auth.campaignId,
              uploadedByMembershipId: auth.membershipId,
              kind: query.kind,
              name: displayNameFromUpload(file.filename),
              ...stored,
            })
            .returning();
          if (!created) throw new Error("ASSET_CREATE_FAILED");
          await tx.insert(gameEvents).values({
            campaignId: auth.campaignId,
            actionId,
            membershipId: auth.membershipId,
            type: "asset.created",
            entityType: "asset",
            entityId: created.id,
            payload: { assetId: created.id, kind: created.kind },
          });
          return created;
        })
        .catch(async (error) => {
          await removeStoredUpload(stored.storageKey);
          throw error;
        });
      await broadcastSnapshots(io, db, auth.campaignId);
      return reply.code(201).send(asset);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get("/api/assets/:id/content", async (request, reply) => {
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
    try {
      const file = await openStoredFile(
        asset.storageKey,
        request.headers.range,
      );
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", asset.mimeType);
      reply.header("Cache-Control", "private, max-age=86400");
      reply.header("Content-Length", String(file.end - file.start + 1));
      if (file.partial) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${file.start}-${file.end}/${file.size}`,
        );
      }
      return reply.send(file.stream);
    } catch (error) {
      if (errorMessage(error) === "INVALID_RANGE")
        return reply.code(416).send({ error: "INVALID_RANGE" });
      return reply.code(404).send({ error: "ASSET_CONTENT_NOT_FOUND" });
    }
  });
}
