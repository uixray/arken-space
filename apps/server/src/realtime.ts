import type { FastifyBaseLogger } from "fastify";
import type { Server } from "socket.io";
import { and, eq } from "drizzle-orm";
import {
  audioStates,
  campaigns,
  gameEvents,
  memberships,
  scenes,
  tokens,
} from "@arken/db";
import type {
  AudioStateDto,
  ClientToServerEvents,
  EventEnvelope,
  ServerToClientEvents,
  TokenDto,
} from "@arken/contracts";
import { audioStateUpdateSchema, moveTokenSchema } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { authFromSessionToken } from "./auth.js";
import { env } from "./env.js";
import { buildSnapshot } from "./snapshot.js";
import { cookieValue } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

const campaignRoom = (campaignId: string) => `campaign:${campaignId}`;
const gmRoom = (campaignId: string) => `campaign:${campaignId}:gm`;
const memberRoom = (membershipId: string) => `member:${membershipId}`;

function tokenDto(token: typeof tokens.$inferSelect): TokenDto {
  const { updatedAt: _updatedAt, ...dto } = token;
  return dto;
}

function audioDto(state: typeof audioStates.$inferSelect): AudioStateDto {
  return {
    assetId: state.assetId,
    playing: state.playing,
    positionSeconds: state.positionSeconds,
    loop: state.loop,
    startedAt: state.startedAt?.toISOString() ?? null,
    updatedAt: state.updatedAt.toISOString(),
  };
}

function envelope<T>(
  sequence: number,
  actionId: string,
  data: T,
): EventEnvelope<T> {
  return { sequence, actionId, data, emittedAt: new Date().toISOString() };
}

export async function editableToken(
  db: Database,
  auth: AuthContext,
  tokenId: string,
) {
  const [row] = await db
    .select({
      token: tokens,
      campaignId: scenes.campaignId,
      activeSceneId: campaigns.activeSceneId,
    })
    .from(tokens)
    .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
    .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
    .where(eq(tokens.id, tokenId))
    .limit(1);
  if (!row || row.campaignId !== auth.campaignId) return null;
  if (
    auth.role !== "GM" &&
    (row.token.ownerMembershipId !== auth.membershipId ||
      row.token.locked ||
      !row.token.visible ||
      row.token.sceneId !== row.activeSceneId)
  )
    return null;
  return row.token;
}

async function tokenAudienceRoom(
  db: Database,
  campaignId: string,
  token: typeof tokens.$inferSelect,
) {
  if (!token.visible) return gmRoom(campaignId);
  const [campaign] = await db
    .select({ activeSceneId: campaigns.activeSceneId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return campaign?.activeSceneId === token.sceneId
    ? campaignRoom(campaignId)
    : gmRoom(campaignId);
}

async function emitPresence(
  io: RealtimeServer,
  db: Database,
  campaignId: string,
) {
  const [memberRows, sockets] = await Promise.all([
    db
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.campaignId, campaignId)),
    io.in(campaignRoom(campaignId)).fetchSockets(),
  ]);
  const online = new Set(
    sockets.map((socket) => socket.data.auth.membershipId),
  );
  io.to(campaignRoom(campaignId)).emit(
    "presence:updated",
    memberRows.map((member) => ({
      membershipId: member.id,
      online: online.has(member.id),
    })),
  );
}

