import type { FastifyBaseLogger } from "fastify";
import type { Server } from "socket.io";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  audioStates,
  actionJournal,
  assets,
  campaigns,
  gameEvents,
  memberships,
  scenes,
  tokenControllers,
  tokenDefinitions,
  tokens,
} from "@arken/db";
import type {
  AudioStateDto,
  ClientToServerEvents,
  EventEnvelope,
  ServerToClientEvents,
  TokenDto,
} from "@arken/contracts";
import {
  audioStateUpdateSchema,
  moveTokenSchema,
  rulerUpdateSchema,
} from "@arken/contracts";
import type { AuthContext, SessionAuthContext } from "./auth.js";
import { authFromSessionToken, sessionIsActive } from "./auth.js";
import { env } from "./env.js";
import { buildSnapshot } from "./snapshot.js";
import { cookieValue } from "./security.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import { effectiveAudioPosition, ensureAudioDuration } from "./audio-state.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

const campaignRoom = (campaignId: string) => `campaign:${campaignId}`;
const gmRoom = (campaignId: string) => `campaign:${campaignId}:gm`;
const memberRoom = (membershipId: string) => `member:${membershipId}`;
const sessionRoom = (sessionId: string) => `session:${sessionId}`;

type EditableToken = typeof tokens.$inferSelect & {
  controllerMembershipIds: string[];
  definitionRevision: number;
};
function tokenDto(token: EditableToken): TokenDto {
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
    revision: state.revision,
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
      definition: tokenDefinitions,
    })
    .from(tokens)
    .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
    .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
    .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
    .where(eq(tokens.id, tokenId))
    .limit(1);
  if (
    !row ||
    row.campaignId !== auth.campaignId ||
    row.definition.campaignId !== auth.campaignId
  )
    return null;
  const controllers = await db
    .select({ membershipId: tokenControllers.membershipId })
    .from(tokenControllers)
    .where(eq(tokenControllers.tokenDefinitionId, row.definition.id));
  const controllerMembershipIds = controllers.map((item) => item.membershipId);
  if (
    auth.role !== "GM" &&
    (!controllerMembershipIds.includes(auth.membershipId) ||
      row.token.locked ||
      !row.token.visible ||
      row.token.layer === "GM" ||
      row.token.sceneId !== row.activeSceneId)
  )
    return null;
  return {
    ...row.token,
    characterId: row.definition.characterId,
    assetId: row.definition.defaultAssetId,
    name: row.definition.name,
    controllerMembershipIds,
    definitionRevision: row.definition.revision,
  };
}

