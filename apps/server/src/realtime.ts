import type { FastifyBaseLogger } from "fastify";
import type { Server } from "socket.io";
import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import {
  campaignAudioTracks,
  actionJournal,
  assets,
  campaigns,
  characters,
  fogReveals,
  gameEvents,
  memberships,
  scenes,
  tokenControllers,
  tokenDefinitions,
  tokens,
} from "@arken/db";
import type {
  AudioStateDto,
  AudioTrackDto,
  ClientToServerEvents,
  EventEnvelope,
  ServerToClientEvents,
  TokenDto,
} from "@arken/contracts";
import {
  audioStateUpdateSchema,
  audioTrackCommandSchema,
  cursorMoveSchema,
  fogHiddenTokenIds,
  moveTokenSchema,
  rulerPolylineDistance,
  rulerUpdateSchema,
  sceneViewSchema,
} from "@arken/contracts";
import type { AuthContext, SessionAuthContext } from "./auth.js";
import { authFromSessionToken, sessionIsActive } from "./auth.js";
import { env } from "./env.js";
import { buildSnapshot } from "./snapshot.js";
import { resolveTokenName } from "./token-name.js";
import { cookieValue } from "./security.js";
import { invalidateRedoBranch } from "./canvas-history.js";
import { normalizeTokenConditions } from "./token-conditions.js";
import { effectiveAudioPosition, ensureAudioDuration } from "./audio-state.js";

/** UIX-382: hard cap on concurrently active tracks in the mixer. */
const MAX_AUDIO_TRACKS = 4;

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

const campaignRoom = (campaignId: string) => `campaign:${campaignId}`;
const gmRoom = (campaignId: string) => `campaign:${campaignId}:gm`;
const memberRoom = (membershipId: string) => `member:${membershipId}`;
const sessionRoom = (sessionId: string) => `session:${sessionId}`;

type EditableToken = Omit<typeof tokens.$inferSelect, "name"> & {
  /** UIX-400: разрешённое имя — своё либо унаследованное от персонажа. */
  name: string;
  controllerMembershipIds: string[];
  definitionRevision: number;
};
function tokenDto(token: EditableToken): TokenDto {
  const { updatedAt: _updatedAt, ...dto } = token;
  // UIX-471: состояния приходят из `jsonb` и разбираются схемой — см.
  // `normalizeTokenConditions`.
  return { ...dto, conditions: normalizeTokenConditions(dto.conditions) };
}

type AudioTrackRow = typeof campaignAudioTracks.$inferSelect;

