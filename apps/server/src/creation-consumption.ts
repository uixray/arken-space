import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { characterCatalogEntries, creationObjects, worldContentInstances } from "@arken/db";
import type { AuthContext } from "./auth.js";
import type { CreationTransaction } from "./creation-state.js";
import { assertCreationEntryUsable, mutateCreationObject } from "./creation-runtime-state.js";

/** Internal only. Caller holds inventory graph -> character -> entry/object/instance
 * locks and has validated approval/binding. Caller owns receipt and whole transaction.
 * This primitive never grants a refund or authorises an application on its own. */
export async function consumeCreationObject(tx: CreationTransaction, campaignId: string,
  object: typeof creationObjects.$inferSelect,
  instance: typeof worldContentInstances.$inferSelect | undefined, now: Date) {
  if (object.campaignId !== campaignId || object.status !== "ACTIVE" || !object.entryId ||
      (object.instanceId !== null && (!instance || instance.id !== object.instanceId || instance.campaignId !== campaignId ||
        instance.inventoryCharacterId !== object.characterId || instance.ownerMembershipId !== null || instance.quantity !== 1)))
    throw new Error("CREATION_OBJECT_UNAVAILABLE");
  return mutateCreationObject(tx, object.id, async () => {
    // Detach before deleting: the immutable historical object remains, while the
    // live entry cannot remain usable as a numeric modifier after consumption.
    const [changed] = await tx.update(creationObjects).set({ status: "CONSUMED", entryId: null, revision: object.revision + 1 })
      .where(and(eq(creationObjects.id, object.id), eq(creationObjects.campaignId, campaignId),
        eq(creationObjects.status, "ACTIVE"), eq(creationObjects.revision, object.revision))).returning({ id: creationObjects.id });
    if (!changed) throw new Error("CREATION_CONFLICT");
    const [removed] = await tx.delete(characterCatalogEntries).where(and(eq(characterCatalogEntries.id, object.entryId!),
      eq(characterCatalogEntries.characterId, object.characterId))).returning({ id: characterCatalogEntries.id });
    if (!removed) throw new Error("CREATION_DATA_UNAVAILABLE");
    if (!object.instanceId || !instance) return null;
    const revision = instance.revision + 1;
    const [consumed] = await tx.update(worldContentInstances).set({ quantity: 0, inventoryCharacterId: null, revision, updatedAt: now })
      .where(and(eq(worldContentInstances.id, instance.id), eq(worldContentInstances.campaignId, campaignId),
        eq(worldContentInstances.revision, instance.revision), eq(worldContentInstances.quantity, 1)))
      .returning({ id: worldContentInstances.id });
    if (!consumed) throw new Error("CREATION_CONFLICT");
    return { id: instance.id, revision, quantity: 0, effect: "CONSUME" as const };
  });
}

/** Application adapter, called only inside the original replay-protected action
 * transaction AFTER its resource/use updates and BEFORE its durable event.
 * Graph -> character -> entry locks are the caller's responsibility. */
export async function consumeCreationApplication(tx: CreationTransaction, auth: AuthContext,
  entry: typeof characterCatalogEntries.$inferSelect,
  character: { id: string; campaignId: string }, now: Date) {
  const bound = await assertCreationEntryUsable(tx, auth, entry, character);
  if (!bound) throw new Error("CREATION_OBJECT_UNAVAILABLE");
  if (bound.snapshot.entryData.creationConsumption !== "BOUND_ITEM_ON_APPLICATION") throw new Error("CREATION_DATA_UNAVAILABLE");
  const [object] = await tx.select().from(creationObjects).where(and(eq(creationObjects.id, bound.obj.id),
    eq(creationObjects.campaignId, auth.campaignId))).limit(1).for("update");
  if (!object || object.status !== "ACTIVE" || object.entryId !== entry.id || object.characterId !== character.id ||
      object.kind !== "ARTIFACT" || !object.instanceId || !bound.snapshot.baseItemId)
    throw new Error("CREATION_OBJECT_UNAVAILABLE");
  const [instance] = await tx.select().from(worldContentInstances).where(and(eq(worldContentInstances.id, object.instanceId),
    eq(worldContentInstances.campaignId, auth.campaignId))).limit(1).for("update");
  if (!instance || instance.worldContentId !== bound.snapshot.baseItemId)
    throw new Error("CREATION_DATA_UNAVAILABLE");
  const consumed = await consumeCreationObject(tx, auth.campaignId, object, instance, now);
  if (!consumed) throw new Error("CREATION_DATA_UNAVAILABLE");
  // Caller may include this in the existing receipt/event, never a second action.
  return { objectId: object.id, entryId: entry.id, instanceId: consumed.id,
    objectRevision: object.revision + 1, instanceRevision: consumed.revision,
    entry: { characterId: entry.characterId, kind: entry.kind, name: entry.name,
      description: entry.description, data: entry.data, revision: entry.revision,
      createdAt: entry.createdAt.toISOString() } };
}