async function tokenAudienceRoom(
  db: Database,
  campaignId: string,
  token: EditableToken,
) {
  if (!token.visible || token.layer === "GM") return gmRoom(campaignId);
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
  io.to(gmRoom(campaignId)).emit(
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
  const presenceGraceMs = 750;
  const pendingPresence = new Map<string, ReturnType<typeof setTimeout>>();
  const presenceKey = (campaignId: string, membershipId: string) =>
    `${campaignId}:${membershipId}`;

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
    // Join the session room before any other async setup. Logout can then
    // target this socket even while the rest of the connection is pending.
    await socket.join(sessionRoom(auth.sessionId));
    if (!(await sessionIsActive(db, auth.sessionId)) || !socket.connected) {
      socket.disconnect(true);
      return;
    }
    // Room-based disconnects handle normal logout. This guard also rejects an
    // event that was queued while connection setup raced with session removal.
    socket.use((_event, next) => {
      void sessionIsActive(db, auth.sessionId).then(
        (active) => {
          if (!active) {
            socket.disconnect(true);
            next(new Error("AUTH_REQUIRED"));
            return;
          }
          next();
        },
        (error) => next(error as Error),
      );
    });
    const pending = pendingPresence.get(
      presenceKey(auth.campaignId, auth.membershipId),
    );
    if (pending) {
      clearTimeout(pending);
      pendingPresence.delete(presenceKey(auth.campaignId, auth.membershipId));
    }
    await socket.join(campaignRoom(auth.campaignId));
    await socket.join(memberRoom(auth.membershipId));
    if (auth.role === "GM") await socket.join(gmRoom(auth.campaignId));
    const snapshot = await buildSnapshot(db, auth);
    if (!(await sessionIsActive(db, auth.sessionId)) || !socket.connected) {
      socket.disconnect(true);
      return;
    }
    socket.emit("game:snapshot", snapshot);
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
        await invalidateRedoBranch(tx, auth, current.sceneId);
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
        await tx.insert(actionJournal).values({
          campaignId: auth.campaignId,
          sceneId: current.sceneId,
          actorMembershipId: auth.membershipId,
          actionId: command.actionId,
          scope: current.layer === "GM" ? "GM" : "PUBLIC",
          type: "TOKEN_MOVE",
          targetType: "TOKEN",
          targetId: current.id,
          before: {
            x: current.x,
            y: current.y,
            z: current.z,
            levelId: current.levelId,
          },
          after: {
            x: updated.x,
            y: updated.y,
            z: updated.z,
            levelId: updated.levelId,
          },
          beforeRevision: current.revision,
          afterRevision: updated.revision,
          currentRevision: updated.revision,
        });
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
      const dto = tokenDto({
        ...result.updated,
        controllerMembershipIds: current.controllerMembershipIds,
        definitionRevision: current.definitionRevision,
      });
      const audience = await tokenAudienceRoom(db, auth.campaignId, {
        ...result.updated,
        controllerMembershipIds: current.controllerMembershipIds,
        definitionRevision: current.definitionRevision,
      });
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
      const command = parsed.data;
      const { actionId } = command;
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
        const recorded = existing.payload as { result?: AudioStateDto } | null;
        const [current] = await db
          .select()
          .from(audioStates)
          .where(eq(audioStates.campaignId, auth.campaignId))
          .limit(1);
        return ack?.({
          ok: true,
          status: "DUPLICATE",
          sequence: existing.sequence,
          ...(recorded?.result
            ? { data: recorded.result }
            : current
              ? { data: audioDto(current) }
              : {}),
        });
      }
      const [preCommandState] = await db
        .select({ assetId: audioStates.assetId })
        .from(audioStates)
        .where(eq(audioStates.campaignId, auth.campaignId))
        .limit(1);
      const ensuredDuration = preCommandState?.assetId
        ? await ensureAudioDuration(db, preCommandState.assetId)
        : null;

      const result = await db.transaction(async (tx) => {
        const requestedAssetId =
          "command" in command && command.command === "SELECT"
            ? command.assetId
            : "command" in command
              ? undefined
              : command.assetId;
        if (requestedAssetId) {
          const [asset] = await tx
            .select({ campaignId: assets.campaignId, kind: assets.kind })
            .from(assets)
            .where(eq(assets.id, requestedAssetId))
            .limit(1);
          if (
            !asset ||
            asset.campaignId !== auth.campaignId ||
            asset.kind !== "AUDIO"
          ) {
            return { rejection: "ASSET_NOT_FOUND" as const };
          }
        }
        await tx
          .insert(audioStates)
          .values({
            campaignId: auth.campaignId,
            assetId: null,
            playing: false,
            positionSeconds: 0,
            loop: false,
            startedAt: null,
            revision: 0,
          })
          .onConflictDoNothing();
        const [current] = await tx
          .select()
          .from(audioStates)
          .where(eq(audioStates.campaignId, auth.campaignId))
          .limit(1);
        if (!current) return null;

        const expectedRevision =
          "command" in command ? command.revision : current.revision;
        if (current.revision !== expectedRevision) {
          return { rejection: "REVISION_CONFLICT" as const, current };
        }

        const [selectedAsset] = current.assetId
          ? await tx
              .select({ durationSeconds: assets.durationSeconds })
              .from(assets)
              .where(eq(assets.id, current.assetId))
              .limit(1)
          : [];
        const durationSeconds = current.assetId
          ? (selectedAsset?.durationSeconds ?? ensuredDuration)
          : null;
        const now = new Date();
        const effectivePosition = effectiveAudioPosition(
          current,
          now,
          durationSeconds,
        );
        const deadlineElapsed = Boolean(
          current.playing &&
          !current.loop &&
          current.startedAt &&
          durationSeconds &&
          effectivePosition >= durationSeconds,
        );
        const logicalPlaying = deadlineElapsed ? false : current.playing;
        let next = {
          assetId: current.assetId,
          playing: logicalPlaying,
          positionSeconds: effectivePosition,
          loop: current.loop,
          startedAt: logicalPlaying ? now : null,
        };

        if ("command" in command) {
          switch (command.command) {
            case "SELECT":
              next = {
                ...next,
                assetId: command.assetId,
                playing: command.assetId ? logicalPlaying : false,
                positionSeconds: 0,
                startedAt: command.assetId && logicalPlaying ? now : null,
              };
              break;
            case "PLAY":
              if (!current.assetId || !durationSeconds) {
                return { rejection: "AUDIO_NOT_SELECTED" as const };
              }
              next = {
                ...next,
                playing: true,
                positionSeconds:
                  effectivePosition >= durationSeconds ? 0 : effectivePosition,
                startedAt: now,
              };
              break;
            case "PAUSE":
              next = { ...next, playing: false, startedAt: null };
              break;
            case "SEEK":
              next = {
                ...next,
                positionSeconds: durationSeconds
                  ? Math.min(command.positionSeconds, durationSeconds)
                  : command.positionSeconds,
                startedAt: logicalPlaying ? now : null,
              };
              break;
            case "SET_LOOP":
              next = { ...next, loop: command.loop };
              break;
            case "END":
              if (
                !current.assetId ||
                (!logicalPlaying && !deadlineElapsed) ||
                current.loop
              ) {
                return { rejection: "AUDIO_END_NOT_APPLICABLE" as const };
              }
              next = { ...next, playing: false, startedAt: null };
              break;
          }
        } else {
          // Compatibility path: the client timestamp is deliberately ignored.
          next = {
            assetId: command.assetId,
            playing: command.assetId ? command.playing : false,
            positionSeconds: command.positionSeconds,
            loop: command.loop,
            startedAt: command.assetId && command.playing ? now : null,
          };
        }

        const [state] = await tx
          .update(audioStates)
          .set({
            ...next,
            revision: current.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(audioStates.campaignId, auth.campaignId),
              eq(audioStates.revision, current.revision),
            ),
          )
          .returning();
        if (!state) {
          return { rejection: "REVISION_CONFLICT" as const, current };
        }
        const [event] = await tx
          .insert(gameEvents)
          .values({
            campaignId: auth.campaignId,
            actionId,
            membershipId: auth.membershipId,
            type: "AUDIO_COMMAND",
            entityType: "AUDIO_STATE",
            entityId: auth.campaignId,
            payload: { command, result: audioDto(state) },
          })
          .returning();
        return event ? { event, state } : null;
      });
      if (result && "rejection" in result) {
        return ack?.({
          ok: false,
          status:
            result.rejection === "REVISION_CONFLICT" ? "CONFLICT" : "INVALID",
          reason: result.rejection,
          ...(result.rejection === "REVISION_CONFLICT" && result.current
            ? { data: audioDto(result.current) }
            : {}),
        });
      }
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

    socket.on("ruler:update", async (input) => {
      const parsed = rulerUpdateSchema.safeParse(input);
      if (!parsed.success) return;
      const [scene] = await db
        .select({ id: scenes.id, grid: scenes.grid })
        .from(scenes)
        .where(
          and(
            eq(scenes.id, parsed.data.sceneId),
            eq(scenes.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!scene) return;
      const dx = parsed.data.endX - parsed.data.startX;
      const dy = parsed.data.endY - parsed.data.startY;
      io.to(campaignRoom(auth.campaignId)).emit("ruler:updated", {
        ...parsed.data,
        membershipId: auth.membershipId,
        displayName: auth.displayName,
        distance:
          Math.hypot(dx, dy) / (scene.grid.enabled ? scene.grid.size : 1),
      });
    });

    socket.on("ruler:clear", async (input) => {
      const parsed = z.object({ sceneId: z.string().uuid() }).safeParse(input);
      if (!parsed.success) return;
      const [scene] = await db
        .select({ id: scenes.id })
        .from(scenes)
        .where(
          and(
            eq(scenes.id, parsed.data.sceneId),
            eq(scenes.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!scene) return;
      io.to(campaignRoom(auth.campaignId)).emit("ruler:cleared", {
        sceneId: scene.id,
        membershipId: auth.membershipId,
      });
    });

    socket.on("map:ping", async (input, ack) => {
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y))
        return ack?.({ ok: false, reason: "INVALID_PING" });
      const [scene] = await db
        .select({ sceneId: scenes.id, activeSceneId: campaigns.activeSceneId })
        .from(scenes)
        .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
        .where(
          and(
            eq(scenes.id, input.sceneId),
            eq(scenes.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!scene) return ack?.({ ok: false, reason: "SCENE_NOT_FOUND" });
      const isPlayerScene = scene.sceneId === scene.activeSceneId;
      if (auth.role === "PLAYER" && !isPlayerScene)
        return ack?.({ ok: false, reason: "SCENE_NOT_ACTIVE" });
      const recipients = isPlayerScene
        ? (await io.in(campaignRoom(auth.campaignId)).fetchSockets())
            .filter((candidate) => candidate.data.auth.role === "PLAYER")
            .map((candidate) => candidate.data.auth.membershipId)
        : [];
      const uniqueRecipients = [...new Set(recipients)];
      const ping = {
        sceneId: scene.sceneId,
        membershipId: auth.membershipId,
        displayName: auth.displayName,
        x: input.x,
        y: input.y,
        createdAt: new Date().toISOString(),
      };
      // GMs always receive their own ping; an empty player audience is still
      // reported explicitly so it cannot be mistaken for a delivery failure.
      if (auth.role === "GM" && uniqueRecipients.length === 0) {
        io.to(gmRoom(auth.campaignId)).emit("map:ping", ping);
        return ack?.({ ok: false, reason: "NO_VISIBLE_PLAYERS" });
      }
      for (const membershipId of uniqueRecipients)
        io.to(memberRoom(membershipId)).emit("map:ping", ping);
      io.to(gmRoom(auth.campaignId)).emit("map:ping", ping);
      ack?.({ ok: true });
    });

    socket.on("disconnect", (reason) => {
      log.info(
        {
          membershipId: auth.membershipId,
          campaignId: auth.campaignId,
          reason,
        },
        "realtime.disconnected",
      );
      const key = presenceKey(auth.campaignId, auth.membershipId);
      const previous = pendingPresence.get(key);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => {
        pendingPresence.delete(key);
        void emitPresence(io, db, auth.campaignId).catch((error) =>
          log.warn(
            { error, campaignId: auth.campaignId },
            "realtime.presence_emit_failed",
          ),
        );
      }, presenceGraceMs);
      timer.unref();
      pendingPresence.set(key, timer);
    });
  });

  return { campaignRoom, gmRoom, memberRoom, sessionRoom };
}

declare module "socket.io" {
  interface SocketData {
    auth: SessionAuthContext;
  }
}
