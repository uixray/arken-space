import { and, eq, or, sql } from "drizzle-orm";
import { characters, worldContent, worldInstanceBindings } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export class InventoryAssignmentError extends Error {}

/** Same lock/order as the existing container graph writer. */
export async function lockInventoryGraph(tx: Transaction, campaignId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${campaignId + ":instance-bindings"}, 0))`,
  );
}

/** Called inside the instance mutation transaction, before CAS/audit. */
export async function validateInventoryAssignment(
  tx: Transaction,
  campaignId: string,
  instance: {
    id?: string;
    worldContentId: string;
    inventoryCharacterId: string | null;
    quantity: number | null;
  },
  requireActive: boolean,
) {
  if (!instance.inventoryCharacterId) return;
  if (instance.id) {
    const links = await tx
      .select()
      .from(worldInstanceBindings)
      .where(
        and(
          eq(worldInstanceBindings.campaignId, campaignId),
          or(
            eq(worldInstanceBindings.instanceId, instance.id),
            eq(worldInstanceBindings.containerInstanceId, instance.id),
          ),
        ),
      );
    if (links.some((link) => link.containerInstanceId != null))
      throw new InventoryAssignmentError("INVENTORY_DETACH_CONTAINER_FIRST");
  }
  if (instance.quantity == null || instance.quantity <= 0)
    throw new InventoryAssignmentError("INVENTORY_POSITIVE_QUANTITY_REQUIRED");
  const [entity] = await tx
    .select({ type: worldContent.type })
    .from(worldContent)
    .where(eq(worldContent.id, instance.worldContentId))
    .limit(1)
    .for("share");
  if (entity?.type !== "ITEM")
    throw new InventoryAssignmentError("INVENTORY_ITEM_REQUIRED");
  const [character] = await tx
    .select({ lifecycle: characters.lifecycle })
    .from(characters)
    .where(
      and(
        eq(characters.id, instance.inventoryCharacterId),
        eq(characters.campaignId, campaignId),
      ),
    )
    .limit(1)
    .for("share");
  if (!character || (requireActive && character.lifecycle !== "ACTIVE"))
    throw new InventoryAssignmentError("INVENTORY_CHARACTER_UNAVAILABLE");
}
