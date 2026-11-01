import { createHash, randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  privateNotebookCommandSchema,
  inspirationAdjustSchema,
  inspirationRerollSchema,
  inspirationStateSchema,
  type DiceResult,
} from "@arken/contracts";
import {
  characters,
  characterControllers,
  characterPrivateNotebooks,
  chatMessages,
  chatThreads,
  gameEvents,
} from "@arken/db";
import { requireAuth, type AuthContext } from "./auth.js";
import { normalizeDiceResult, normalizeSkillCard } from "./dice-result.js";
import { chatMessageDto } from "./chat.js";
import { rollFormulaWithMode } from "./dice.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Db = Database | Tx;
const paramsSchema = z.object({ characterId: z.string().uuid() });
class ExtrasError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
  }
}
function insist(value: unknown, code: string, status = 409): asserts value {
  if (!value) throw new ExtrasError(code, status);
}
export function inspirationState(resources: Record<string, unknown>) {
  const parsed = inspirationStateSchema.safeParse(
    resources.inspiration ?? { current: 0, maximum: 1 },
  );
  insist(parsed.success, "INVALID_INSPIRATION");
  return parsed.data;
}
export function sameInspiration(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  // Reserved resource: generic editors may preserve it, not change its metadata.
  const a = before.inspiration ?? { current: 0, maximum: 1 };
  const b = after.inspiration ?? { current: 0, maximum: 1 };
  const canonical = (v: unknown) =>
    JSON.stringify(
      Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)),
    );
  return canonical(a) === canonical(b);
}
async function access(db: Db, auth: AuthContext, id: string, lock = false) {
  const query = db
    .select()
    .from(characters)
    .where(
      and(eq(characters.id, id), eq(characters.campaignId, auth.campaignId)),
    );
  const [character] = lock ? await query.for("update") : await query;
  insist(character, "NOT_FOUND", 404);
  insist(character.lifecycle === "ACTIVE", "CHARACTER_ARCHIVED");
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
    insist(controller, "NOT_FOUND", 404);
  }
  return character;
}
function publicD20(raw: unknown): DiceResult | null {
  const card = normalizeSkillCard(raw);
  const results =
    card?.execution === "EXECUTED"
      ? (card.rolls?.map((r) => r.result) ?? (card.result ? [card.result] : []))
      : [normalizeDiceResult(raw)];
  return (
    results
      .slice()
      .reverse()
      .find((r): r is DiceResult =>
        Boolean(r && r.terms.some((t) => /d20(?:kh1|kl1)?$/.test(t.notation))),
      ) ?? null
  );
}
function eligible(result: DiceResult) {
  return (
    !result.inspiration &&
    result.terms.length === 1 &&
    ["1d20", "2d20kh1", "2d20kl1"].includes(result.terms[0]!.notation)
  );
}
async function latestD20(db: Db, campaignId: string, characterId: string) {
  let before: number | undefined;
  for (;;) {
    const rows = await db
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
      .where(
        and(
          eq(chatMessages.campaignId, campaignId),
          eq(chatMessages.characterId, characterId),
          eq(chatMessages.kind, "DICE"),
          eq(chatMessages.visibility, "PUBLIC"),
          eq(chatThreads.type, "STREAM"),
          before === undefined ? undefined : lt(chatMessages.sequence, before),
        ),
      )
      .orderBy(desc(chatMessages.sequence))
      .limit(100);
    for (const { message } of rows) {
      const result = publicD20(message.dice);
      if (result) return { message, result };
    }
    if (rows.length < 100) return null;
    before = rows[rows.length - 1]!.message.sequence;
  }
}
export function registerCharacterExtrasRoutes(
  app: FastifyInstance,
  db: Database,
  broadcast: (campaignId: string) => Promise<void>,
) {
  app.get(
    "/api/characters/:characterId/private-notebook",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      reply.header("Cache-Control", "private, no-store");
      const params = paramsSchema.safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      try {
        await access(db, auth, params.data.characterId);
        const [row] = await db
          .select({
            text: characterPrivateNotebooks.text,
            revision: characterPrivateNotebooks.revision,
          })
          .from(characterPrivateNotebooks)
          .where(
            and(
              eq(characterPrivateNotebooks.campaignId, auth.campaignId),
              eq(
                characterPrivateNotebooks.characterId,
                params.data.characterId,
              ),
              eq(
                characterPrivateNotebooks.authorMembershipId,
                auth.membershipId,
              ),
            ),
          );
        return row ?? { text: "", revision: 0 };
      } catch (error) {
        if (error instanceof ExtrasError)
          return reply.code(error.status).send({ error: error.code });
        return reply.code(500).send({ error: "NOTEBOOK_UNAVAILABLE" });
      }
    },
  );
  app.put(
    "/api/characters/:characterId/private-notebook",
    async (request, reply) => {
      const auth = await requireAuth(request, reply, db);
      if (!auth) return;
      reply.header("Cache-Control", "private, no-store");
      const params = paramsSchema.safeParse(request.params),
        parsed = privateNotebookCommandSchema.safeParse(request.body);
      if (!params.success || !parsed.success)
        return reply.code(400).send({ error: "INVALID_REQUEST" });
      const body = parsed.data;
      const hash = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex");
      try {
        return await db.transaction(async (tx) => {
          await access(tx, auth, params.data.characterId, true);
          const where = and(
            eq(characterPrivateNotebooks.campaignId, auth.campaignId),
            eq(characterPrivateNotebooks.characterId, params.data.characterId),
            eq(characterPrivateNotebooks.authorMembershipId, auth.membershipId),
          );
          const [row] = await tx
            .select()
            .from(characterPrivateNotebooks)
            .where(where)
            .for("update");
          if (row?.lastActionId === body.actionId) {
            insist(row.lastCommandHash === hash, "ACTION_ID_CONFLICT");
            return { text: row.text, revision: row.revision };
          }
          insist((row?.revision ?? 0) === body.revision, "NOTEBOOK_CONFLICT");
          const values = {
            text: body.text,
            revision: body.revision + 1,
            lastActionId: body.actionId,
            lastCommandHash: hash,
            updatedAt: new Date(),
          };
          if (row)
            await tx.update(characterPrivateNotebooks).set(values).where(where);
          else
            await tx.insert(characterPrivateNotebooks).values({
              ...values,
              campaignId: auth.campaignId,
              characterId: params.data.characterId,
              authorMembershipId: auth.membershipId,
            });
          // No shared events, snapshots, logs or broadcast contain notebook text.
          return { text: values.text, revision: values.revision };
        });
      } catch (error) {
        if (error instanceof ExtrasError)
          return reply.code(error.status).send({ error: error.code });
        return reply.code(500).send({ error: "NOTEBOOK_UNAVAILABLE" });
      }
    },
  );
  for (const operation of ["adjust", "reroll"] as const)
    app.post(
      "/api/characters/:characterId/inspiration/" + operation,
      async (request, reply) => {
        const auth = await requireAuth(request, reply, db);
        if (!auth) return;
        const params = paramsSchema.safeParse(request.params);
        const parsed = (
          operation === "adjust"
            ? inspirationAdjustSchema
            : inspirationRerollSchema
        ).safeParse(request.body);
        if (!params.success || !parsed.success)
          return reply.code(400).send({ error: "INVALID_REQUEST" });
        const body = parsed.data;
        const hash = createHash("sha256")
          .update(
            JSON.stringify({
              operation,
              characterId: params.data.characterId,
              body,
            }),
          )
          .digest("hex");
        try {
          const result = await db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${auth.campaignId + ":" + body.actionId}, 0))`,
            );
            const character = await access(
              tx,
              auth,
              params.data.characterId,
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
              const payload = prior.payload as {
                commandHash?: string;
                result?: unknown;
              };
              insist(
                prior.type === "character.inspiration" &&
                  prior.membershipId === auth.membershipId &&
                  payload.commandHash === hash,
                "ACTION_ID_CONFLICT",
              );
              return payload.result;
            }
            const before = inspirationState(character.resources);
            let after = before,
              messageId: string | null = null;
            if ("state" in body) {
              insist(auth.role === "GM", "GM_REQUIRED", 403);
              insist(
                body.revision === character.revision,
                "CHARACTER_CONFLICT",
              );
              after = body.state;
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
                );
              insist(thread, "CHAT_THREAD_NOT_FOUND");
              const [audit] = await tx
                .insert(chatMessages)
                .values({
                  campaignId: auth.campaignId,
                  membershipId: auth.membershipId,
                  characterId: character.id,
                  kind: "SYSTEM",
                  visibility: "PUBLIC",
                  threadId: thread.id,
                  body:
                    character.name +
                    " — Вдохновение: " +
                    before.current +
                    "/" +
                    before.maximum +
                    " → " +
                    after.current +
                    "/" +
                    after.maximum +
                    ". " +
                    body.reason,
                })
                .returning();
              insist(audit, "AUDIT_SAVE_FAILED");
              messageId = audit.id;
            } else {
              insist(before.current > 0, "NO_INSPIRATION");
              const source = await latestD20(tx, auth.campaignId, character.id);
              insist(
                source &&
                  source.message.id === body.sourceMessageId &&
                  source.message.membershipId === auth.membershipId &&
                  !source.message.inspirationSourceMessageId &&
                  eligible(source.result),
                "ROLL_NOT_ELIGIBLE",
              );
              const [used] = await tx
                .select({ id: chatMessages.id })
                .from(chatMessages)
                .where(
                  eq(
                    chatMessages.inspirationSourceMessageId,
                    body.sourceMessageId,
                  ),
                );
              insist(!used, "ROLL_ALREADY_REROLLED");
              // Freeze the original public modifiers. Never re-execute ability effects.
              const original = source.result;
              const modifierTotal = original.modifiers.reduce(
                (sum, item) => sum + item.value,
                0,
              );
              const fresh = rollFormulaWithMode(
                original.terms[0]!.notation + "+pinned",
                { pinned: modifierTotal },
                original.rollMode ?? "NORMAL",
                randomInt,
                original.label,
              );
              const dice: DiceResult = {
                ...fresh,
                formula: original.formula,
                modifiers: original.modifiers,
                styleFrame: original.styleFrame,
                inspiration: {
                  sourceMessageId: source.message.id,
                  sourceTotal: original.total,
                  sourceLabel: original.label ?? "d20",
                },
              };
              const [message] = await tx
                .insert(chatMessages)
                .values({
                  campaignId: auth.campaignId,
                  membershipId: auth.membershipId,
                  characterId: character.id,
                  kind: "DICE",
                  threadId: source.message.threadId,
                  visibility: "PUBLIC",
                  body: "Вдохновение: новый результат окончательный",
                  dice,
                  inspirationSourceMessageId: source.message.id,
                })
                .returning();
              insist(message, "ROLL_SAVE_FAILED");
              messageId = message.id;
              const [thread] = await tx
                .select()
                .from(chatThreads)
                .where(eq(chatThreads.id, source.message.threadId));
              await tx.insert(gameEvents).values({
                campaignId: auth.campaignId,
                actionId: randomUUID(),
                membershipId: auth.membershipId,
                type: "dice.created",
                entityType: "chat",
                entityId: message.id,
                payload: chatMessageDto(
                  message,
                  auth.displayName,
                  thread?.stream ?? null,
                ),
              });
              after = { ...before, current: before.current - 1 };
            }
            await tx
              .update(characters)
              .set({
                resources: { ...character.resources, inspiration: after },
                revision: character.revision + 1,
                updatedAt: new Date(),
              })
              .where(eq(characters.id, character.id));
            const result = {
              state: after,
              revision: character.revision + 1,
              messageId,
            };
            await tx.insert(gameEvents).values({
              campaignId: auth.campaignId,
              actionId: body.actionId,
              membershipId: auth.membershipId,
              type: "character.inspiration",
              entityType: "character",
              entityId: character.id,
              entityRevision: character.revision + 1,
              payload: {
                commandHash: hash,
                before,
                after,
                reason: "reason" in body ? body.reason : "Переброс",
                sourceMessageId:
                  "sourceMessageId" in body ? body.sourceMessageId : null,
                result,
              },
            });
            return result;
          });
          await broadcast(auth.campaignId);
          return result;
        } catch (error) {
          if (error instanceof ExtrasError)
            return reply.code(error.status).send({ error: error.code });
          throw error;
        }
      },
    );
}
