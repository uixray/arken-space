import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  characterCatalogEntries,
  characters,
  chatMessages,
  gameEvents,
} from "@arken/db";
import type { AuthContext } from "./auth.js";
import { canAccessCharacter } from "./character-access.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const object = z.record(z.string(), z.unknown());
const receiptSchema = z.object({
  version: z.literal(1),
  entry: z
    .object({
      id: z.string().uuid(),
      beforeData: object,
      afterRevision: z.number().int().nonnegative(),
    })
    .nullable(),
  characters: z
    .array(
      z.object({
        id: z.string().uuid(),
        beforeResources: object,
        afterRevision: z.number().int().nonnegative(),
      }),
    )
    .max(10000),
});
export const undoApplicationCommandSchema = z
  .object({ actionId: z.string().uuid(), messageId: z.string().uuid() })
  .strict();

/** Restore only untouched revisions, atomically. Legacy events without a
 * complete preimage fail closed rather than guessing the player's resources. */
export async function undoApplication(
  db: Database,
  auth: AuthContext,
  input: unknown,
) {
  const command = undoApplicationCommandSchema.parse(input);
  return db.transaction(
    async (tx) => {
      // Serialize both retries and different undo attempts for the same message.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${auth.campaignId + ":undo:" + command.messageId}, 0))`,
      );
      const [priorAction] = await tx
        .select()
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.actionId, command.actionId),
          ),
        )
        .limit(1);
      if (priorAction) {
        if (
          priorAction.type === "entry.undo" &&
          priorAction.membershipId === auth.membershipId &&
          (priorAction.payload as { originalMessageId?: string } | null)
            ?.originalMessageId === command.messageId
        )
          return {
            duplicate: true as const,
            message: null,
            event: null,
            originalAuthorId: null,
          };
        throw new Error("ACTION_CONFLICT");
      }
      const [original] = await tx
        .select()
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.entityType, "chat"),
            eq(gameEvents.entityId, command.messageId),
            inArray(gameEvents.type, ["entry.roll", "ability.area.applied"]),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !original ||
        (auth.role !== "GM" && original.membershipId !== auth.membershipId)
      )
        throw new Error("UNDO_FORBIDDEN");
      const [already] = await tx
        .select({ sequence: gameEvents.sequence })
        .from(gameEvents)
        .where(
          and(
            eq(gameEvents.campaignId, auth.campaignId),
            eq(gameEvents.type, "entry.undo"),
            sql`${gameEvents.payload}->>'originalMessageId' = ${command.messageId}`,
          ),
        )
        .limit(1);
      if (already)
        return {
          duplicate: true as const,
          message: null,
          event: null,
          originalAuthorId: null,
        };
      const payload = original.payload as { undoReceipt?: unknown } | null;
      const parsed = receiptSchema.safeParse(payload?.undoReceipt);
      if (!parsed.success) throw new Error("UNDO_NOT_AVAILABLE");
      const receipt = parsed.data;
      if (
        new Set(receipt.characters.map((item) => item.id)).size !==
        receipt.characters.length
      )
        throw new Error("UNDO_NOT_AVAILABLE");
      const [oldMessage] = await tx
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.id, command.messageId),
            eq(chatMessages.campaignId, auth.campaignId),
          ),
        )
        .limit(1);
      if (!oldMessage) throw new Error("UNDO_NOT_AVAILABLE");
      for (const item of [...receipt.characters].sort((a, b) =>
        a.id.localeCompare(b.id),
      )) {
        const [current] = await tx
          .select({ revision: characters.revision })
          .from(characters)
          .where(
            and(
              eq(characters.id, item.id),
              eq(characters.campaignId, auth.campaignId),
            ),
          )
          .limit(1)
          .for("update");
        if (!current || current.revision !== item.afterRevision)
          throw new Error("UNDO_CONFLICT");
      }
      if (!oldMessage.characterId) throw new Error("UNDO_NOT_AVAILABLE");
      const [caster] = await tx
        .select()
        .from(characters)
        .where(
          and(
            eq(characters.id, oldMessage.characterId),
            eq(characters.campaignId, auth.campaignId),
          ),
        )
        .limit(1)
        .for("share");
      if (!(await canAccessCharacter(tx as unknown as Database, auth, caster)))
        throw new Error("UNDO_FORBIDDEN");
      if (receipt.entry) {
        const [current] = await tx
          .select({ revision: characterCatalogEntries.revision })
          .from(characterCatalogEntries)
          .innerJoin(
            characters,
            eq(characters.id, characterCatalogEntries.characterId),
          )
          .where(
            and(
              eq(characterCatalogEntries.id, receipt.entry.id),
              eq(characters.campaignId, auth.campaignId),
            ),
          )
          .limit(1)
          .for("update");
        if (!current || current.revision !== receipt.entry.afterRevision)
          throw new Error("UNDO_CONFLICT");
      }
      for (const item of receipt.characters) {
        await tx
          .update(characters)
          .set({
            resources:
              item.beforeResources as typeof characters.$inferSelect.resources,
            revision: item.afterRevision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characters.id, item.id),
              eq(characters.revision, item.afterRevision),
            ),
          );
      }
      if (receipt.entry)
        await tx
          .update(characterCatalogEntries)
          .set({
            data: receipt.entry.beforeData,
            revision: receipt.entry.afterRevision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(characterCatalogEntries.id, receipt.entry.id),
              eq(characterCatalogEntries.revision, receipt.entry.afterRevision),
            ),
          );
      if (
        !oldMessage.dice ||
        typeof oldMessage.dice !== "object" ||
        Array.isArray(oldMessage.dice)
      )
        throw new Error("UNDO_NOT_AVAILABLE");
      await tx
        .update(chatMessages)
        .set({
          dice: { ...oldMessage.dice, applicationUndo: { cancelled: true } },
        })
        .where(eq(chatMessages.id, oldMessage.id));
      const [message] = await tx
        .insert(chatMessages)
        .values({
          campaignId: auth.campaignId,
          membershipId: auth.membershipId,
          characterId: oldMessage.characterId,
          threadId: oldMessage.threadId,
          visibility: oldMessage.visibility,
          kind: "TEXT",
          body: `Отменено применение: ${oldMessage.body.slice(0, 160)}`,
        })
        .returning();
      if (!message) throw new Error("UNDO_SAVE_FAILED");
      const [event] = await tx
        .insert(gameEvents)
        .values({
          campaignId: auth.campaignId,
          actionId: command.actionId,
          membershipId: auth.membershipId,
          type: "entry.undo",
          entityType: "chat",
          entityId: message.id,
          payload: { originalMessageId: command.messageId },
        })
        .returning();
      if (!event) throw new Error("UNDO_SAVE_FAILED");
      return {
        duplicate: false as const,
        message,
        event,
        originalAuthorId: oldMessage.membershipId,
      };
    },
    { isolationLevel: "serializable" },
  );
}
