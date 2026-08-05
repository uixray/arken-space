import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Server } from "socket.io";
import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import {
  createPlayerRequestSchema,
  listPlayerRequestsSchema,
  transitionPlayerRequestSchema,
  updatePlayerRequestSchema,
  type PlayerRequestDto,
  type PlayerRequestStatus,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@arken/contracts";
import {
  characterControllers,
  characters,
  chatMessages,
  chatThreads,
  gameEvents,
  memberships,
  playerRequests,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import { requireAuth } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RequestDb = Database | Transaction;
type RequestRow = typeof playerRequests.$inferSelect;
type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;
const campaignRoom = (id: string) => `campaign:${id}`;
const gmRoom = (id: string) => `campaign:${id}:gm`;
const memberRoom = (id: string) => `member:${id}`;

export function emitPlayerRequestChanged(
  io: RealtimeServer,
  request: PlayerRequestDto,
) {
  const target =
    request.audience === "PUBLIC"
      ? io.to(campaignRoom(request.campaignId))
      : io
          .to(gmRoom(request.campaignId))
          .to(memberRoom(request.authorMembershipId));
  target.emit("player-request:changed", request);
}

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};
const commandHash = (type: string, entityId: string | null, body: unknown) =>
  createHash("sha256")
    .update(canonicalJson({ type, entityId, body }))
    .digest("hex");

function fail(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}
function visibility(auth: AuthContext): SQL {
  return auth.role === "GM"
    ? eq(playerRequests.campaignId, auth.campaignId)
    : and(
        eq(playerRequests.campaignId, auth.campaignId),
        or(
          eq(playerRequests.audience, "PUBLIC"),
          eq(playerRequests.authorMembershipId, auth.membershipId),
        ),
      )!;
}
async function dtoById(
  db: RequestDb,
  auth: AuthContext,
  id: string,
): Promise<PlayerRequestDto | null> {
  const [result] = await db
    .select({
      request: playerRequests,
      authorName: memberships.displayName,
      characterName: characters.name,
    })
    .from(playerRequests)
    .innerJoin(
      memberships,
      eq(playerRequests.authorMembershipId, memberships.id),
    )
    .leftJoin(characters, eq(playerRequests.characterId, characters.id))
    .where(and(visibility(auth), eq(playerRequests.id, id)))
    .limit(1);
  if (!result) return null;
  const row = result.request;
  const resolver = row.resolvedByMembershipId
    ? (
        await db
          .select({ displayName: memberships.displayName })
          .from(memberships)
          .where(
            and(
              eq(memberships.campaignId, auth.campaignId),
              eq(memberships.id, row.resolvedByMembershipId),
            ),
          )
          .limit(1)
      )[0]
    : null;
  return {
    id: row.id,
    campaignId: row.campaignId,
    authorMembershipId: row.authorMembershipId,
    authorDisplayName: result.authorName,
    characterId: row.characterId,
    characterName: result.characterName,
    audience: row.audience,
    horizon: row.horizon,
    status: row.status,
    title: row.title,
    body: row.body,
    resolutionNote: row.resolutionNote,
    resolvedByMembershipId: row.resolvedByMembershipId,
    resolvedByDisplayName: resolver?.displayName ?? null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function replay(
  db: RequestDb,
  auth: AuthContext,
  actionId: string,
  type: string,
  entityId: string | null,
  hash: string,
) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (!event) return { kind: "MISS" as const };
  const payload = event.payload as { commandHash?: unknown } | null;
  if (
    event.membershipId !== auth.membershipId ||
    event.type !== type ||
    event.entityType !== "PLAYER_REQUEST" ||
    (entityId !== null && event.entityId !== entityId) ||
    payload?.commandHash !== hash
  )
    return { kind: "CONFLICT" as const };
  return { kind: "MATCH" as const, entityId: event.entityId! };
}
async function record(
  db: RequestDb,
  auth: AuthContext,
  actionId: string,
  type: string,
  id: string,
  revision: number,
  hash: string,
) {
  const [event] = await db
    .insert(gameEvents)
    .values({
      campaignId: auth.campaignId,
      membershipId: auth.membershipId,
      actionId,
      type,
      entityType: "PLAYER_REQUEST",
      entityId: id,
      entityRevision: revision,
      // Deliberately excludes request title/body, including cancellation events.
      payload: { commandHash: hash },
    })
    .returning();
  if (!event) throw new Error("EVENT_RECORD_FAILED");
  return event;
}
async function controlledCharacter(
  db: RequestDb,
  auth: AuthContext,
  id: string,
) {
  const [row] = await db
    .select({
      id: characters.id,
      ownerId: characters.ownerMembershipId,
      controllerId: characterControllers.membershipId,
    })
    .from(characters)
    .leftJoin(
      characterControllers,
      and(
        eq(characterControllers.characterId, characters.id),
        eq(characterControllers.membershipId, auth.membershipId),
      ),
    )
    .where(
      and(eq(characters.campaignId, auth.campaignId), eq(characters.id, id)),
    )
    .limit(1);
  return Boolean(
    row &&
    (auth.role === "GM" ||
      row.ownerId === auth.membershipId ||
      row.controllerId === auth.membershipId),
  );
}

export function canCreatePlayerRequest(auth: AuthContext) {
  return auth.role === "PLAYER";
}
export const playerRequestStateStatuses = {
  OPEN: ["SUBMITTED", "ACKNOWLEDGED"],
  CLOSED: ["RESOLVED", "DECLINED", "CANCELLED"],
} as const;

export const playerRequestTransitions: Record<
  PlayerRequestStatus,
  readonly string[]
> = {
  SUBMITTED: ["ACKNOWLEDGE", "RESOLVE", "DECLINE", "CANCEL"],
  ACKNOWLEDGED: ["RESOLVE", "DECLINE", "CANCEL"],
  RESOLVED: [],
  DECLINED: [],
  CANCELLED: [],
};
const nextStatus = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  RESOLVE: "RESOLVED",
  DECLINE: "DECLINED",
  CANCEL: "CANCELLED",
} as const;

export async function listVisiblePlayerRequests(
  db: RequestDb,
  auth: AuthContext,
): Promise<PlayerRequestDto[]> {
  const rows = await db
    .select({ id: playerRequests.id })
    .from(playerRequests)
    .where(visibility(auth))
    .orderBy(asc(playerRequests.createdAt));
  return (
    await Promise.all(rows.map(({ id }) => dtoById(db, auth, id)))
  ).filter((row): row is PlayerRequestDto => Boolean(row));
}

export function registerPlayerRequestRoutes(
  app: FastifyInstance,
  db: Database,
  io?: RealtimeServer,
) {
  app.get("/api/player-requests", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const parsed = listPlayerRequestsSchema.safeParse(request.query);
    if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const q = parsed.data;
    const clauses: SQL[] = [visibility(auth)];
    if (q.status) clauses.push(eq(playerRequests.status, q.status));
    if (q.audience) clauses.push(eq(playerRequests.audience, q.audience));
    if (q.horizon) clauses.push(eq(playerRequests.horizon, q.horizon));
    if (q.state === "OPEN")
      clauses.push(
        inArray(playerRequests.status, [...playerRequestStateStatuses.OPEN]),
      );
    if (q.state === "CLOSED")
      clauses.push(
        inArray(playerRequests.status, [...playerRequestStateStatuses.CLOSED]),
      );
    if (q.authorMembershipId)
      clauses.push(eq(playerRequests.authorMembershipId, q.authorMembershipId));
    if (q.characterId)
      clauses.push(eq(playerRequests.characterId, q.characterId));
    const rows = await db
      .select({ id: playerRequests.id })
      .from(playerRequests)
      .where(and(...clauses))
      .orderBy(asc(playerRequests.createdAt));
    return (
      await Promise.all(rows.map(({ id }) => dtoById(db, auth, id)))
    ).filter(Boolean);
  });
  app.get("/api/player-requests/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = (request.params as { id?: string }).id;
    if (!id) return fail(reply, 404, "NOT_FOUND");
    const row = await dtoById(db, auth, id);
    return row ?? fail(reply, 404, "NOT_FOUND");
  });
  app.post("/api/player-requests", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const parsed = createPlayerRequestSchema.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    if (!canCreatePlayerRequest(auth)) return fail(reply, 403, "FORBIDDEN");
    const body = parsed.data;
    if (
      body.characterId &&
      !(await controlledCharacter(db, auth, body.characterId))
    )
      return fail(reply, 404, "NOT_FOUND");
    const hash = commandHash("PLAYER_REQUEST_CREATED", null, body);
    const prior = await replay(
      db,
      auth,
      body.actionId,
      "PLAYER_REQUEST_CREATED",
      null,
      hash,
    );
    if (prior.kind === "CONFLICT")
      return fail(reply, 409, "ACTION_ID_CONFLICT");
    if (prior.kind === "MATCH")
      return reply.code(200).send(await dtoById(db, auth, prior.entityId));
    const created = await db.transaction(async (tx) => {
      await tx
        .insert(chatThreads)
        .values({
          campaignId: auth.campaignId,
          type: "STREAM",
          stream: "TABLE",
        })
        .onConflictDoNothing({
          target: [chatThreads.campaignId, chatThreads.stream],
        });
      const [thread] = await tx
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.campaignId, auth.campaignId),
            eq(chatThreads.stream, "TABLE"),
          ),
        )
        .limit(1);
      if (!thread) throw new Error("CHAT_THREAD_NOT_FOUND");
      const [row] = await tx
        .insert(playerRequests)
        .values({
          campaignId: auth.campaignId,
          authorMembershipId: auth.membershipId,
          characterId: body.characterId ?? null,
          audience: body.audience,
          horizon: body.horizon,
          title: body.title,
          body: body.body,
        })
        .returning();
      if (!row) throw new Error("REQUEST_CREATE_FAILED");
      const [message] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: body.characterId ?? null,
          kind: "SYSTEM",
          threadId: thread.id,
          visibility: body.audience,
          body: "",
          playerRequestId: row.id,
        })
        .returning();
      if (!message) throw new Error("MESSAGE_CREATE_FAILED");
      const event = await record(
        tx,
        auth,
        body.actionId,
        "PLAYER_REQUEST_CREATED",
        row.id,
        0,
        hash,
      );
      return { id: row.id, message, event, stream: thread.stream };
    });
    const dto = await dtoById(db, auth, created.id);
    if (!dto) return fail(reply, 500, "REQUEST_PROJECTION_FAILED");
    if (io) {
      const target =
        dto.audience === "PUBLIC"
          ? io.to(campaignRoom(dto.campaignId))
          : io
              .to(gmRoom(dto.campaignId))
              .to(memberRoom(dto.authorMembershipId));
      target.emit("player-request:changed", dto);
      target.emit("chat:created", {
        sequence: Number(created.event.sequence),
        actionId: body.actionId,
        emittedAt: created.event.createdAt.toISOString(),
        data: {
          id: created.message.id,
          sequence: Number(created.message.sequence),
          membershipId: auth.membershipId,
          displayName: auth.displayName,
          characterId: created.message.characterId,
          body: "",
          playerRequestId: dto.id,
          visibility: created.message.visibility,
          kind: "SYSTEM",
          threadId: created.message.threadId,
          stream: created.stream,
          dice: null,
          createdAt: created.message.createdAt.toISOString(),
        },
      });
    }
    return reply.code(201).send(dto);
  });
  app.patch("/api/player-requests/:id", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = (request.params as { id?: string }).id;
    const parsed = updatePlayerRequestSchema.safeParse(request.body);
    if (!id || !parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    const hash = commandHash("PLAYER_REQUEST_UPDATED", id, body);
    const prior = await replay(
      db,
      auth,
      body.actionId,
      "PLAYER_REQUEST_UPDATED",
      id,
      hash,
    );
    if (prior.kind === "CONFLICT")
      return fail(reply, 409, "ACTION_ID_CONFLICT");
    if (prior.kind === "MATCH") return dtoById(db, auth, id);
    const visible = await dtoById(db, auth, id);
    if (!visible) return fail(reply, 404, "NOT_FOUND");
    if (visible.authorMembershipId !== auth.membershipId)
      return fail(reply, 403, "FORBIDDEN");
    if (visible.status !== "SUBMITTED")
      return fail(reply, 409, "INVALID_TRANSITION");
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(playerRequests)
        .set({
          title: body.title,
          body: body.body,
          revision: body.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(playerRequests.campaignId, auth.campaignId),
            eq(playerRequests.id, id),
            eq(playerRequests.authorMembershipId, auth.membershipId),
            eq(playerRequests.status, "SUBMITTED"),
            eq(playerRequests.revision, body.revision),
          ),
        )
        .returning();
      if (!row) return false;
      await record(
        tx,
        auth,
        body.actionId,
        "PLAYER_REQUEST_UPDATED",
        id,
        row.revision,
        hash,
      );
      return true;
    });
    if (!updated) return fail(reply, 409, "REVISION_CONFLICT");
    const dto = await dtoById(db, auth, id);
    if (!dto) return fail(reply, 500, "REQUEST_PROJECTION_FAILED");
    if (io) emitPlayerRequestChanged(io, dto);
    return dto;
  });
  app.post("/api/player-requests/:id/actions", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const id = (request.params as { id?: string }).id;
    const parsed = transitionPlayerRequestSchema.safeParse(request.body);
    if (!id || !parsed.success) return fail(reply, 400, "INVALID_REQUEST");
    const body = parsed.data;
    const type = `PLAYER_REQUEST_${body.action}`;
    const hash = commandHash(type, id, body);
    const prior = await replay(db, auth, body.actionId, type, id, hash);
    if (prior.kind === "CONFLICT")
      return fail(reply, 409, "ACTION_ID_CONFLICT");
    if (prior.kind === "MATCH") return dtoById(db, auth, id);
    const visible = await dtoById(db, auth, id);
    if (!visible) return fail(reply, 404, "NOT_FOUND");
    if (body.action === "CANCEL") {
      if (visible.authorMembershipId !== auth.membershipId)
        return fail(reply, 403, "FORBIDDEN");
    } else if (auth.role !== "GM") return fail(reply, 403, "FORBIDDEN");
    if (
      !playerRequestTransitions[visible.status].includes(body.action) ||
      (body.action === "CANCEL" &&
        !["SUBMITTED", "ACKNOWLEDGED"].includes(visible.status))
    )
      return fail(reply, 409, "INVALID_TRANSITION");
    const status = nextStatus[body.action];
    const isResolution = status === "RESOLVED" || status === "DECLINED";
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(playerRequests)
        .set({
          status,
          revision: body.revision + 1,
          updatedAt: new Date(),
          cancelledAt: status === "CANCELLED" ? new Date() : null,
          resolvedByMembershipId: isResolution ? auth.membershipId : null,
          resolutionNote: isResolution ? (body.resolutionNote ?? null) : null,
        })
        .where(
          and(
            eq(playerRequests.campaignId, auth.campaignId),
            eq(playerRequests.id, id),
            eq(playerRequests.status, visible.status),
            eq(playerRequests.revision, body.revision),
          ),
        )
        .returning();
      if (!row) return false;
      await record(tx, auth, body.actionId, type, id, row.revision, hash);
      return true;
    });
    if (!updated) return fail(reply, 409, "REVISION_CONFLICT");
    const dto = await dtoById(db, auth, id);
    if (!dto) return fail(reply, 500, "REQUEST_PROJECTION_FAILED");
    if (io) emitPlayerRequestChanged(io, dto);
    return dto;
  });
}
