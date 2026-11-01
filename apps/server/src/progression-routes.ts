import { createHash, randomInt } from "node:crypto";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  createProgressionSchema,
  grantProgressionSpSchema,
  progressionActionSchema,
  progressionDataSchema,
  type ProgressionData,
  type ProgressionTarget,
} from "@arken/contracts";
import {
  campaigns,
  characters,
  characterControllers,
  characterCatalogEntries,
  playerRequests,
  gameEvents,
} from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";
import {
  characterRollStats,
  resolveCharacterStatLayout,
} from "./character-dto.js";
import { dtoById } from "./player-requests.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;
type Character = typeof characters.$inferSelect;
type Target = ProgressionTarget & { label: string; value: number | null };
const paramsSchema = z.object({ characterId: z.string().uuid() });
class ProgressionError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
function requireCondition(
  condition: unknown,
  code: string,
  status = 409,
): asserts condition {
  if (!condition) throw new ProgressionError(code, status);
}
const sameTarget = (a: ProgressionTarget | null, b: ProgressionTarget | null) =>
  a?.kind === b?.kind && a?.key === b?.key;
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
      .join(",") +
    "}"
  );
};

async function characterAccess(
  db: Db,
  auth: AuthContext,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(characters)
    .where(
      and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
    );
  const [character] = lock ? await query.for("update") : await query;
  requireCondition(character, "NOT_FOUND", 404);
  requireCondition(character.lifecycle === "ACTIVE", "CHARACTER_ARCHIVED");
  if (auth.role !== "GM" && character.ownerMembershipId !== auth.membershipId) {
    const [controller] = await db
      .select()
      .from(characterControllers)
      .where(
        and(
          eq(characterControllers.characterId, id),
          eq(characterControllers.membershipId, auth.membershipId),
        ),
      );
    requireCondition(controller, "NOT_FOUND", 404);
  }
  return character;
}

async function targets(db: Db, character: Character): Promise<Target[]> {
  const [campaign] = await db
    .select({ statLayout: campaigns.statLayout })
    .from(campaigns)
    .where(eq(campaigns.id, character.campaignId));
  const stats = characterRollStats(character, campaign?.statLayout);
  const layout = resolveCharacterStatLayout(
    character.statLayout,
    campaign?.statLayout,
  );
  const labels = new Map(
    layout.flatMap((group) =>
      group.rows
        .filter((row) => row.source === "STAT")
        .map((row) => [row.key, row.label] as const),
    ),
  );
  const entries = await db
    .select()
    .from(characterCatalogEntries)
    .where(eq(characterCatalogEntries.characterId, character.id));
  return [
    ...Object.entries(stats).map(([key, value]) => ({
      kind: "STAT" as const,
      key,
      value,
      label: labels.get(key) ?? key,
    })),
    ...character.skills.map((skill) => ({
      kind: "SKILL" as const,
      key: skill.key,
      label: skill.name,
      value: skill.rank,
    })),
    ...character.spells.map((spell) => ({
      kind: "SPELL" as const,
      key: spell.key,
      label: spell.name,
      value: null,
    })),
    ...entries
      .filter((entry) => entry.kind === "SKILL" || entry.kind === "ABILITY")
      .map((entry) => ({
        kind: "ENTRY" as const,
        key: entry.id,
        label: entry.name,
        value: null,
      })),
  ];
}

async function rowsFor(db: Db, auth: AuthContext, characterId: string) {
  return db
    .select()
    .from(playerRequests)
    .where(
      and(
        eq(playerRequests.campaignId, auth.campaignId),
        eq(playerRequests.characterId, characterId),
        isNotNull(playerRequests.progression),
      ),
    )
    .orderBy(asc(playerRequests.createdAt));
}

