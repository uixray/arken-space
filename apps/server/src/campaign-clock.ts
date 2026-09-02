import { and, eq } from "drizzle-orm";
import { entryDataSchema } from "@arken/contracts";
import { characterCatalogEntries, characters } from "@arken/db";
import { normalizeLegacyEntryData } from "./entry-data.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type RechargeTrigger = "ADVANCE_DAY" | "LONG_REST" | "END_BATTLE";

export async function campaignRechargeAnchorsNeedReset(
  db: Database,
  campaignId: string,
) {
  const entryRows = await db
    .select({ entry: characterCatalogEntries })
    .from(characterCatalogEntries)
    .innerJoin(
      characters,
      eq(characterCatalogEntries.characterId, characters.id),
    )
    .where(eq(characters.campaignId, campaignId));

  return entryRows.some(({ entry }) => {
    const parsed = entryDataSchema.safeParse(
      normalizeLegacyEntryData(entry.data),
    );
    if (!parsed.success || !parsed.data.uses) return false;
    const uses = parsed.data.uses;
    return uses.recharge === "BATTLE"
      ? (uses.lastBattleCounter ?? 0) !== 0
      : (uses.lastRechargeDay ?? 1) !== 1;
  });
}

export async function rechargeCampaignCatalogEntries(
  tx: Transaction,
  campaignId: string,
  input: {
    trigger: RechargeTrigger;
    day: number;
    battleCounter: number;
  },
) {
  const entryRows = await tx
    .select({ entry: characterCatalogEntries })
    .from(characterCatalogEntries)
    .innerJoin(
      characters,
      eq(characterCatalogEntries.characterId, characters.id),
    )
    .where(eq(characters.campaignId, campaignId));

  const advancesDay =
    input.trigger === "ADVANCE_DAY" || input.trigger === "LONG_REST";
  let recharged = 0;
  for (const { entry } of entryRows) {
    const parsed = entryDataSchema.safeParse(
      normalizeLegacyEntryData(entry.data),
    );
    if (!parsed.success || !parsed.data.uses) continue;
    const uses = parsed.data.uses;
    const due =
      (advancesDay && uses.recharge === "DAY") ||
      (input.trigger === "END_BATTLE" && uses.recharge === "BATTLE") ||
      (advancesDay &&
        uses.recharge === "WEEK" &&
        input.day - (uses.lastRechargeDay ?? 1) >= 7);
    if (!due) continue;

    const nextUses = {
      ...uses,
      current: uses.max,
      ...(uses.recharge === "WEEK" || uses.recharge === "DAY"
        ? { lastRechargeDay: input.day }
        : {}),
      ...(uses.recharge === "BATTLE"
        ? { lastBattleCounter: input.battleCounter }
        : {}),
    };
    const [updated] = await tx
      .update(characterCatalogEntries)
      .set({
        data: { ...parsed.data, uses: nextUses },
        revision: entry.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characterCatalogEntries.id, entry.id),
          eq(characterCatalogEntries.revision, entry.revision),
        ),
      )
      .returning({ id: characterCatalogEntries.id });
    if (!updated) throw new Error("ENTRY_CONFLICT");
    recharged++;
  }
  return recharged;
}

export async function resetCampaignRechargeAnchors(
  tx: Transaction,
  campaignId: string,
) {
  const entryRows = await tx
    .select({ entry: characterCatalogEntries })
    .from(characterCatalogEntries)
    .innerJoin(
      characters,
      eq(characterCatalogEntries.characterId, characters.id),
    )
    .where(eq(characters.campaignId, campaignId));

  let rebased = 0;
  for (const { entry } of entryRows) {
    const parsed = entryDataSchema.safeParse(
      normalizeLegacyEntryData(entry.data),
    );
    if (!parsed.success || !parsed.data.uses) continue;
    const uses = parsed.data.uses;
    const battleAnchorStale =
      uses.recharge === "BATTLE" && (uses.lastBattleCounter ?? 0) !== 0;
    const dayAnchorStale =
      uses.recharge !== "BATTLE" && (uses.lastRechargeDay ?? 1) !== 1;
    if (!battleAnchorStale && !dayAnchorStale) continue;
    const nextUses = battleAnchorStale
      ? { ...uses, lastBattleCounter: 0 }
      : { ...uses, lastRechargeDay: 1 };

    const [updated] = await tx
      .update(characterCatalogEntries)
      .set({
        data: { ...parsed.data, uses: nextUses },
        revision: entry.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characterCatalogEntries.id, entry.id),
          eq(characterCatalogEntries.revision, entry.revision),
        ),
      )
      .returning({ id: characterCatalogEntries.id });
    if (!updated) throw new Error("ENTRY_CONFLICT");
    rebased++;
  }
  return rebased;
}
