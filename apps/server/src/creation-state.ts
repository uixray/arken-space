import { createHash } from "node:crypto";
import { cancelCreationCommandSchema, creationCommandDefinitions, creationCancellationReceiptSchema } from "@arken/contracts";
import { and, eq, sql } from "drizzle-orm";
import { campaigns, creationActions, gameEvents, memberships, worldContentInstanceActions } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { lockInventoryGraph } from "./inventory-assignment.js";

export type CreationDatabase = ReturnType<typeof import("@arken/db").createDatabase>["db"];
export type CreationTransaction = Parameters<Parameters<CreationDatabase["transaction"]>[0]>[0];
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("CREATION_DATA_UNAVAILABLE");
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item)).join(",") + "}";
}
export const creationHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export async function requireCreationMember(tx: CreationTransaction, auth: AuthContext) {
  const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns)
    .where(eq(campaigns.id, auth.campaignId)).limit(1).for("share");
  const [member] = await tx.select({ role: memberships.role, accessRevokedAt: memberships.accessRevokedAt }).from(memberships)
    .where(and(eq(memberships.id, auth.membershipId), eq(memberships.campaignId, auth.campaignId))).limit(1).for("share");
  if (!campaign || !member || member.role !== auth.role || member.accessRevokedAt) throw new Error("CREATION_FORBIDDEN");
}
/** Same action-key -> inventory graph -> campaign/member order as economy/inventory.
 * Future craft/merge writers must join this order, not lock an object first. */
export function creationAction(db: CreationDatabase, auth: AuthContext, actionId: string,
  type: string, body: unknown, run: (tx: CreationTransaction) => Promise<Record<string, unknown>>) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${auth.campaignId + ":" + actionId}, 0))`);
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const requestHash = creationHash({ type, body });
    const [prior] = await tx.select().from(creationActions).where(and(
      eq(creationActions.campaignId, auth.campaignId), eq(creationActions.actionId, actionId))).limit(1);
    if (prior) {
      if (prior.actorMembershipId !== auth.membershipId || prior.type !== type || prior.requestHash !== requestHash)
        throw new Error("CREATION_ACTION_CONFLICT");
      if (!prior.receipt || typeof prior.receipt !== "object" || Array.isArray(prior.receipt))
        throw new Error("CREATION_DATA_UNAVAILABLE");
      return { ...prior.receipt, duplicate: true };
    }
    const [event] = await tx.select({ id: gameEvents.actionId }).from(gameEvents).where(and(
      eq(gameEvents.campaignId, auth.campaignId), eq(gameEvents.actionId, actionId))).limit(1);
    const [instanceAction] = await tx.select({ id: worldContentInstanceActions.actionId }).from(worldContentInstanceActions).where(and(
      eq(worldContentInstanceActions.campaignId, auth.campaignId), eq(worldContentInstanceActions.actionId, actionId))).limit(1);
    if (event || instanceAction) throw new Error("CREATION_ACTION_CONFLICT");
    const receipt = await run(tx);
    await tx.insert(creationActions).values({ campaignId: auth.campaignId, actionId,
      actorMembershipId: auth.membershipId, type, requestHash, receipt });
    // Only a key reservation, never private recipe/lore/review payload in common events.
    await tx.insert(gameEvents).values({ campaignId: auth.campaignId, membershipId: auth.membershipId,
      actionId, type: creationCancellationReceiptSchema.safeParse(receipt).success ? "creation.action.cancelled" : type,
      entityType: "creation", entityId: null, payload: { requestHash } });
    return { ...receipt, duplicate: false };
  });
}

/** The same action/graph/member locks and exact original request hash arbitrate
 * apply versus cancellation. Prior applied results win; cancellation is not undo. */
export function cancelCreationAction(db: CreationDatabase, auth: AuthContext, input: unknown) {
  const command = cancelCreationCommandSchema.parse(input);
  const definition = creationCommandDefinitions[`${command.method} ${command.path}`];
  if (!definition) throw new Error("CREATION_ACTION_CONFLICT");
  const body = definition.schema.parse(command.body) as Record<string, unknown> & { actionId: string };
  return creationAction(db, auth, body.actionId, definition.type, body, async () =>
    ({ actionId: body.actionId, outcome: "CANCELLED", type: definition.type }));
}