function balance(character: Character) {
  const sp = character.wallet.sp;
  requireCondition(Number.isSafeInteger(sp) && sp >= 0, "INVALID_SP_BALANCE");
  return sp;
}
async function updateBalance(
  tx: Tx,
  character: Character,
  sp: number,
  target?: Target,
  value?: number,
) {
  requireCondition(Number.isSafeInteger(sp) && sp >= 0, "INVALID_SP_BALANCE");
  const changes: Partial<typeof characters.$inferInsert> = {
    wallet: { ...character.wallet, sp },
    revision: character.revision + 1,
    updatedAt: new Date(),
  };
  if (target && value !== undefined) {
    requireCondition(Number.isFinite(value), "INVALID_ADJUSTMENT");
    if (target.kind === "STAT")
      changes.stats = { ...character.stats, [target.key]: value };
    else if (target.kind === "SKILL")
      changes.skills = character.skills.map((skill) =>
        skill.key === target.key ? { ...skill, rank: value } : skill,
      );
    else throw new ProgressionError("TEXT_EFFECT_ONLY");
  }
  const [updated] = await tx
    .update(characters)
    .set(changes)
    .where(
      and(
        eq(characters.id, character.id),
        eq(characters.campaignId, character.campaignId),
        eq(characters.revision, character.revision),
      ),
    )
    .returning();
  requireCondition(updated, "CHARACTER_CONFLICT");
}

function history(auth: AuthContext, action: string, sp: number, note: string) {
  return {
    action,
    membershipId: auth.membershipId,
    at: new Date().toISOString(),
    note,
    sp,
  };
}
function baseData(kind: ProgressionData["kind"], sp: number): ProgressionData {
  return {
    kind,
    state: kind === "GRANT" ? "GRANTED" : "PENDING",
    target: null,
    targetLabel: "Начисление SP",
    sp,
    proposedSp: null,
    roll: null,
    effect: "",
    adjustment: null,
    appliedSequence: null,
    history: [],
  };
}

