import type { FastifyInstance } from "fastify";
import {
  actionJournal,
  drawings,
  tokens,
  assets,
  fogReveals,
  gameEvents,
  scenes,
  tokenControllers,
} from "@arken/db";
import { LAYERED_DRAWING_KINDS, isStampDrawing } from "./drawing-kinds.js";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  canvasBulkCommandSchema,
  historyCommandSchema,
  sceneCanvasConfigSchema,
} from "@arken/contracts";
import { requireAuth } from "./auth.js";
import { findAction } from "./action-lookup.js";
import { invalidateRedoBranch } from "./canvas-history.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type CanvasDatabase = ReturnType<
  typeof import("./campaign-pause-guard.js").campaignCanvasDatabase
>;

function historyContainsStamp(command: typeof actionJournal.$inferSelect) {
  const snapshots = [command.before, command.after];
  if (command.targetType === "DRAWING")
    return snapshots.some(
      (snapshot) =>
        typeof snapshot === "object" &&
        snapshot !== null &&
        "kind" in snapshot &&
        LAYERED_DRAWING_KINDS.includes(snapshot.kind),
    );
  if (command.targetType !== "CANVAS_BULK") return false;
  return snapshots.some((snapshot) => {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("drawings" in snapshot)
    )
      return false;
    const rows = snapshot.drawings;
    return (
      Array.isArray(rows) &&
      rows.some(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "kind" in row &&
          LAYERED_DRAWING_KINDS.includes(row.kind),
      )
    );
  });
}

type SceneTokenGeometrySnapshot = {
  tokens: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    revision: number;
  }>;
};

const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 1024;
const roundedCanvasValue = (value: number) =>
  Math.round(value * 1_000_000) / 1_000_000;
class SceneGridTokenBoundsError extends Error {
  constructor(
    readonly tokenId: string,
    readonly width: number,
    readonly height: number,
  ) {
    super("SCENE_GRID_TOKEN_BOUNDS");
  }
}
const scaledTokenLength = (value: number, scale: number) =>
  roundedCanvasValue(value * scale);
const scaledGridCoordinate = (
  value: number,
  previousOffset: number,
  nextOffset: number,
  scale: number,
) => roundedCanvasValue(nextOffset + (value - previousOffset) * scale);

/**
 * Canvas operations: bulk move/delete, history, undo and redo, and scene
 * canvas resizing. Moved out of routes.ts unchanged (legacy cleanup after
 * the 15.10 audit); every write still goes through canvasTx.
 */