/** UIX-382 compat: the legacy singular shape, derived from a single track row. */
function audioDto(state: AudioTrackRow): AudioStateDto {
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

function audioTrackDto(state: AudioTrackRow): AudioTrackDto {
  return {
    id: state.id,
    assetId: state.assetId,
    mixVolume: state.mixVolume,
    playing: state.playing,
    positionSeconds: state.positionSeconds,
    loop: state.loop,
    startedAt: state.startedAt?.toISOString() ?? null,
    slotOrder: state.slotOrder,
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

/**
 * Current campaign-scoped token projection, independent of mutation rights.
 *
 * Definition-owned fields can change without touching the placement row. Keep
 * this projection reusable so a successful mutation can re-read the canonical
 * definition after commit instead of publishing the pre-transaction snapshot.
 */
async function projectedToken(
  db: Database,
  campaignId: string,
  tokenId: string,
) {
  const [row] = await db
    .select({
      token: tokens,
      campaignId: scenes.campaignId,
      activeSceneId: campaigns.activeSceneId,
      definition: tokenDefinitions,
      // UIX-400: имя персонажа нужно здесь же — определение может не иметь
      // своего, и тогда подпись наследуется. Внешнее соединение, потому что
      // персонаж необязателен.
      characterName: characters.name,
    })
    .from(tokens)
    .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
    .innerJoin(campaigns, eq(scenes.campaignId, campaigns.id))
    .innerJoin(tokenDefinitions, eq(tokens.definitionId, tokenDefinitions.id))
    .leftJoin(characters, eq(tokenDefinitions.characterId, characters.id))
    .where(eq(tokens.id, tokenId))
    .limit(1);
  if (
    !row ||
    row.campaignId !== campaignId ||
    row.definition.campaignId !== campaignId
  )
    return null;
  const controllers = await db
    .select({ membershipId: tokenControllers.membershipId })
    .from(tokenControllers)
    .where(eq(tokenControllers.tokenDefinitionId, row.definition.id));
  const controllerMembershipIds = controllers.map((item) => item.membershipId);
  return {
    token: {
      ...row.token,
      characterId: row.definition.characterId,
      assetId: row.definition.defaultAssetId,
      name: resolveTokenName({
        name: row.definition.name,
        characterName: row.characterName,
      }),
      controllerMembershipIds,
      definitionRevision: row.definition.revision,
    } satisfies EditableToken,
    activeSceneId: row.activeSceneId,
  };
}

function canEditProjectedToken(
  auth: AuthContext,
  projection: Awaited<ReturnType<typeof projectedToken>>,
) {
  if (!projection) return false;
  const { token, activeSceneId } = projection;
  return (
    auth.role === "GM" ||
    (token.controllerMembershipIds.includes(auth.membershipId) &&
      !token.locked &&
      token.visible &&
      token.layer !== "GM" &&
      token.sceneId === activeSceneId)
  );
}

function tokenIsCampaignVisible(
  token: EditableToken,
  activeSceneId: string | null,
) {
  return (
    token.visible && token.layer !== "GM" && token.sceneId === activeSceneId
  );
}

type FogRowsByScene = Map<string, (typeof fogReveals.$inferSelect)[]>;

/**
 * Fog is ordered event state: later COVER/REVEAL operations override earlier
 * ones. Read only the token scenes and preserve that canonical sequence.
 */
async function fogRowsForTokens(
  db: Database,
  tokenRows: readonly EditableToken[],
): Promise<FogRowsByScene> {
  const sceneIds = [...new Set(tokenRows.map((token) => token.sceneId))];
  const byScene: FogRowsByScene = new Map();
  if (sceneIds.length === 0) return byScene;
  const rows = await db
    .select()
    .from(fogReveals)
    .where(inArray(fogReveals.sceneId, sceneIds))
    .orderBy(asc(fogReveals.sequence));
  for (const row of rows) {
    const sceneRows = byScene.get(row.sceneId) ?? [];
    sceneRows.push(row);
    byScene.set(row.sceneId, sceneRows);
  }
  return byScene;
}

function tokensAreFogVisibleTo(
  tokenRows: readonly EditableToken[],
  fogByScene: FogRowsByScene,
  viewer: { role: "GM" | "PLAYER"; membershipId: string },
) {
  return tokenRows.every(
    (token) =>
      !fogHiddenTokenIds(
        [token],
        fogByScene.get(token.sceneId) ?? [],
        viewer,
      ).has(token.id),
  );
}

type TokenDelivery = {
  rooms: string[];
  fogByScene: FogRowsByScene;
};

/**
 * Mirror the snapshot's UIX-449 visibility for realtime projections.
 *
 * A fully covered token cannot use the campaign room because control is
 * membership-specific: its current controllers still see it, other players
 * do not. The impossible non-UUID viewer below asks the shared canonical rule
 * whether a player who controls none of the token rows can see all of them.
 */
async function tokenDelivery(
  db: Database,
  campaignId: string,
  tokenRows: readonly EditableToken[],
  activeSceneId: string | null,
  controllerMembershipIds: readonly string[],
): Promise<TokenDelivery> {
  if (!tokenRows.every((token) => tokenIsCampaignVisible(token, activeSceneId)))
    return { rooms: [gmRoom(campaignId)], fogByScene: new Map() };

  const fogByScene = await fogRowsForTokens(db, tokenRows);
  const campaignVisible = tokensAreFogVisibleTo(tokenRows, fogByScene, {
    role: "PLAYER",
    membershipId: "__campaign-fog-viewer__",
  });
  if (campaignVisible) return { rooms: [campaignRoom(campaignId)], fogByScene };

  return {
    rooms: [
      gmRoom(campaignId),
      ...new Set(controllerMembershipIds.map(memberRoom)),
    ],
    fogByScene,
  };
}

export async function editableToken(
  db: Database,
  auth: AuthContext,
  tokenId: string,
) {
  const projection = await projectedToken(db, auth.campaignId, tokenId);
  if (!projection) return null;
  return canEditProjectedToken(auth, projection) ? projection.token : null;
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
  runtime: {
    sessionIsActive?: typeof sessionIsActive;
    buildSnapshot?: typeof buildSnapshot;
  } = {},
) {
  const checkSessionActive = runtime.sessionIsActive ?? sessionIsActive;
  const createSnapshot = runtime.buildSnapshot ?? buildSnapshot;
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
    // Room-based disconnects handle normal logout. This guard also rejects an
    // event that was queued while connection setup raced with session removal.
    socket.use((_event, next) => {
      void checkSessionActive(db, auth.sessionId).then(
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

    /**
     * `connect` is observable by the browser before this async connection
     * setup has finished. Register the view/resync listeners synchronously so
     * the client's reconnect handshake cannot disappear in that window, then
     * hold the work until the authenticated rooms and initial snapshot are
     * ready.
     */
    let resolveConnectionReady!: (ready: boolean) => void;
    const connectionReady = new Promise<boolean>((resolve) => {
      resolveConnectionReady = resolve;
    });
    let connectionReadySettled = false;
    const settleConnectionReady = (ready: boolean) => {
      if (connectionReadySettled) return;
      connectionReadySettled = true;
      resolveConnectionReady(ready);
    };
    type SceneViewIngress = {
      intent: number;
      data: z.infer<typeof sceneViewSchema>;
    };
    const sceneViewIngressByPayload = new WeakMap<object, SceneViewIngress>();
    let latestSceneViewIntent = 0;
    /**
     * Socket.IO invokes catch-all ingress listeners synchronously in packet
     * order, before its async `socket.use` chain. Assign the intent here so
     * two session checks resolving out of order cannot reverse the user's
     * scene selection.
     */
    socket.prependAny((event, payload) => {
      if (event !== "scene:view" || auth.role !== "GM") return;
      const parsed = sceneViewSchema.safeParse(payload);
      if (!parsed.success) return;
      const intent = ++latestSceneViewIntent;
      sceneViewIngressByPayload.set(payload as object, {
        intent,
        data: parsed.data,
      });
    });
    const viewedSceneId = () =>
      auth.role === "GM" ? (socket.data.viewedSceneId ?? null) : null;
    const viewedCanvasSceneIds = (sceneId = viewedSceneId()) =>
      sceneId ? [sceneId] : [];

    /**
     * UIX-408 — мастер сообщает, какую сцену рассматривает.
     *
     * Ответом идёт свежий снапшот **этому одному сокету**: смена
     * рассматриваемой сцены меняет то, что ему нужно (туман и рисунки другой
     * сцены), и это осознанное действие одного человека, а не повод для
     * рассылки всем.
     *
     * Счётчик намерений проверяется после каждого `await`. Иначе медленная
     * проверка/сборка первой сцены может завершиться после второй и вернуть
     * браузер к уже не выбранному канвасу.
     */
    const handleSceneView = async (
      view: z.infer<typeof sceneViewSchema>,
    ) => {
      // Игроку видима ровно активная сцена; принимать от него «смотрю другую»
      // значило бы дать способ запросить туман закрытой сцены.
      if (auth.role !== "GM") return;
      const ingress = sceneViewIngressByPayload.get(view);
      sceneViewIngressByPayload.delete(view);
      if (!ingress) return;
      const { intent, data } = ingress;
      if (!(await connectionReady) || !socket.connected) return;
      if (intent !== latestSceneViewIntent) return;

      const { sceneId } = data;
      if (sceneId) {
        const [scene] = await db
          .select({ id: scenes.id })
          .from(scenes)
          .where(
            and(eq(scenes.id, sceneId), eq(scenes.campaignId, auth.campaignId)),
          )
          .limit(1);
        if (intent !== latestSceneViewIntent || !socket.connected) return;
        // Чужая и несуществующая сцены имеют один исход — полную тишину.
        // Подтверждать различие значило бы дать oracle существования UUID.
        if (!scene) return;
      }

      const previousSceneId = viewedSceneId();
      socket.data.viewedSceneId = sceneId;
      let snapshot: Awaited<ReturnType<typeof buildSnapshot>>;
      try {
        snapshot = await createSnapshot(
          db,
          auth,
          viewedCanvasSceneIds(sceneId),
        );
      } catch (error) {
        // The optimistic socket state is authoritative input for resync. A
        // failed snapshot must not leave it pointing at a canvas the client
        // never received. Never roll a newer intent back from an older catch.
        if (
          intent === latestSceneViewIntent &&
          viewedSceneId() === sceneId
        )
          socket.data.viewedSceneId = previousSceneId;
        throw error;
      }
      if (
        intent !== latestSceneViewIntent ||
        viewedSceneId() !== sceneId ||
        !socket.connected
      )
        return;
      socket.emit("game:snapshot", snapshot);
    };
    socket.on("scene:view", (view) => {
      void handleSceneView(view).catch((error) =>
        log.warn(
          {
            errorKind: error instanceof Error ? error.name : typeof error,
            membershipId: auth.membershipId,
            campaignId: auth.campaignId,
          },
          "realtime.scene_view_failed",
        ),
      );
    });

    const handleGameResync = async (knownSequence?: number) => {
      if (!(await connectionReady) || !socket.connected) return;
      const intent = latestSceneViewIntent;
      const sceneId = viewedSceneId();
      const snapshot = await createSnapshot(
        db,
        auth,
        viewedCanvasSceneIds(sceneId),
      );
      // A newer scene:view emits its own authoritative snapshot. Letting this
      // older resync land afterwards would restore the previous canvas.
      if (
        intent !== latestSceneViewIntent ||
        viewedSceneId() !== sceneId ||
        !socket.connected
      )
        return;
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
    };
    socket.on("game:resync", (knownSequence) => {
      void handleGameResync(knownSequence).catch((error) =>
        log.warn(
          {
            errorKind: error instanceof Error ? error.name : typeof error,
            membershipId: auth.membershipId,
            campaignId: auth.campaignId,
          },
          "realtime.resync_failed",
        ),
      );
    });

    try {
      // Join the session room before any async database setup. Logout can then
      // target this socket even while the rest of the connection is pending.
      await socket.join(sessionRoom(auth.sessionId));
      if (!(await checkSessionActive(db, auth.sessionId)) || !socket.connected)
        throw new Error("AUTH_REQUIRED");
      await socket.join(campaignRoom(auth.campaignId));
      await socket.join(memberRoom(auth.membershipId));
      if (auth.role === "GM") await socket.join(gmRoom(auth.campaignId));
      // On a fresh transport viewedSceneId is unset, preserving the historical
      // active-scene initial snapshot. A reconnect intent captured by the early
      // listener runs after this gate and follows with its requested canvas.
      const snapshot = await createSnapshot(db, auth, viewedCanvasSceneIds());
      if (!(await checkSessionActive(db, auth.sessionId)) || !socket.connected)
        throw new Error("AUTH_REQUIRED");
      socket.emit("game:snapshot", snapshot);
      // Only a fully initialized replacement socket may cancel the old
      // transport's offline transition. A failed reconnect must leave that
      // timer intact so the membership eventually becomes offline.
      const pendingKey = presenceKey(
        auth.campaignId,
        auth.membershipId,
      );
      const pending = pendingPresence.get(pendingKey);
      if (pending) {
        clearTimeout(pending);
        pendingPresence.delete(pendingKey);
      }
      settleConnectionReady(true);
    } catch (error) {
      settleConnectionReady(false);
      log.warn(
        {
          error,
          membershipId: auth.membershipId,
          campaignId: auth.campaignId,
          socketId: socket.id,
        },
        "realtime.connection_setup_failed",
      );
      socket.disconnect(true);
      return;
    }
    // Presence is ancillary to command handling. Never let a failed matrix
    // refresh abort registration of the authoritative mutation listeners.
    void emitPresence(io, db, auth.campaignId).catch((error) =>
      log.warn(
        { error, campaignId: auth.campaignId },
        "realtime.presence_emit_failed",
      ),
    );
    log.info(
      {
        membershipId: auth.membershipId,
        campaignId: auth.campaignId,
        socketId: socket.id,
      },
      "realtime.connected",
    );

    socket.on("token:moving", async (input) => {
      const parsed = moveTokenSchema.safeParse(input);
      if (!parsed.success) return;
      const projection = await projectedToken(
        db,
        auth.campaignId,
        parsed.data.tokenId,
      );
      if (!canEditProjectedToken(auth, projection) || !projection) return;
      const previewToken = {
        ...projection.token,
        x: parsed.data.x,
        y: parsed.data.y,
        z: parsed.data.z,
        levelId: parsed.data.levelId,
      } satisfies EditableToken;
      // Check both current and preview coordinates. Either side being covered
      // makes a campaign-wide preview an information leak.
      const delivery = await tokenDelivery(
        db,
        auth.campaignId,
        [projection.token, previewToken],
        projection.activeSceneId,
        projection.token.controllerMembershipIds,
      );
      socket.to(delivery.rooms).emit("token:moving", parsed.data);
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
      /**
       * UIX-491: definition-owned fields are re-read after commit, but the
       * placement must remain the exact row committed by this event. A later
       * concurrent move must not be relabelled with this event's sequence.
       */
      const committedProjection = await projectedToken(
        db,
        auth.campaignId,
        command.tokenId,
      );
      // The placement was just updated in this handler, so absence here means
      // a concurrent delete won. Do not emit stale placement data that could
      // resurrect the deleted token on another client.
      if (!committedProjection) {
        return ack?.({
          ok: false,
          status: "CONFLICT",
          reason: "CONCURRENT_UPDATE",
        });
      }
      const latestToken = committedProjection.token;
      const movedToken = {
        ...result.updated,
        characterId: latestToken.characterId,
        assetId: latestToken.assetId,
        name: latestToken.name,
        controllerMembershipIds: latestToken.controllerMembershipIds,
        definitionRevision: latestToken.definitionRevision,
      } satisfies EditableToken;
      const dto = tokenDto(movedToken);
      // Never widen an older event after a concurrent visibility/scene change:
      // campaign broadcast is allowed only when both the event placement and
      // the latest canonical placement are currently campaign-visible.
      const delivery = await tokenDelivery(
        db,
        auth.campaignId,
        [movedToken, latestToken],
        committedProjection.activeSceneId,
        latestToken.controllerMembershipIds,
      );
      io.to(delivery.rooms).emit(
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
        ...(canEditProjectedToken(auth, committedProjection) &&
        tokensAreFogVisibleTo(
          [movedToken, latestToken],
          delivery.fogByScene,
          auth,
        )
          ? { data: dto }
          : {}),
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
          .from(campaignAudioTracks)
          .where(eq(campaignAudioTracks.campaignId, auth.campaignId))
          .orderBy(asc(campaignAudioTracks.slotOrder))
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
        .select({ assetId: campaignAudioTracks.assetId })
        .from(campaignAudioTracks)
        .where(eq(campaignAudioTracks.campaignId, auth.campaignId))
        .orderBy(asc(campaignAudioTracks.slotOrder))
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
        // UIX-382 compat: the legacy singular audio:set path operates on the
        // "slot 0" track — the lowest slotOrder row for this campaign,
        // auto-vivified here if the mixer has no tracks yet. This keeps the
        // not-yet-updated MusicBar client working unmodified against the new
        // multi-track table.
        let [current] = await tx
          .select()
          .from(campaignAudioTracks)
          .where(eq(campaignAudioTracks.campaignId, auth.campaignId))
          .orderBy(asc(campaignAudioTracks.slotOrder))
          .limit(1);
        if (!current) {
          [current] = await tx
            .insert(campaignAudioTracks)
            .values({
              campaignId: auth.campaignId,
              assetId: null,
              playing: false,
              positionSeconds: 0,
              loop: false,
              startedAt: null,
              slotOrder: 0,
              revision: 0,
            })
            .returning();
        }
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
          .update(campaignAudioTracks)
          .set({
            ...next,
            revision: current.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(campaignAudioTracks.id, current.id),
              eq(campaignAudioTracks.revision, current.revision),
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

    // UIX-382: per-track mixer commands. Independent transport per track —
    // each mutation targets one trackId (except ADD_TRACK, which creates the
    // row) — but follows the exact GM-only/idempotency/CAS/audit pattern
    // above, generalized from a single campaign-scoped row to N track rows.
    socket.on("audio:track:set", async (input, ack) => {
      if (auth.role !== "GM") {
        return ack?.({ ok: false, status: "FORBIDDEN", reason: "GM_REQUIRED" });
      }
      const parsed = audioTrackCommandSchema.safeParse(input);
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
        const recorded = existing.payload as {
          result?: AudioTrackDto;
          removedTrackId?: string;
        } | null;
        return ack?.({
          ok: true,
          status: "DUPLICATE",
          sequence: existing.sequence,
          ...(recorded?.result ? { data: recorded.result } : {}),
        });
      }

      const ensuredDuration =
        command.command !== "ADD_TRACK"
          ? await (async () => {
              const [preTrack] = await db
                .select({ assetId: campaignAudioTracks.assetId })
                .from(campaignAudioTracks)
                .where(
                  and(
                    eq(campaignAudioTracks.id, command.trackId),
                    eq(campaignAudioTracks.campaignId, auth.campaignId),
                  ),
                )
                .limit(1);
              return preTrack?.assetId
                ? ensureAudioDuration(db, preTrack.assetId)
                : null;
            })()
          : null;

      const result = await db.transaction(async (tx) => {
        if (command.command === "ADD_TRACK") {
          if (command.assetId) {
            const [asset] = await tx
              .select({ campaignId: assets.campaignId, kind: assets.kind })
              .from(assets)
              .where(eq(assets.id, command.assetId))
              .limit(1);
            if (
              !asset ||
              asset.campaignId !== auth.campaignId ||
              asset.kind !== "AUDIO"
            ) {
              return { rejection: "ASSET_NOT_FOUND" as const };
            }
          }
          const [activeCountRow] = await tx
            .select({ value: count() })
            .from(campaignAudioTracks)
            .where(eq(campaignAudioTracks.campaignId, auth.campaignId));
          if (Number(activeCountRow?.value ?? 0) >= MAX_AUDIO_TRACKS) {
            return { rejection: "TRACK_LIMIT_REACHED" as const };
          }
          const [maxSlotRow] = await tx
            .select({ value: max(campaignAudioTracks.slotOrder) })
            .from(campaignAudioTracks)
            .where(eq(campaignAudioTracks.campaignId, auth.campaignId));
          const nextSlot =
            maxSlotRow?.value === null || maxSlotRow?.value === undefined
              ? 0
              : maxSlotRow.value + 1;
          const [state] = await tx
            .insert(campaignAudioTracks)
            .values({
              campaignId: auth.campaignId,
              assetId: command.assetId,
              playing: false,
              positionSeconds: 0,
              loop: false,
              startedAt: null,
              slotOrder: nextSlot,
              revision: 0,
            })
            .returning();
          if (!state) return null;
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId,
              membershipId: auth.membershipId,
              type: "AUDIO_TRACK_COMMAND",
              entityType: "AUDIO_TRACK",
              entityId: state.id,
              payload: { command, result: audioTrackDto(state) },
            })
            .returning();
          return event ? { event, state } : null;
        }

        const [current] = await tx
          .select()
          .from(campaignAudioTracks)
          .where(
            and(
              eq(campaignAudioTracks.id, command.trackId),
              eq(campaignAudioTracks.campaignId, auth.campaignId),
            ),
          )
          .limit(1);
        if (!current) return { rejection: "TRACK_NOT_FOUND" as const };
        if (current.revision !== command.revision) {
          return { rejection: "REVISION_CONFLICT" as const, current };
        }

        if (command.command === "REMOVE_TRACK") {
          const [deleted] = await tx
            .delete(campaignAudioTracks)
            .where(
              and(
                eq(campaignAudioTracks.id, current.id),
                eq(campaignAudioTracks.revision, current.revision),
              ),
            )
            .returning();
          if (!deleted) {
            return { rejection: "REVISION_CONFLICT" as const, current };
          }
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId,
              membershipId: auth.membershipId,
              type: "AUDIO_TRACK_COMMAND",
              entityType: "AUDIO_TRACK",
              entityId: current.id,
              payload: { command, removedTrackId: current.id },
            })
            .returning();
          return event
            ? { event, removed: true as const, removedTrackId: current.id }
            : null;
        }

        if (command.command === "SELECT" && command.assetId) {
          const [asset] = await tx
            .select({ campaignId: assets.campaignId, kind: assets.kind })
            .from(assets)
            .where(eq(assets.id, command.assetId))
            .limit(1);
          if (
            !asset ||
            asset.campaignId !== auth.campaignId ||
            asset.kind !== "AUDIO"
          ) {
            return { rejection: "ASSET_NOT_FOUND" as const };
          }
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
          mixVolume: current.mixVolume,
          playing: logicalPlaying,
          positionSeconds: effectivePosition,
          loop: current.loop,
          startedAt: logicalPlaying ? now : null,
        };

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
          case "SET_MIX_VOLUME":
            next = { ...next, mixVolume: command.mixVolume };
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

        const [state] = await tx
          .update(campaignAudioTracks)
          .set({
            ...next,
            revision: current.revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(campaignAudioTracks.id, current.id),
              eq(campaignAudioTracks.revision, current.revision),
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
            type: "AUDIO_TRACK_COMMAND",
            entityType: "AUDIO_TRACK",
            entityId: state.id,
            payload: { command, result: audioTrackDto(state) },
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
          ...(result.rejection === "REVISION_CONFLICT" && "current" in result
            ? { data: audioTrackDto(result.current) }
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
      if ("removed" in result && result.removed) {
        io.to(campaignRoom(auth.campaignId)).emit(
          "audio:track:removed",
          envelope(result.event.sequence, actionId, {
            trackId: result.removedTrackId,
          }),
        );
        return ack?.({
          ok: true,
          status: "ACCEPTED",
          sequence: result.event.sequence,
        });
      }
      const trackDto = audioTrackDto(result.state);
      io.to(campaignRoom(auth.campaignId)).emit(
        "audio:track:state",
        envelope(result.event.sequence, actionId, trackDto),
      );
      ack?.({
        ok: true,
        status: "ACCEPTED",
        sequence: result.event.sequence,
        data: trackDto,
      });
    });

    // ruler:update and ruler:clear both hit the DB before broadcasting. If a
    // drag's last ruler:update and the ruler:clear that follows it (e.g. from
    // pressing Escape) are handled as two independent async callbacks, their
    // DB lookups can resolve out of order, so the "clear" broadcast can beat
    // the still-pending "update" broadcast across the wire. That leaves every
    // client (including the one who cleared it) with a ruler:updated arriving
    // after ruler:cleared, redrawing a stale line that nothing clears
    // afterwards. Chaining both handlers on a single per-socket promise
    // preserves the client's emit order in the broadcasts.
    let rulerQueue: Promise<void> = Promise.resolve();

    socket.on("ruler:update", (input) => {
      rulerQueue = rulerQueue.then(async () => {
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
        io.to(campaignRoom(auth.campaignId)).emit("ruler:updated", {
          ...parsed.data,
          membershipId: auth.membershipId,
          displayName: auth.displayName,
          distance: rulerPolylineDistance(
            parsed.data.points,
            scene.grid.enabled ? scene.grid.size : 1,
          ),
        });
      });
    });

    socket.on("ruler:clear", (input) => {
      rulerQueue = rulerQueue.then(async () => {
        const parsed = z
          .object({ sceneId: z.string().uuid() })
          .safeParse(input);
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

    // UIX-392: ephemeral cursor presence. Deliberately NOT following the
    // actionId/idempotency/gameEvents/actionJournal pattern used by every
    // other handler in this file — that machinery exists because those
    // handlers persist durable game state, and cursor position is
    // explicitly ephemeral (never persisted, per the ticket's AC). This is
    // a pure in-memory relay off data already on `auth`, with no DB write.
    // No scene-scoped socket room is created either; broadcasts reuse the
    // existing campaign/GM rooms and the client filters by `sceneId`,
    // matching every other realtime event in this file.
    let lastCursorMoveAt = 0;
    // Defensive floor under the client's rAF batching (~16ms/60fps). This
    // does not need to be tight: it exists to cap a misbehaving or hostile
    // client, not to shape normal traffic.
    const CURSOR_MOVE_MIN_INTERVAL_MS = 40;
    // Only a socket that has actually broadcast a cursor position needs a
    // cursor:gone on disconnect; sockets that never used the feature would
    // otherwise generate pure noise for every other client.
    let hasBroadcastCursor = false;

    // UIX-403: a GM's cursor reaches players only when that GM asks for it on
    // the event itself. Keeping the choice on each message rather than in
    // per-socket state means there is no stored flag that can drift out of
    // step with what the GM sees in their own interface.
    const cursorRoom = (shared = false) =>
      auth.role === "GM" && !shared
        ? gmRoom(auth.campaignId)
        : campaignRoom(auth.campaignId);
    // Which audience the last position went to, so `cursor:gone` can be sent
    // to that same audience. Telling the campaign room to forget a cursor it
    // never saw is harmless; failing to tell it leaves the GM's last position
    // frozen on every player's screen — precisely the frame they were hiding.
    let lastCursorShared = false;

    socket.on("cursor:move", async (input) => {
      const parsed = cursorMoveSchema.safeParse(input);
      if (!parsed.success) return;
      const now = Date.now();
      if (now - lastCursorMoveAt < CURSOR_MOVE_MIN_INTERVAL_MS) return;
      lastCursorMoveAt = now;
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
      hasBroadcastCursor = true;
      const shared = parsed.data.shared === true;
      // Moving from shared to private has to retract the old position from the
      // players, or it simply stops updating and stays where it was.
      if (lastCursorShared && !shared)
        io.to(campaignRoom(auth.campaignId)).emit("cursor:gone", {
          membershipId: auth.membershipId,
        });
      lastCursorShared = shared;
      // Fog-safety split (UIX-392): a GM can see everything, so any
      // coordinate their cursor visits could disclose something hidden if
      // shown to a player — the GM room is the default audience, and only the
      // GM themselves can widen it (UIX-403). A player's own cursor never
      // exceeds what that player can already see on their own fog-limited
      // view (this app's fog is role-uniform, not per-player secret), so it is
      // always safe to broadcast to the full campaign room.
      io.to(cursorRoom(shared)).emit("cursor:moved", {
        membershipId: auth.membershipId,
        displayName: auth.displayName,
        role: auth.role,
        sceneId: scene.id,
        x: parsed.data.x,
        y: parsed.data.y,
      });
    });

    socket.on("cursor:gone", () => {
      if (!hasBroadcastCursor) return;
      hasBroadcastCursor = false;
      io.to(cursorRoom(lastCursorShared)).emit("cursor:gone", {
        membershipId: auth.membershipId,
      });
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
      // UIX-392: disconnect is the one server-enforced expiry backstop for
      // cursor presence — a client-side scene switch/blur/inactivity signal
      // (cursor:gone above) covers the graceful cases, but a dropped
      // connection never gets to emit that, so it must be handled here too.
      if (hasBroadcastCursor)
        io.to(cursorRoom(lastCursorShared)).emit("cursor:gone", {
          membershipId: auth.membershipId,
        });
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
    /**
     * UIX-408: сцена, которую мастер рассматривает, не переключая игроков.
     * Живёт на сокете, а не в базе: это состояние взгляда, а не кампании, и
     * после перезагрузки страницы мастер всегда возвращается к транслируемой.
     */
    viewedSceneId?: string | null;
  }
}
