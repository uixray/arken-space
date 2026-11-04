import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { characterControllers, characters, gameEvents, memberships } from "@arken/db";
import { abilityAreaApplySchema, type AbilityAreaApply } from "@arken/contracts";
import { lockEntryApplication } from "./entry-application-state.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
// Preserve the existing area hash exactly; do not migrate historical receipts.
export const areaApplicationHash = (command: AbilityAreaApply) => createHash("sha256").update(JSON.stringify(command)).digest("hex");
export function areaApplicationReplay(prior: typeof gameEvents.$inferSelect, membershipId: string, hash: string) {
  const receipt = z.object({ requestHash: z.string(), messageId: z.string().uuid().optional() }).safeParse(prior.payload);
  if (prior.membershipId !== membershipId || !receipt.success || receipt.data.requestHash !== hash)
    throw new Error("ACTION_CONFLICT");
  if (prior.type === "ability.area.cancelled")
    return { actionId: prior.actionId, cancelled: true as const, notApplied: true as const };
  if (prior.type !== "ability.area.applied" || !receipt.data.messageId || receipt.data.messageId !== prior.entityId)
    throw new Error("ACTION_CONFLICT");
  return { actionId: prior.actionId, duplicate: true, messageId: receipt.data.messageId };
}
export async function cancelAbilityArea(db: Database, auth: { campaignId: string; membershipId: string }, input: unknown) {
  const command = abilityAreaApplySchema.parse(input), hash = areaApplicationHash(command);
  return db.transaction(async tx => {
    await lockEntryApplication(tx, auth.campaignId, command.actionId);
    const [actor] = await tx.select({ role: memberships.role, revoked: memberships.accessRevokedAt }).from(memberships)
      .where(and(eq(memberships.id, auth.membershipId), eq(memberships.campaignId, auth.campaignId))).limit(1).for("share");
    if (!actor || actor.revoked) throw new Error("AREA_FORBIDDEN");
    const [prior] = await tx.select().from(gameEvents).where(and(eq(gameEvents.campaignId, auth.campaignId),
      eq(gameEvents.actionId, command.actionId))).limit(1);
    if (prior) return areaApplicationReplay(prior, auth.membershipId, hash);
    // The entry itself may already have been consumed, but an untrusted caller
    // must not reserve an action ID for a character they do not control.
    const [character] = await tx.select({ owner: characters.ownerMembershipId }).from(characters)
      .where(and(eq(characters.id, command.characterId), eq(characters.campaignId, auth.campaignId))).limit(1).for("share");
    if (!character) throw new Error("AREA_FORBIDDEN");
    if (actor.role !== "GM" && character.owner !== auth.membershipId) {
      const [controller] = await tx.select({ id: characterControllers.membershipId }).from(characterControllers)
        .where(and(eq(characterControllers.characterId, command.characterId),
          eq(characterControllers.membershipId, auth.membershipId))).limit(1).for("share");
      if (!controller) throw new Error("AREA_FORBIDDEN");
    }
    const [cancelled] = await tx.insert(gameEvents).values({ campaignId: auth.campaignId, membershipId: auth.membershipId,
      actionId: command.actionId, type: "ability.area.cancelled", entityType: "action", entityId: command.actionId,
      entityRevision: 0, payload: { requestHash: hash },
    }).returning();
    if (!cancelled) throw new Error("EVENT_RECORD_FAILED");
    return areaApplicationReplay(cancelled, auth.membershipId, hash);
  });
}