export function registerRealtime(
  io: RealtimeServer,
  db: Database,
  log: FastifyBaseLogger,
) {
  io.use(async (socket, next) => {
    try {
      const token = cookieValue(
        socket.handshake.headers.cookie,
        env.SESSION_COOKIE_NAME,
      );
      const auth = await authFromSessionToken(db, token);
      if (!auth) return next(new Error("AUTH_REQUIRED"));
      socket.data.auth = auth;
      next();
    } catch (error) {
      next(error as Error);
    }
  });

  io.on("connection", async (socket) => {
    const auth = socket.data.auth;
    await socket.join(campaignRoom(auth.campaignId));
    await socket.join(memberRoom(auth.membershipId));
    if (auth.role === "GM") await socket.join(gmRoom(auth.campaignId));
    socket.emit("game:snapshot", await buildSnapshot(db, auth));
    await emitPresence(io, db, auth.campaignId);
    log.info(
      {
        membershipId: auth.membershipId,
        campaignId: auth.campaignId,
        socketId: socket.id,
      },
      "realtime.connected",
    );

    socket.on("game:resync", async (knownSequence) => {
      const snapshot = await buildSnapshot(db, auth);
      log.info(
        {
          membershipId: auth.membershipId,
          campaignId: auth.campaignId,
          knownSequence,
          snapshotVersion: snapshot.snapshotVersion,
        },
        "realtime.resync",
      );
      socket.emit("game:snapshot", snapshot);
    });

    socket.on("token:moving", async (input) => {
      const parsed = moveTokenSchema.safeParse(input);
      if (!parsed.success) return;
      const token = await editableToken(db, auth, parsed.data.tokenId);
      if (!token) return;
      const audience = await tokenAudienceRoom(db, auth.campaignId, token);
      socket.to(audience).emit("token:moving", parsed.data);
    });

    socket.on("token:moved", async (input, ack) => {
      const parsed = moveTokenSchema.safeParse(input);
      if (!parsed.success) {
        return ack?.({
          ok: false,
          status: "INVALID",
          reason: "INVALID_COMMAND",
        });
      }
      const command = parsed.data;
      const [existing] = await db
        .select()
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.actionId, command.actionId),
          ),
        )
        .limit(1);
      if (existing) {
        const current = await editableToken(db, auth, command.tokenId);
        return ack?.({
          ok: true,
          status: "DUPLICATE",
          sequence: existing.sequence,
          ...(current ? { data: tokenDto(current) } : {}),
        });
      }

      const current = await editableToken(db, auth, command.tokenId);
      if (!current) {
        log.warn(
          {
            actionId: command.actionId,
            membershipId: auth.membershipId,
            tokenId: command.tokenId,
          },
          "command.token_move.forbidden",
        );
        return ack?.({
          ok: false,
          status: "FORBIDDEN",
          reason: "TOKEN_FORBIDDEN",
        });
      }
      if (current.revision !== command.revision) {
        return ack?.({
          ok: false,
          status: "CONFLICT",
          reason: "STALE_REVISION",
          data: tokenDto(current),
        });
      }

      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(tokens)
          .set({
            x: command.x,
            y: command.y,
            z: command.z,
            levelId: command.levelId,
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tokens.id, current.id),
              eq(tokens.revision, current.revision),
            ),
          )
          .returning();
        if (!updated) return null;
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId: command.actionId,
            membershipId: auth.membershipId,
            type: "TOKEN_MOVED",
            entityType: "TOKEN",
            entityId: updated.id,
            entityRevision: updated.revision,
            payload: {
              x: updated.x,
              y: updated.y,
              z: updated.z,
              levelId: updated.levelId,
            },
          })
          .returning();
        return event ? { event, updated } : null;
      });

      if (!result) {
        const latest = await editableToken(db, auth, command.tokenId);
        return ack?.({
          ok: false,
          status: "CONFLICT",
          reason: "CONCURRENT_UPDATE",
          ...(latest ? { data: tokenDto(latest) } : {}),
        });
      }
      const dto = tokenDto(result.updated);
      const audience = await tokenAudienceRoom(
        db,
        auth.campaignId,
        result.updated,
      );
      io.to(audience).emit(
        "token:moved",
        envelope(result.event.sequence, command.actionId, dto),
      );
      log.info(
        {
          actionId: command.actionId,
          sequence: result.event.sequence,
          membershipId: auth.membershipId,
          tokenId: dto.id,
          revision: dto.revision,
        },
        "command.token_move.accepted",
      );
      ack?.({
        ok: true,
        status: "ACCEPTED",
        sequence: result.event.sequence,
        data: dto,
      });
    });

    socket.on("audio:set", async (input, ack) => {
      if (auth.role !== "GM") {
        return ack?.({ ok: false, status: "FORBIDDEN", reason: "GM_REQUIRED" });
      }
      const parsed = audioStateUpdateSchema.safeParse(input);
      if (!parsed.success) {
        return ack?.({
          ok: false,
          status: "INVALID",
          reason: "INVALID_COMMAND",
        });
      }
      const { actionId, ...stateInput } = parsed.data;
      const [existing] = await db
        .select()
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.actionId, actionId),
          ),
        )
        .limit(1);
      if (existing) {
        const [current] = await db
          .select()
          .from(audioStates)
          .where(eq(audioStates.campaignId, auth.campaignId))
          .limit(1);
        return ack?.({
          ok: true,
          status: "DUPLICATE",
          sequence: existing.sequence,
          ...(current ? { data: audioDto(current) } : {}),
        });
      }

      const result = await db.transaction(async (tx) => {
        const [state] = await tx
          .insert(audioStates)
          .values({
            campaignId: auth.campaignId,
            ...stateInput,
            startedAt: stateInput.startedAt
              ? new Date(stateInput.startedAt)
              : null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: audioStates.campaignId,
            set: {
              ...stateInput,
              startedAt: stateInput.startedAt
                ? new Date(stateInput.startedAt)
                : null,
              updatedAt: new Date(),
            },
          })
          .returning();
        if (!state) return null;
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId,
            membershipId: auth.membershipId,
            type: "AUDIO_STATE_SET",
            entityType: "AUDIO_STATE",
            entityId: auth.campaignId,
            payload: stateInput,
          })
          .returning();
        return event ? { event, state } : null;
      });
      if (!result) {
        return ack?.({
          ok: false,
          status: "CONFLICT",
          reason: "AUDIO_UPDATE_FAILED",
        });
      }
      const dto = audioDto(result.state);
      io.to(campaignRoom(auth.campaignId)).emit(
        "audio:state",
        envelope(result.event.sequence, actionId, dto),
      );
      ack?.({
        ok: true,
        status: "ACCEPTED",
        sequence: result.event.sequence,
        data: dto,
      });
    });

    socket.on("map:ping", async (input) => {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
      const [active] = await db
        .select({ sceneId: scenes.id })
        .from(scenes)
        .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
        .where(
          and(
            eq(scenes.id, input.sceneId),
            eq(scenes.campaignId, auth.campaignId),
            eq(campaigns.activeSceneId, scenes.id),
          ),
        )
        .limit(1);
      if (!active) return;
      io.to(campaignRoom(auth.campaignId)).emit("map:ping", {
        sceneId: active.sceneId,
        membershipId: auth.membershipId,
        displayName: auth.displayName,
        x: input.x,
        y: input.y,
        createdAt: new Date().toISOString(),
      });
    });

    socket.on("disconnect", async (reason) => {
      log.info(
        {
          membershipId: auth.membershipId,
          campaignId: auth.campaignId,
          reason,
        },
        "realtime.disconnected",
      );
      await emitPresence(io, db, auth.campaignId);
    });
  });

  return { campaignRoom, gmRoom, memberRoom };
}

declare module "socket.io" {
  interface SocketData {
    auth: AuthContext;
  }
}
