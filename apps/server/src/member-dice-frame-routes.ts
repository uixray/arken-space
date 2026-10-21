import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { memberDiceFrameUpdateSchema } from "@arken/contracts";
import { assets, memberships } from "@arken/db";
import { requireAuth } from "./auth.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** Рамка обязана быть рамкой и жить в той же кампании, что и выбор. */
export async function isCampaignDiceFrame(
  db: Database,
  campaignId: string,
  assetId: string,
) {
  const [frame] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.campaignId, campaignId),
        eq(assets.kind, "DICE_FRAME"),
      ),
    )
    .limit(1);
  return Boolean(frame);
}

/**
 * UIX-457: игрок сам выбирает рамку своих бросков. Это предпочтение членства:
 * за разных персонажей рамка одна. Значение абсолютное, поэтому повтор или
 * гонка двух вкладок сходятся без ревизии.
 */
export function registerMemberDiceFrameRoutes(
  app: FastifyInstance,
  db: Database,
) {
  app.patch("/api/me/dice-frame", async (request, reply) => {
    const auth = await requireAuth(request, reply, db);
    if (!auth) return;
    const body = memberDiceFrameUpdateSchema.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "INVALID_DICE_FRAME_REQUEST" });
    const { diceFrameAssetId } = body.data;
    if (
      diceFrameAssetId !== null &&
      !(await isCampaignDiceFrame(db, auth.campaignId, diceFrameAssetId))
    )
      return reply.code(404).send({ error: "DICE_FRAME_NOT_FOUND" });
    const [updated] = await db
      .update(memberships)
      .set({ diceFrameAssetId })
      .where(
        and(
          eq(memberships.id, auth.membershipId),
          eq(memberships.campaignId, auth.campaignId),
        ),
      )
      .returning({
        id: memberships.id,
        diceFrameAssetId: memberships.diceFrameAssetId,
      });
    if (!updated) return reply.code(404).send({ error: "MEMBER_NOT_FOUND" });
    return updated;
  });
}