export function registerCanvasRoutes(
  app: FastifyInstance,
  db: Database,
  {
    canvasTx,
    broadcast,
  }: {
    canvasTx: (campaignId: string) => CanvasDatabase;
    broadcast: (campaignId: string) => Promise<void>;
  },
) {
  app.post("/api/canvas/bulk", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = canvasBulkCommandSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (
      new Set(
        body.targets.map((target) => `${target.targetType}:${target.targetId}`),
      ).size !== body.targets.length
    )
      return reply.code(422).send({ error: "DUPLICATE_BULK_TARGET" });
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
    const tokenIds = body.targets
      .filter((target) => target.targetType === "TOKEN")
      .map((target) => target.targetId);
    const drawingIds = body.targets
      .filter((target) => target.targetType === "DRAWING")
      .map((target) => target.targetId);
    const tokenRows = tokenIds.length
      ? await db
          .select()
          .from(tokens)
          .where(
            and(inArray(tokens.id, tokenIds), eq(tokens.sceneId, scene.id)),
          )
      : [];
    const drawingRows = drawingIds.length
      ? await db
          .select()
          .from(drawings)
          .where(
            and(
              inArray(drawings.id, drawingIds),
              eq(drawings.sceneId, scene.id),
            ),
          )
      : [];
    if (
      tokenRows.length !== tokenIds.length ||
      drawingRows.length !== drawingIds.length
    )
      return reply.code(404).send({ error: "CANVAS_TARGET_NOT_FOUND" });
    const requested = new Map(
      body.targets.map((target) => [
        `${target.targetType}:${target.targetId}`,
        target,
      ]),
    );
    if (
      [
        ...tokenRows.map((row) => ["TOKEN", row] as const),
        ...drawingRows.map((row) => ["DRAWING", row] as const),
      ].some(
        ([kind, row]) =>
          requested.get(`${kind}:${row.id}`)?.revision !== row.revision,
      )
    )
      return reply.code(409).send({ error: "STALE_REVISION" });
    if (auth.role !== "GM") {
      const controlled = tokenIds.length
        ? await db
            .select({ tokenDefinitionId: tokenControllers.tokenDefinitionId })
            .from(tokenControllers)
            .where(
              and(
                inArray(
                  tokenControllers.tokenDefinitionId,
                  tokenRows.map((row) => row.definitionId),
                ),
                eq(tokenControllers.membershipId, auth.membershipId),
              ),
            )
        : [];
      const controlledIds = new Set(
        controlled.map((row) => row.tokenDefinitionId),
      );
      if (
        tokenRows.some(
          (row) =>
            !controlledIds.has(row.definitionId) ||
            row.locked ||
            !row.visible ||
            row.layer === "GM",
        ) ||
        drawingRows.some(
          (row) =>
            isStampDrawing(row) || row.authorMembershipId !== auth.membershipId,
        )
      )
        return reply.code(403).send({ error: "CANVAS_TARGET_FORBIDDEN" });
    }
    const guardedDb = canvasTx(auth.campaignId);
    const result = await guardedDb
      .transaction(async (tx) => {
        await invalidateRedoBranch(tx, auth, scene.id);
        const afterTokens: (typeof tokens.$inferSelect)[] = [];
        const afterDrawings: (typeof drawings.$inferSelect)[] = [];
        for (const row of tokenRows) {
          if (body.operation === "DELETE") {
            const [deleted] = await tx
              .delete(tokens)
              .where(
                and(eq(tokens.id, row.id), eq(tokens.revision, row.revision)),
              )
              .returning();
            if (!deleted) throw new Error("BULK_CONFLICT");
          } else {
            const [updated] = await tx
              .update(tokens)
              .set({
                x: row.x + body.deltaX,
                y: row.y + body.deltaY,
                revision: row.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(eq(tokens.id, row.id), eq(tokens.revision, row.revision)),
              )
              .returning();
            if (!updated) throw new Error("BULK_CONFLICT");
            afterTokens.push(updated);
          }
        }
        for (const row of drawingRows) {
          if (body.operation === "DELETE") {
            const [deleted] = await tx
              .delete(drawings)
              .where(
                and(
                  eq(drawings.id, row.id),
                  eq(drawings.revision, row.revision),
                ),
              )
              .returning();
            if (!deleted) throw new Error("BULK_CONFLICT");
          } else {
            const [updated] = await tx
              .update(drawings)
              .set({
                x: row.x + body.deltaX,
                y: row.y + body.deltaY,
                revision: row.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(drawings.id, row.id),
                  eq(drawings.revision, row.revision),
                ),
              )
              .returning();
            if (!updated) throw new Error("BULK_CONFLICT");
            afterDrawings.push(updated);
          }
        }
        const targetRevisions = {
          tokens: Object.fromEntries(
            tokenRows.map((row) => [row.id, row.revision]),
          ),
          drawings: Object.fromEntries(
            drawingRows.map((row) => [row.id, row.revision]),
          ),
        };
        const before = {
          tokens: tokenRows,
          drawings: drawingRows,
          revisions: targetRevisions,
        };
        const after =
          body.operation === "DELETE"
            ? {
                tokens: [],
                drawings: [],
                revisions: targetRevisions,
              }
            : {
                tokens: afterTokens,
                drawings: afterDrawings,
                revisions: {
                  tokens: Object.fromEntries(
                    afterTokens.map((row) => [row.id, row.revision]),
                  ),
                  drawings: Object.fromEntries(
                    afterDrawings.map((row) => [row.id, row.revision]),
                  ),
                },
              };
        await tx.insert(actionJournal).values({
          campaignId: auth.campaignId,
          sceneId: scene.id,
          actorMembershipId: auth.membershipId,
          actionId: body.actionId,
          type: `CANVAS_BULK_${body.operation}`,
          targetType: "CANVAS_BULK",
          targetId: body.actionId,
          before,
          after,
          currentRevision: 0,
          scope:
            tokenRows.some((row) => row.layer === "GM") ||
            drawingRows.some(isStampDrawing)
              ? "GM"
              : "PUBLIC",
        });
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: `canvas.bulk.${body.operation.toLowerCase()}`,
          entityType: "canvas_bulk",
          entityId: body.actionId,
          payload: { sceneId: scene.id, targets: body.targets },
        });
        return after;
      })
      .catch((error: unknown) =>
        error instanceof Error && error.message === "BULK_CONFLICT"
          ? null
          : Promise.reject(error),
      );
    if (!result) return reply.code(409).send({ error: "CANVAS_BULK_CONFLICT" });
    await broadcast(auth.campaignId);
    return { ok: true, ...result };
  });

  app.get("/api/canvas/history", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const query = z.object({ sceneId: z.string().uuid() }).parse(request.query);
    const [scene] = await db
      .select({ id: scenes.id })
      .from(scenes)
      .where(
        and(
          eq(scenes.id, query.sceneId),
          eq(scenes.campaignId, auth.campaignId),
        ),
      )
      .limit(1);
    if (!scene) return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    const historyColumns = {
      sequence: actionJournal.sequence,
      actorMembershipId: actionJournal.actorMembershipId,
      type: actionJournal.type,
      targetType: actionJournal.targetType,
      targetId: actionJournal.targetId,
      status: actionJournal.status,
      createdAt: actionJournal.createdAt,
    };
    const visibleHistory = and(
      eq(actionJournal.campaignId, auth.campaignId),
      eq(actionJournal.sceneId, scene.id),
      auth.role === "GM"
        ? undefined
        : and(
            eq(actionJournal.actorMembershipId, auth.membershipId),
            eq(actionJournal.scope, "PUBLIC"),
          ),
    );
    const rows = await db
      .select(historyColumns)
      .from(actionJournal)
      .where(visibleHistory)
      // UIX-503: это не лента создания записей, а проекция текущего стека
      // Undo/Redo. Команды ниже выбирают кандидата по transitionSequence;
      // если здесь сортировать по исходному sequence, после двух Undo клиент
      // назовёт одно действие, а сервер повторит другое.
      .orderBy(desc(actionJournal.transitionSequence))
      .limit(100);
    const candidates = await db
      .selectDistinctOn([actionJournal.status], historyColumns)
      .from(actionJournal)
      .where(
        and(
          visibleHistory,
          inArray(actionJournal.status, ["APPLIED", "UNDONE"]),
        ),
      )
      .orderBy(actionJournal.status, desc(actionJournal.transitionSequence));
    const nextDirections = new Map(
      candidates.map((candidate) => [
        candidate.sequence,
        candidate.status === "APPLIED" ? ("undo" as const) : ("redo" as const),
      ]),
    );
    const recentSequences = new Set(rows.map((row) => row.sequence));
    // После ста переходов кандидат противоположного статуса может оказаться за
    // пределами обычной страницы. Добавляем его отдельно и маркируем, чтобы UI
    // по-прежнему обещал ровно ту команду, которую выберет POST ниже.
    return [
      ...rows.map((row) => ({
        ...row,
        nextDirection: nextDirections.get(row.sequence) ?? null,
      })),
      ...candidates
        .filter((candidate) => !recentSequences.has(candidate.sequence))
        .map((candidate) => ({
          ...candidate,
          nextDirection: nextDirections.get(candidate.sequence) ?? null,
        })),
    ];
  });

  for (const direction of ["undo", "redo"] as const) {
    app.post(`/api/canvas/${direction}`, async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const body = historyCommandSchema.parse(request.body);
      if (await findAction(db, auth.campaignId, body.actionId))
        return reply.code(200).send({ duplicate: true });
      const desiredStatus = direction === "undo" ? "APPLIED" : "UNDONE";
      const [candidateCommand] = await db
        .select()
        .from(actionJournal)
        .where(
          and(
            eq(actionJournal.campaignId, auth.campaignId),
            eq(actionJournal.sceneId, body.sceneId),
            eq(actionJournal.status, desiredStatus),
            auth.role === "GM"
              ? undefined
              : and(
                  eq(actionJournal.actorMembershipId, auth.membershipId),
                  eq(actionJournal.scope, "PUBLIC"),
                ),
          ),
        )
        .orderBy(desc(actionJournal.transitionSequence))
        .limit(1);
      if (!candidateCommand)
        return reply.code(404).send({ error: "HISTORY_ACTION_NOT_FOUND" });
      // Players may replay legacy/public freehand history, but GM-owned stamp
      // instances are never player-editable—even while their layer is public.
      if (auth.role !== "GM" && historyContainsStamp(candidateCommand))
        return reply.code(403).send({ error: "STAMP_FORBIDDEN" });
      const guardedDb = canvasTx(auth.campaignId);
      const saved = await guardedDb
        .transaction(async (tx) => {
          // Every canvas mutation that can create or restore tokens takes the
          // scene lock first. Grid rescale uses the same lock, making token
          // placement and history replay linearizable with the rescale.
          await tx.execute(
            sql`select id from scenes where id = ${body.sceneId} and campaign_id = ${auth.campaignId} for update`,
          );
          await tx.execute(
            sql`select sequence from action_journal where sequence = ${candidateCommand.sequence} for update`,
          );
          const [command] = await tx
            .select()
            .from(actionJournal)
            .where(eq(actionJournal.sequence, candidateCommand.sequence))
            .limit(1);
          if (!command || command.status !== desiredStatus) return null;
          const snapshot =
            direction === "undo" ? command.before : command.after;
          let targetRevision = command.currentRevision;
          if (command.targetType === "CANVAS_BULK") {
            const conflict = (): never => {
              throw new Error("CANVAS_BULK_HISTORY_CONFLICT");
            };
            type StoredToken = Omit<typeof tokens.$inferSelect, "updatedAt"> & {
              updatedAt: Date | string;
            };
            type StoredDrawing = Omit<
              typeof drawings.$inferSelect,
              "createdAt" | "updatedAt"
            > & {
              createdAt: Date | string;
              updatedAt: Date | string;
            };
            type CompoundSnapshot = {
              tokens: StoredToken[];
              drawings: StoredDrawing[];
              revisions?: {
                tokens?: Record<string, number>;
                drawings?: Record<string, number>;
              };
            };
            const desired = snapshot as CompoundSnapshot;
            const current = (
              direction === "undo" ? command.after : command.before
            ) as CompoundSnapshot;
            const tokenIds = new Set([
              ...desired.tokens.map((row) => row.id),
              ...current.tokens.map((row) => row.id),
              ...Object.keys(desired.revisions?.tokens ?? {}),
              ...Object.keys(current.revisions?.tokens ?? {}),
            ]);
            const drawingIds = new Set([
              ...desired.drawings.map((row) => row.id),
              ...current.drawings.map((row) => row.id),
              ...Object.keys(desired.revisions?.drawings ?? {}),
              ...Object.keys(current.revisions?.drawings ?? {}),
            ]);
            const currentTokens = tokenIds.size
              ? await tx
                  .select()
                  .from(tokens)
                  .where(inArray(tokens.id, [...tokenIds]))
              : [];
            const currentDrawings = drawingIds.size
              ? await tx
                  .select()
                  .from(drawings)
                  .where(inArray(drawings.id, [...drawingIds]))
              : [];
            const currentTokenRows = new Map(
              currentTokens.map((row) => [row.id, row]),
            );
            const currentDrawingRows = new Map(
              currentDrawings.map((row) => [row.id, row]),
            );
            const expectedTokenRows = new Map(
              current.tokens.map((row) => [row.id, row]),
            );
            const expectedDrawingRows = new Map(
              current.drawings.map((row) => [row.id, row]),
            );
            for (const id of tokenIds) {
              const actual = currentTokenRows.get(id);
              const expected = expectedTokenRows.get(id);
              if (
                Boolean(actual) !== Boolean(expected) ||
                (actual &&
                  actual.revision !==
                    (current.revisions?.tokens?.[id] ?? expected?.revision))
              )
                conflict();
            }
            for (const id of drawingIds) {
              const actual = currentDrawingRows.get(id);
              const expected = expectedDrawingRows.get(id);
              if (
                Boolean(actual) !== Boolean(expected) ||
                (actual &&
                  actual.revision !==
                    (current.revisions?.drawings?.[id] ?? expected?.revision))
              )
                conflict();
            }
            const desiredTokenIds = new Set(
              desired.tokens.map((row) => row.id),
            );
            const desiredDrawingIds = new Set(
              desired.drawings.map((row) => row.id),
            );
            const nextTokenRevisions = {
              ...(desired.revisions?.tokens ?? {}),
            };
            const nextDrawingRevisions = {
              ...(desired.revisions?.drawings ?? {}),
            };
            const nextTokens: StoredToken[] = [];
            const nextDrawings: StoredDrawing[] = [];
            for (const prior of current.tokens) {
              if (desiredTokenIds.has(prior.id)) continue;
              const [deleted] = await tx
                .delete(tokens)
                .where(
                  and(
                    eq(tokens.id, prior.id),
                    eq(
                      tokens.revision,
                      current.revisions?.tokens?.[prior.id] ?? prior.revision,
                    ),
                  ),
                )
                .returning();
              const deletedRow = deleted ?? conflict();
              nextTokenRevisions[prior.id] = deletedRow.revision;
            }
            for (const prior of current.drawings) {
              if (desiredDrawingIds.has(prior.id)) continue;
              const [deleted] = await tx
                .delete(drawings)
                .where(
                  and(
                    eq(drawings.id, prior.id),
                    eq(
                      drawings.revision,
                      current.revisions?.drawings?.[prior.id] ?? prior.revision,
                    ),
                  ),
                )
                .returning();
              const deletedRow = deleted ?? conflict();
              nextDrawingRevisions[prior.id] = deletedRow.revision;
            }
            for (const token of desired.tokens) {
              const existing = currentTokenRows.get(token.id);
              const nextRevision =
                (current.revisions?.tokens?.[token.id] ??
                  desired.revisions?.tokens?.[token.id] ??
                  token.revision) + 1;
              if (existing) {
                const [updated] = await tx
                  .update(tokens)
                  .set({
                    definitionId: token.definitionId,
                    sceneId: token.sceneId,
                    characterId: token.characterId,
                    ownerMembershipId: token.ownerMembershipId,
                    assetId: token.assetId,
                    levelId: token.levelId,
                    layer: token.layer,
                    name: token.name,
                    x: token.x,
                    y: token.y,
                    z: token.z,
                    width: token.width,
                    height: token.height,
                    rotation: token.rotation,
                    visible: token.visible,
                    locked: token.locked,
                    baseColor: token.baseColor,
                    frameColor: token.frameColor,
                    revision: nextRevision,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(tokens.id, token.id),
                      eq(tokens.revision, existing.revision),
                    ),
                  )
                  .returning();
                const updatedRow = updated ?? conflict();
                nextTokens.push(updatedRow);
                nextTokenRevisions[token.id] = updatedRow.revision;
              } else {
                const [restored] = await tx
                  .insert(tokens)
                  .values({
                    id: token.id,
                    definitionId: token.definitionId,
                    sceneId: token.sceneId,
                    characterId: token.characterId,
                    ownerMembershipId: token.ownerMembershipId,
                    assetId: token.assetId,
                    levelId: token.levelId,
                    layer: token.layer,
                    name: token.name,
                    x: token.x,
                    y: token.y,
                    z: token.z,
                    width: token.width,
                    height: token.height,
                    rotation: token.rotation,
                    visible: token.visible,
                    locked: token.locked,
                    baseColor: token.baseColor,
                    frameColor: token.frameColor,
                    revision: nextRevision,
                    updatedAt: new Date(token.updatedAt),
                  })
                  .returning();
                const restoredRow = restored ?? conflict();
                nextTokens.push(restoredRow);
                nextTokenRevisions[token.id] = restoredRow.revision;
              }
            }
            for (const drawing of desired.drawings) {
              const existing = currentDrawingRows.get(drawing.id);
              const nextRevision =
                (current.revisions?.drawings?.[drawing.id] ??
                  desired.revisions?.drawings?.[drawing.id] ??
                  drawing.revision) + 1;
              if (existing) {
                const [updated] = await tx
                  .update(drawings)
                  .set({
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
                    revision: nextRevision,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(drawings.id, drawing.id),
                      eq(drawings.revision, existing.revision),
                    ),
                  )
                  .returning();
                const updatedRow = updated ?? conflict();
                nextDrawings.push(updatedRow);
                nextDrawingRevisions[drawing.id] = updatedRow.revision;
              } else {
                const [restored] = await tx
                  .insert(drawings)
                  .values({
                    id: drawing.id,
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
                    revision: nextRevision,
                    createdAt: new Date(drawing.createdAt),
                    updatedAt: new Date(drawing.updatedAt),
                  })
                  .returning();
                const restoredRow = restored ?? conflict();
                nextDrawings.push(restoredRow);
                nextDrawingRevisions[drawing.id] = restoredRow.revision;
              }
            }
            const nextSnapshot: CompoundSnapshot = {
              tokens: nextTokens,
              drawings: nextDrawings,
              revisions: {
                tokens: nextTokenRevisions,
                drawings: nextDrawingRevisions,
              },
            };
            if (direction === "undo") command.before = nextSnapshot;
            else command.after = nextSnapshot;
            targetRevision = (targetRevision ?? 0) + 1;
          } else if (command.targetType === "DRAWING") {
            if (snapshot === null) {
              const [deleted] = await tx
                .delete(drawings)
                .where(
                  and(
                    eq(drawings.id, command.targetId),
                    targetRevision === null
                      ? undefined
                      : eq(drawings.revision, targetRevision),
                  ),
                )
                .returning();
              if (!deleted) return null;
            } else {
              const drawing = snapshot as typeof drawings.$inferSelect;
              const [existing] = await tx
                .select()
                .from(drawings)
                .where(eq(drawings.id, command.targetId))
                .limit(1);
              if (existing) {
                if (
                  targetRevision === null ||
                  existing.revision !== targetRevision
                )
                  return null;
                const [updated] = await tx
                  .update(drawings)
                  .set({
                    points: drawing.points,
                    color: drawing.color,
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
                    revision: existing.revision + 1,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(drawings.id, command.targetId),
                      eq(drawings.revision, existing.revision),
                    ),
                  )
                  .returning();
                if (!updated) return null;
                targetRevision = updated.revision;
              } else {
                const nextRevision = (targetRevision ?? drawing.revision) + 1;
                const [restored] = await tx
                  .insert(drawings)
                  .values({
                    id: command.targetId,
                    sceneId: drawing.sceneId,
                    authorMembershipId: drawing.authorMembershipId,
                    points: drawing.points,
                    color: drawing.color,
                    strokeWidth: drawing.strokeWidth ?? 3,
                    x: drawing.x,
                    y: drawing.y,
                    kind: drawing.kind ?? "FREEHAND",
                    stampAssetKey: drawing.stampAssetKey ?? null,
                    stampPackId: drawing.stampPackId ?? null,
                    stampSize: drawing.stampSize ?? null,
                    stampRotation: drawing.stampRotation ?? null,
                    stampLayer: drawing.stampLayer ?? null,
                    revision: nextRevision,
                  })
                  .returning();
                if (!restored) return null;
                targetRevision = restored.revision;
              }
            }
          } else if (command.targetType === "TOKEN") {
            if (snapshot === null) {
              const [deleted] = await tx
                .delete(tokens)
                .where(
                  and(
                    eq(tokens.id, command.targetId),
                    command.currentRevision === null
                      ? undefined
                      : eq(tokens.revision, command.currentRevision),
                  ),
                )
                .returning();
              if (!deleted) return null;
              targetRevision = deleted.revision;
            } else if (
              command.type === "TOKEN_DELETE" ||
              command.type === "TOKEN_CREATE"
            ) {
              const token = snapshot as typeof tokens.$inferSelect;
              const [existing] = await tx
                .select({ id: tokens.id })
                .from(tokens)
                .where(eq(tokens.id, command.targetId))
                .limit(1);
              if (existing) return null;
              const nextRevision = (targetRevision ?? token.revision) + 1;
              const [restored] = await tx
                .insert(tokens)
                .values({
                  id: token.id,
                  definitionId: token.definitionId,
                  sceneId: token.sceneId,
                  characterId: token.characterId,
                  ownerMembershipId: token.ownerMembershipId,
                  assetId: token.assetId,
                  levelId: token.levelId,
                  layer: token.layer,
                  name: token.name,
                  x: token.x,
                  y: token.y,
                  z: token.z,
                  width: token.width,
                  height: token.height,
                  rotation: token.rotation,
                  visible: token.visible,
                  locked: token.locked,
                  baseColor: token.baseColor,
                  frameColor: token.frameColor,
                  revision: nextRevision,
                })
                .returning();
              if (!restored) return null;
              targetRevision = restored.revision;
            } else {
              const values = snapshot as {
                layer?: "MAP" | "GM" | "PLAYER";
                x?: number;
                y?: number;
                z?: number;
                levelId?: string | null;
                width?: number;
                height?: number;
                baseColor?: string;
                frameColor?: string | null;
              } | null;
              if (!values || targetRevision === null) return null;
              const [updated] = await tx
                .update(tokens)
                .set({
                  ...(values.layer ? { layer: values.layer } : {}),
                  ...(values.x !== undefined ? { x: values.x } : {}),
                  ...(values.y !== undefined ? { y: values.y } : {}),
                  ...(values.z !== undefined ? { z: values.z } : {}),
                  ...(values.levelId !== undefined
                    ? { levelId: values.levelId }
                    : {}),
                  ...(values.width !== undefined
                    ? { width: values.width }
                    : {}),
                  ...(values.height !== undefined
                    ? { height: values.height }
                    : {}),
                  ...(values.baseColor !== undefined
                    ? { baseColor: values.baseColor }
                    : {}),
                  ...(values.frameColor !== undefined
                    ? { frameColor: values.frameColor }
                    : {}),
                  revision: targetRevision + 1,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(tokens.id, command.targetId),
                    eq(tokens.revision, targetRevision),
                  ),
                )
                .returning();
              if (!updated) return null;
              targetRevision = updated.revision;
            }
          } else if (command.targetType === "FOG") {
            if (snapshot === null) {
              const [deleted] = await tx
                .delete(fogReveals)
                .where(eq(fogReveals.id, command.targetId))
                .returning();
              if (!deleted) return null;
            } else {
              const fog = snapshot as typeof fogReveals.$inferSelect;
              const [restored] = await tx
                .insert(fogReveals)
                .values({
                  id: command.targetId,
                  sceneId: fog.sceneId,
                  x: fog.x,
                  y: fog.y,
                  width: fog.width,
                  height: fog.height,
                  operation: fog.operation,
                  shape: fog.shape,
                  geometry: fog.geometry,
                  bbox: fog.bbox,
                  sequence: fog.sequence,
                  revision: (targetRevision ?? fog.revision) + 1,
                })
                .returning();
              if (!restored) return null;
              targetRevision = restored.revision;
            }
          } else if (command.targetType === "SCENE") {
            if (snapshot === null) return null;
            const values = snapshot as {
              name?: string;
              mapAssetId?: string | null;
              grid: typeof scenes.$inferSelect.grid;
              mapScale: number;
              world?: { width: number; height: number };
              backgroundFrame?: {
                x: number;
                y: number;
                width: number;
                height: number;
              };
              tokenGeometry?: SceneTokenGeometrySnapshot;
            };
            const expectedValues = (
              direction === "undo" ? command.after : command.before
            ) as typeof values;
            const [currentScene] = await tx
              .select({ revision: scenes.revision })
              .from(scenes)
              .where(
                and(
                  eq(scenes.id, command.targetId),
                  eq(scenes.campaignId, auth.campaignId),
                ),
              )
              .limit(1);
            if (
              !currentScene ||
              (command.currentRevision !== null &&
                currentScene.revision !== command.currentRevision)
            )
              return null;
            if (
              Boolean(values.tokenGeometry) !==
              Boolean(expectedValues.tokenGeometry)
            )
              return null;
            if (values.tokenGeometry && expectedValues.tokenGeometry) {
              const desired = values.tokenGeometry;
              const expected = expectedValues.tokenGeometry;
              const desiredTokenIds = desired.tokens
                .map((row) => row.id)
                .sort();
              const expectedTokenIds = expected.tokens
                .map((row) => row.id)
                .sort();
              if (desiredTokenIds.join() !== expectedTokenIds.join())
                return null;
              const currentTokens = desiredTokenIds.length
                ? await tx
                    .select({
                      id: tokens.id,
                      revision: tokens.revision,
                    })
                    .from(tokens)
                    .where(inArray(tokens.id, desiredTokenIds))
                : [];
              const expectedTokens = new Map(
                expected.tokens.map((row) => [row.id, row]),
              );
              if (
                currentTokens.length !== desiredTokenIds.length ||
                currentTokens.some(
                  (row) =>
                    row.revision !== expectedTokens.get(row.id)?.revision,
                )
              )
                return null;
              const nextTokens: SceneTokenGeometrySnapshot["tokens"] = [];
              for (const token of desired.tokens) {
                const expectedRevision = expectedTokens.get(token.id)!.revision;
                const [saved] = await tx
                  .update(tokens)
                  .set({
                    x: token.x,
                    y: token.y,
                    width: token.width,
                    height: token.height,
                    revision: expectedRevision + 1,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(tokens.id, token.id),
                      eq(tokens.revision, expectedRevision),
                    ),
                  )
                  .returning({
                    id: tokens.id,
                    x: tokens.x,
                    y: tokens.y,
                    width: tokens.width,
                    height: tokens.height,
                    revision: tokens.revision,
                  });
                if (!saved) throw new Error("SCENE_GRID_HISTORY_CONFLICT");
                nextTokens.push(saved);
              }
              values.tokenGeometry = { tokens: nextTokens };
              if (direction === "undo") command.before = values;
              else command.after = values;
            }
            const [updated] = await tx
              .update(scenes)
              .set({
                ...(values.name !== undefined ? { name: values.name } : {}),
                ...(values.mapAssetId !== undefined
                  ? { mapAssetId: values.mapAssetId }
                  : {}),
                grid: values.grid,
                mapScale: values.mapScale,
                ...(values.world
                  ? { width: values.world.width, height: values.world.height }
                  : {}),
                ...(values.backgroundFrame
                  ? {
                      backgroundX: values.backgroundFrame.x,
                      backgroundY: values.backgroundFrame.y,
                      backgroundWidth: values.backgroundFrame.width,
                      backgroundHeight: values.backgroundFrame.height,
                    }
                  : {}),
                revision: currentScene.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(scenes.id, command.targetId),
                  eq(scenes.revision, currentScene.revision),
                  eq(scenes.campaignId, auth.campaignId),
                ),
              )
              .returning();
            if (!updated) throw new Error("SCENE_GRID_HISTORY_CONFLICT");
            targetRevision = updated.revision;
          } else return null;
          const nextStatus = direction === "undo" ? "UNDONE" : "APPLIED";
          const [journal] = await tx
            .update(actionJournal)
            .set({
              status: nextStatus,
              currentRevision: targetRevision,
              ...(["CANVAS_BULK", "SCENE"].includes(command.targetType)
                ? { before: command.before, after: command.after }
                : {}),
              transitionSequence: sql`nextval(pg_get_serial_sequence('action_journal', 'transition_sequence'))`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(actionJournal.sequence, command.sequence),
                eq(actionJournal.status, desiredStatus),
              ),
            )
            .returning();
          if (!journal) throw new Error("HISTORY_JOURNAL_CONFLICT");
          const [event] = await tx
            .insert(gameEvents)
            .values({
              campaignId: auth.campaignId,
              actionId: body.actionId,
              membershipId: auth.membershipId,
              type: `canvas.${direction}`,
              entityType: command.targetType.toLowerCase(),
              entityId: command.targetId,
              entityRevision: targetRevision,
              payload: { journalSequence: command.sequence },
            })
            .returning();
          if (!event) throw new Error("EVENT_RECORD_FAILED");
          return { journal, event };
        })
        .catch((error: unknown) =>
          error instanceof Error &&
          [
            "CANVAS_BULK_HISTORY_CONFLICT",
            "SCENE_GRID_HISTORY_CONFLICT",
            "HISTORY_JOURNAL_CONFLICT",
          ].includes(error.message)
            ? null
            : Promise.reject(error),
        );
      if (!saved)
        return reply.code(409).send({ error: "HISTORY_CONFLICT_RESYNC" });
      await broadcast(auth.campaignId);
      return {
        sequence: saved.journal.sequence,
        status: saved.journal.status,
        eventSequence: Number(saved.event.sequence),
      };
    });
  }

  app.patch("/api/scenes/:id/canvas", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    if (auth.role !== "GM")
      return reply.code(403).send({ error: "GM_REQUIRED" });
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const body = sceneCanvasConfigSchema.parse(request.body);
    if (await findAction(db, auth.campaignId, body.actionId))
      return reply.code(200).send({ duplicate: true });
    if (body.mapAssetId) {
      const [mapAsset] = await db
        .select({ kind: assets.kind })
        .from(assets)
        .where(
          and(
            eq(assets.id, body.mapAssetId),
            eq(assets.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!mapAsset) return reply.code(404).send({ error: "ASSET_NOT_FOUND" });
      if (mapAsset.kind !== "MAP")
        return reply.code(422).send({ error: "MAP_ASSET_REQUIRED" });
    }
    const guardedDb = canvasTx(auth.campaignId);
    const result = await guardedDb
      .transaction(async (tx) => {
        // Scene mutation, token placement, and token-restoring history all use
        // this same row lock. The token set below is therefore a complete,
        // linearizable snapshot for this rescale.
        await tx.execute(
          sql`select id from scenes where id = ${id} and campaign_id = ${auth.campaignId} for update`,
        );
        const [current] = await tx
          .select()
          .from(scenes)
          .where(and(eq(scenes.id, id), eq(scenes.campaignId, auth.campaignId)))
          .limit(1);
        if (!current) return { status: "not_found" as const };
        if (current.revision !== body.revision)
          return { status: "conflict" as const };

        const shouldRescaleTokenGeometry = Boolean(
          body.grid &&
          current.grid.enabled &&
          body.grid.enabled &&
          current.grid.size !== body.grid.size,
        );
        const currentTokenGeometry = shouldRescaleTokenGeometry
          ? await tx
              .select({
                id: tokens.id,
                x: tokens.x,
                y: tokens.y,
                width: tokens.width,
                height: tokens.height,
                revision: tokens.revision,
              })
              .from(tokens)
              .where(eq(tokens.sceneId, id))
          : [];
        const scale =
          shouldRescaleTokenGeometry && body.grid
            ? body.grid.size / current.grid.size
            : 1;
        const plannedTokenGeometry = currentTokenGeometry.map((token) => ({
          ...token,
          x: scaledGridCoordinate(
            token.x,
            current.grid.offsetX,
            body.grid!.offsetX,
            scale,
          ),
          y: scaledGridCoordinate(
            token.y,
            current.grid.offsetY,
            body.grid!.offsetY,
            scale,
          ),
          width: scaledTokenLength(token.width, scale),
          height: scaledTokenLength(token.height, scale),
        }));
        const outOfBounds = plannedTokenGeometry.find(
          (token) =>
            token.width < MIN_TOKEN_LENGTH ||
            token.width > MAX_TOKEN_LENGTH ||
            token.height < MIN_TOKEN_LENGTH ||
            token.height > MAX_TOKEN_LENGTH,
        );
        if (outOfBounds)
          throw new SceneGridTokenBoundsError(
            outOfBounds.id,
            outOfBounds.width,
            outOfBounds.height,
          );

        await invalidateRedoBranch(tx, auth, id);
        const [next] = await tx
          .update(scenes)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.mapAssetId !== undefined
              ? { mapAssetId: body.mapAssetId }
              : {}),
            ...(body.grid ? { grid: body.grid } : {}),
            ...(body.mapScale !== undefined ? { mapScale: body.mapScale } : {}),
            ...(body.world
              ? { width: body.world.width, height: body.world.height }
              : {}),
            ...(body.backgroundFrame
              ? {
                  backgroundX: body.backgroundFrame.x,
                  backgroundY: body.backgroundFrame.y,
                  backgroundWidth: body.backgroundFrame.width,
                  backgroundHeight: body.backgroundFrame.height,
                }
              : {}),
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scenes.id, id),
              eq(scenes.campaignId, auth.campaignId),
              eq(scenes.revision, current.revision),
            ),
          )
          .returning();
        if (!next) throw new Error("SCENE_GRID_RESCALE_CONFLICT");

        let beforeTokenGeometry: SceneTokenGeometrySnapshot | undefined;
        let afterTokenGeometry: SceneTokenGeometrySnapshot | undefined;
        if (shouldRescaleTokenGeometry && body.grid) {
          beforeTokenGeometry = { tokens: currentTokenGeometry };
          const nextTokens: SceneTokenGeometrySnapshot["tokens"] = [];
          for (const token of plannedTokenGeometry) {
            const [saved] = await tx
              .update(tokens)
              .set({
                x: token.x,
                y: token.y,
                width: token.width,
                height: token.height,
                revision: token.revision + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(tokens.id, token.id),
                  eq(tokens.revision, token.revision),
                ),
              )
              .returning({
                id: tokens.id,
                x: tokens.x,
                y: tokens.y,
                width: tokens.width,
                height: tokens.height,
                revision: tokens.revision,
              });
            if (!saved) throw new Error("SCENE_GRID_RESCALE_CONFLICT");
            nextTokens.push(saved);
          }
          afterTokenGeometry = { tokens: nextTokens };
          // Earlier token snapshots use the previous grid coordinate system.
          // Retire them so later history never replays stale pixel geometry;
          // drawing and fog actions remain independently undoable.
          if (nextTokens.length)
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
                  eq(actionJournal.sceneId, id),
                  eq(actionJournal.targetType, "TOKEN"),
                  inArray(
                    actionJournal.targetId,
                    nextTokens.map((token) => token.id),
                  ),
                  eq(actionJournal.status, "APPLIED"),
                ),
              );
        }
        await tx.insert(gameEvents).values({
          campaignId: auth.campaignId,
          actionId: body.actionId,
          membershipId: auth.membershipId,
          type: "scene.canvas",
          entityType: "scene",
          entityId: id,
          entityRevision: next.revision,
          payload: {
            name: next.name,
            mapAssetId: next.mapAssetId,
            grid: next.grid,
            mapScale: next.mapScale,
            world: { width: next.width, height: next.height },
            backgroundFrame: {
              x: next.backgroundX,
              y: next.backgroundY,
              width: next.backgroundWidth,
              height: next.backgroundHeight,
            },
            ...(afterTokenGeometry
              ? { rescaledTokens: afterTokenGeometry.tokens.length }
              : {}),
          },
        });
        await tx.insert(actionJournal).values({
          campaignId: auth.campaignId,
          sceneId: id,
          actorMembershipId: auth.membershipId,
          actionId: body.actionId,
          type: "SCENE_CANVAS",
          targetType: "SCENE",
          targetId: id,
          before: {
            name: current.name,
            mapAssetId: current.mapAssetId,
            grid: current.grid,
            mapScale: current.mapScale,
            world: { width: current.width, height: current.height },
            backgroundFrame: {
              x: current.backgroundX,
              y: current.backgroundY,
              width: current.backgroundWidth,
              height: current.backgroundHeight,
            },
            ...(beforeTokenGeometry
              ? { tokenGeometry: beforeTokenGeometry }
              : {}),
          },
          after: {
            name: next.name,
            mapAssetId: next.mapAssetId,
            grid: next.grid,
            mapScale: next.mapScale,
            world: { width: next.width, height: next.height },
            backgroundFrame: {
              x: next.backgroundX,
              y: next.backgroundY,
              width: next.backgroundWidth,
              height: next.backgroundHeight,
            },
            ...(afterTokenGeometry
              ? { tokenGeometry: afterTokenGeometry }
              : {}),
          },
          beforeRevision: current.revision,
          afterRevision: next.revision,
          currentRevision: next.revision,
        });
        return { status: "ok" as const, scene: next };
      })
      .catch((error: unknown) => {
        if (error instanceof SceneGridTokenBoundsError)
          return {
            status: "bounds" as const,
            tokenId: error.tokenId,
            width: error.width,
            height: error.height,
          };
        if (
          error instanceof Error &&
          error.message === "SCENE_GRID_RESCALE_CONFLICT"
        )
          return { status: "conflict" as const };
        return Promise.reject(error);
      });
    if (result.status === "not_found")
      return reply.code(404).send({ error: "SCENE_NOT_FOUND" });
    if (result.status === "conflict")
      return reply.code(409).send({ error: "SCENE_CONFLICT" });
    if (result.status === "bounds")
      return reply.code(422).send({
        error: "SCENE_GRID_TOKEN_BOUNDS",
        policy: "REJECT",
        min: MIN_TOKEN_LENGTH,
        max: MAX_TOKEN_LENGTH,
        tokenId: result.tokenId,
        width: result.width,
        height: result.height,
      });
    await broadcast(auth.campaignId);
    return result.scene;
  });
}