export const consumptionReceiptSchema = z.object({
  objectId: z.string().uuid(), entryId: z.string().uuid(), instanceId: z.string().uuid(),
  objectRevision: z.number().int().nonnegative(), instanceRevision: z.number().int().nonnegative(),
  entry: z.object({ characterId: z.string().uuid(), kind: z.enum(["SKILL", "ABILITY"]),
    name: z.string(), description: z.string(), data: z.record(z.string(), z.unknown()),
    revision: z.number().int().nonnegative(), createdAt: z.string().datetime() }).strict(),
}).strict();

/** Only an unchanged consumed binding can be restored. The caller holds the
 * inventory graph lock and validates the durable receipt and actor first. */
export async function restoreCreationConsumption(tx: CreationTransaction, campaignId: string,
  messageId: string, casterId: string, receipt: z.infer<typeof consumptionReceiptSchema>) {
  if (receipt.entry.characterId !== casterId) throw new Error("UNDO_NOT_AVAILABLE");
  const [object] = await tx.select().from(creationObjects).where(and(eq(creationObjects.id, receipt.objectId),
    eq(creationObjects.campaignId, campaignId))).limit(1).for("update");
  const [instance] = await tx.select().from(worldContentInstances).where(and(eq(worldContentInstances.id, receipt.instanceId),
    eq(worldContentInstances.campaignId, campaignId))).limit(1).for("update");
  const [existing] = await tx.select({ id: characterCatalogEntries.id }).from(characterCatalogEntries)
    .where(eq(characterCatalogEntries.id, receipt.entryId)).limit(1);
  if (!object || object.status !== "CONSUMED" || object.entryId !== null || object.characterId !== casterId ||
      object.instanceId !== receipt.instanceId || object.revision !== receipt.objectRevision || !instance ||
      instance.revision !== receipt.instanceRevision || instance.quantity !== 0 || instance.inventoryCharacterId !== null ||
      instance.ownerMembershipId !== null || existing) throw new Error("UNDO_CONFLICT");
  await mutateCreationObject(tx, object.id, async () => {
    await tx.execute(sql`select set_config('arken.creation_undo_message', ${messageId}, true)`);
    await tx.insert(characterCatalogEntries).values({ id: receipt.entryId, characterId: casterId,
      sourceCatalogEntryId: null, kind: receipt.entry.kind, name: receipt.entry.name,
      description: receipt.entry.description, data: receipt.entry.data,
      // The application may itself have incremented the entry once before it was removed.
      revision: receipt.entry.revision + 2, createdAt: new Date(receipt.entry.createdAt), updatedAt: new Date() });
    const [restoredInstance] = await tx.update(worldContentInstances).set({ quantity: 1, inventoryCharacterId: casterId,
      revision: instance.revision + 1, updatedAt: new Date() }).where(and(eq(worldContentInstances.id, instance.id),
        eq(worldContentInstances.revision, instance.revision), eq(worldContentInstances.quantity, 0))).returning({ id: worldContentInstances.id });
    if (!restoredInstance) throw new Error("UNDO_CONFLICT");
    const [restoredObject] = await tx.update(creationObjects).set({ status: "ACTIVE", entryId: receipt.entryId,
      revision: object.revision + 1 }).where(and(eq(creationObjects.id, object.id), eq(creationObjects.status, "CONSUMED"),
        eq(creationObjects.revision, object.revision))).returning({ id: creationObjects.id });
    if (!restoredObject) throw new Error("UNDO_CONFLICT");
    await tx.execute(sql`select set_config('arken.creation_undo_message', '', true)`);
  });
}
