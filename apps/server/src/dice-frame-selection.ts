import { and, eq } from "drizzle-orm";
import { resolveDiceFrame, type DiceFrameChoice } from "@arken/contracts";
import { assets, catalogEntries, memberships } from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * UIX-457: рамка выбирается сервером в момент броска и сохраняется в истории.
 * Позже сменённая или удалённая рамка не переписывает прошлые броски.
 *
 * Рамка школы пока всегда пуста: заклинания из спелл-паков не бросаются, и
 * пути, откуда её взять, ещё нет. Место в `resolveDiceFrame` оставлено.
 */
export async function selectDiceFrame(
  db: Database,
  input: {
    campaignId: string;
    membershipId: string;
    sourceCatalogEntryId?: string | null;
  },
): Promise<DiceFrameChoice | null> {
  const [member] = await db
    .select({ assetId: memberships.diceFrameAssetId })
    .from(memberships)
    .innerJoin(assets, eq(assets.id, memberships.diceFrameAssetId))
    .where(
      and(
        eq(memberships.id, input.membershipId),
        eq(memberships.campaignId, input.campaignId),
        eq(assets.campaignId, input.campaignId),
        eq(assets.kind, "DICE_FRAME"),
      ),
    )
    .limit(1);
  const [skill] = input.sourceCatalogEntryId
    ? await db
        .select({ assetId: catalogEntries.diceFrameAssetId })
        .from(catalogEntries)
        .innerJoin(assets, eq(assets.id, catalogEntries.diceFrameAssetId))
        .where(
          and(
            eq(catalogEntries.id, input.sourceCatalogEntryId),
            eq(catalogEntries.campaignId, input.campaignId),
            eq(assets.campaignId, input.campaignId),
            eq(assets.kind, "DICE_FRAME"),
          ),
        )
        .limit(1)
    : [];
  return resolveDiceFrame({
    skill: skill?.assetId ?? null,
    school: null,
    player: member?.assetId ?? null,
  });
}