export function registerProgressionRoutes(
  app: FastifyInstance,
  db: Database,
  broadcast: (campaignId: string) => Promise<void>,
) {
  app.get(
    "/api/characters/:characterId/progression",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      const params = paramsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      try {
        const character = await characterAccess(
          db,
          auth,
          params.data.characterId,
        );
        const rows = await rowsFor(db, auth, character.id);
        const data = rows.map((row) =>
          progressionDataSchema.parse(row.progression),
        );
        const visible = rows.filter(
          (row) =>
            auth.role === "GM" || row.authorMembershipId === auth.membershipId,
        );
        return {
          balance: balance(character),
          spentSp: data
            .filter((item) => item.state === "APPLIED")
            .reduce((sum, item) => sum + item.sp, 0),
          grantedSp: data
            .filter((item) => item.kind === "GRANT")
            .reduce((sum, item) => sum + item.sp, 0),
          targets: await targets(db, character),
          records: (
            await Promise.all(visible.map((row) => dtoById(db, auth, row.id)))
          ).filter(Boolean),
        };
      } catch (error) {
        if (error instanceof ProgressionError)
          return reply.code(error.status).send({ error: error.code });
        throw error;
      }
    },
  );

  // All writes serialize on character, then request. Existing sheet writes use
  // character revision CAS, so a concurrent wallet edit cannot lose a debit.
  for (const operation of ["create", "grant", "action"] as const) {
    app.post(
      "/api/characters/:characterId/progression/" + operation,
      async (request, reply) => {
        const auth = await requireAuth(request, reply, db);
        if (!auth) return;
        const params = paramsSchema.safeParse(request.params);
        const inputSchema =
          operation === "create"
            ? createProgressionSchema
            : operation === "grant"
              ? grantProgressionSpSchema
              : progressionActionSchema;
        // Action uses an envelope to keep the strict discriminated schema intact.
        const raw = request.body as Record<string, unknown> | null;
        const actionRequestId =
          operation === "action"
            ? z.string().uuid().safeParse(raw?.requestId)
            : null;
        const actionBody =
          raw && operation === "action"
            ? Object.fromEntries(
                Object.entries(raw).filter(([key]) => key !== "requestId"),
              )
            : raw;
        const parsed =
          operation === "action"
            ? progressionActionSchema.safeParse(actionBody)
            : inputSchema.safeParse(raw);
        if (
          !params.success ||
          !parsed.success ||
          (operation === "action" && !actionRequestId?.success)
        )
          return reply.code(400).send({ error: "INVALID_REQUEST" });
        const characterId = params.data.characterId;
        const body = parsed.data;
        const hash = createHash("sha256")
          .update(
            canonical({
              operation,
              characterId,
              body,
              requestId: raw?.requestId ?? null,
            }),
          )
          .digest("hex");
        try {
          const resultId = await db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${auth.campaignId + ":" + body.actionId}, 0))`,
            );
            const character = await characterAccess(
              tx,
              auth,
              characterId,
              true,
            );
            const [prior] = await tx
              .select()
              .from(gameEvents)
              .where(
                and(
                  eq(gameEvents.campaignId, auth.campaignId),
                  eq(gameEvents.actionId, body.actionId),
                ),
              );
            if (prior) {
              requireCondition(
                prior.type === "CHARACTER_PROGRESSION" &&
                  prior.membershipId === auth.membershipId &&
                  (prior.payload as { commandHash?: string }).commandHash ===
                    hash,
                "ACTION_ID_CONFLICT",
              );
              return prior.entityId!;
            }
            const recordEvent = async (id: string, revision: number) => {
              const [event] = await tx
                .insert(gameEvents)
                .values({
                  campaignId: auth.campaignId,
                  membershipId: auth.membershipId,
                  actionId: body.actionId,
                  type: "CHARACTER_PROGRESSION",
                  entityType: "PLAYER_REQUEST",
                  entityId: id,
                  entityRevision: revision,
                  // No proposal, roll or effect in potentially wider event streams.
                  payload: { commandHash: hash },
                })
                .returning();
              requireCondition(event, "EVENT_RECORD_FAILED", 500);
              return Number(event.sequence);
            };
            if (operation === "create") {
              requireCondition(auth.role === "PLAYER", "PLAYER_REQUIRED", 403);
              const command = createProgressionSchema.parse(body);
              const target = (await targets(tx, character)).find((item) =>
                sameTarget(item, command.target),
              );
              requireCondition(target, "TARGET_NOT_FOUND", 404);
              const p = baseData("UPGRADE", command.sp);
              p.target = command.target;
              p.targetLabel = target!.label;
              p.roll = randomInt(1, 21);
              p.history.push(history(auth, "SUBMIT", p.sp, command.comment));
              const [created] = await tx
                .insert(playerRequests)
                .values({
                  campaignId: auth.campaignId,
                  authorMembershipId: auth.membershipId,
                  characterId,
                  audience: "GM_ONLY",
                  horizon: "NEXT_SESSION",
                  title: ("Прокачка: " + target!.label).slice(0, 120),
                  body: command.comment,
                  progression: p,
                })
                .returning();
              requireCondition(created, "REQUEST_CREATE_FAILED", 500);
              await recordEvent(created.id, created.revision);
              return created.id;
            }
            if (operation === "grant") {
              requireCondition(auth.role === "GM", "GM_REQUIRED", 403);
              const command = grantProgressionSpSchema.parse(body);
              const p = baseData("GRANT", command.sp);
              p.effect = command.note;
              p.history.push(history(auth, "GRANT", command.sp, command.note));
              await updateBalance(
                tx,
                character,
                balance(character) + command.sp,
              );
              const [created] = await tx
                .insert(playerRequests)
                .values({
                  campaignId: auth.campaignId,
                  authorMembershipId:
                    character.ownerMembershipId ?? auth.membershipId,
                  characterId,
                  audience: "GM_ONLY",
                  horizon: "NOW",
                  status: "RESOLVED",
                  title: "Начисление SP",
                  body: command.note,
                  resolutionNote: command.note,
                  resolvedByMembershipId: auth.membershipId,
                  progression: p,
                })
                .returning();
              requireCondition(created, "REQUEST_CREATE_FAILED", 500);
              await recordEvent(created.id, created.revision);
              return created.id;
            }
            const command = progressionActionSchema.parse(body);
            const requestId = z.string().uuid().parse(raw?.requestId);
            const [row] = await tx
              .select()
              .from(playerRequests)
              .where(
                and(
                  eq(playerRequests.id, requestId),
                  eq(playerRequests.characterId, characterId),
                  eq(playerRequests.campaignId, auth.campaignId),
                  isNotNull(playerRequests.progression),
                ),
              )
              .for("update");
            requireCondition(row, "NOT_FOUND", 404);
            requireCondition(
              auth.role === "GM" ||
                row.authorMembershipId === auth.membershipId,
              "NOT_FOUND",
              404,
            );
            requireCondition(
              row.revision === command.revision,
              "REVISION_CONFLICT",
            );
            const p = progressionDataSchema.parse(row.progression);
            requireCondition(p.kind === "UPGRADE", "INVALID_TRANSITION");
            const authorAction =
              command.action === "CONSENT" || command.action === "CANCEL";
            requireCondition(
              authorAction
                ? auth.role === "PLAYER" &&
                    row.authorMembershipId === auth.membershipId
                : auth.role === "GM",
              "FORBIDDEN",
              403,
            );
            requireCondition(
              command.action === "REVERSE"
                ? p.state === "APPLIED"
                : p.state === "PENDING",
              "INVALID_TRANSITION",
            );
            let note = "note" in command ? command.note : "";
            let status = row.status;
            let resolvedBy = row.resolvedByMembershipId;
            let resolutionNote = row.resolutionNote;
            const sequence = await recordEvent(row.id, row.revision + 1);
            if (command.action === "COUNTER") {
              requireCondition(command.sp !== p.sp, "SP_UNCHANGED");
              p.proposedSp = command.sp;
            } else if (command.action === "CONSENT") {
              requireCondition(p.proposedSp !== null, "NO_COUNTER_PROPOSAL");
              p.sp = p.proposedSp!;
              p.proposedSp = null;
              note = "Игрок согласовал сумму SP.";
            } else if (command.action === "APPLY") {
              requireCondition(p.proposedSp === null, "SP_CONSENT_REQUIRED");
              requireCondition(balance(character) >= p.sp, "INSUFFICIENT_SP");
              const target = (await targets(tx, character)).find((item) =>
                sameTarget(item, p.target),
              );
              requireCondition(target, "TARGET_NOT_FOUND", 404);
              if (command.delta !== undefined) {
                requireCondition(
                  target!.value !== null &&
                    ["STAT", "SKILL"].includes(target!.kind),
                  "TEXT_EFFECT_ONLY",
                );
                p.adjustment = {
                  before: target!.value!,
                  after: target!.value! + command.delta,
                };
              }
              await updateBalance(
                tx,
                character,
                balance(character) - p.sp,
                target,
                p.adjustment?.after,
              );
              p.state = "APPLIED";
              p.effect = command.effect;
              p.appliedSequence = sequence;
              note = command.effect;
              status = "RESOLVED";
              resolvedBy = auth.membershipId;
              resolutionNote = note;
            } else if (command.action === "REVERSE") {
              const others = await rowsFor(tx, auth, characterId);
              requireCondition(
                !others.some((other) => {
                  if (other.id === row.id) return false;
                  const later = progressionDataSchema.parse(other.progression);
                  return (
                    later.state === "APPLIED" &&
                    sameTarget(later.target, p.target) &&
                    (later.appliedSequence ?? 0) > (p.appliedSequence ?? 0)
                  );
                }),
                "REVERSE_LATEST_FIRST",
              );
              const target = (await targets(tx, character)).find((item) =>
                sameTarget(item, p.target),
              );
              if (p.adjustment)
                requireCondition(
                  target?.value === p.adjustment.after,
                  "TARGET_CHANGED_SINCE_APPLY",
                );
              await updateBalance(
                tx,
                character,
                balance(character) + p.sp,
                target,
                p.adjustment?.before,
              );
              p.state = "REVERSED";
            } else {
              p.state = command.action === "DECLINE" ? "DECLINED" : "CANCELLED";
              status = p.state;
              if (status === "DECLINED") {
                resolvedBy = auth.membershipId;
                resolutionNote = note;
              }
            }
            p.history.push(
              history(
                auth,
                command.action,
                command.action === "COUNTER" ? command.sp : p.sp,
                note,
              ),
            );
            await tx
              .update(playerRequests)
              .set({
                progression: p,
                revision: row.revision + 1,
                status,
                resolvedByMembershipId: resolvedBy,
                resolutionNote,
                cancelledAt: status === "CANCELLED" ? new Date() : null,
                updatedAt: new Date(),
              })
              .where(eq(playerRequests.id, row.id));
            return row.id;
          });
          // Existing snapshot projection preserves requester/GM privacy.
          // A failed delivery must not disguise a committed transaction.
          try {
            await broadcast(auth.campaignId);
          } catch (error) {
            request.log.warn({ err: error }, "Progression broadcast failed");
          }
          return await dtoById(db, auth, resultId);
        } catch (error) {
          if (error instanceof ProgressionError)
            return reply.code(error.status).send({ error: error.code });
          throw error;
        }
      },
    );
  }
}
