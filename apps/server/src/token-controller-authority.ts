import {tokenDefinitions,tokenControllers} from "@arken/db";
import {and,eq} from "drizzle-orm";
type CanvasTransaction=import("./campaign-pause-guard.js").CampaignCanvasTransaction;
export async function currentTokenController(
  tx: CanvasTransaction,
  campaignId: string,
  definitionId: string,
  membershipId: string,
) {
  const [definition] = await tx
    .select({ id: tokenDefinitions.id })
    .from(tokenDefinitions)
    .where(
      and(
        eq(tokenDefinitions.id, definitionId),
        eq(tokenDefinitions.campaignId, campaignId),
      ),
    )
    .limit(1)
    .for("share");
  if (!definition) return false;
  const [controller] = await tx
    .select({ id: tokenControllers.membershipId })
    .from(tokenControllers)
    .where(
      and(
        eq(tokenControllers.tokenDefinitionId, definitionId),
        eq(tokenControllers.membershipId, membershipId),
      ),
    )
    .limit(1);
  return Boolean(controller);
}
