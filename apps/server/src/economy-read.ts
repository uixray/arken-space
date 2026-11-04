import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import {
  economyMerchants,
  economyOffers,
  economyPurchases,
  economyQuotes,
  worldContent,
  worldContentInstances,
  worldInstanceBindings,
} from "@arken/db";
import type {
  EconomyHistoryDto,
  EconomyManagerDto,
  EconomyReceiptDto,
  ShopCatalogDto,
} from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { economyDate } from "./economy-math.js";
import { lockEconomy, type Database } from "./economy-state.js";
import { worldContentPlayerVisibleIn } from "./world-content.js";

const unboundStock = notExists(sql`(SELECT 1 FROM ${worldInstanceBindings}
  WHERE ${worldInstanceBindings.campaignId} = ${worldContentInstances.campaignId}
  AND (${worldInstanceBindings.instanceId} = ${worldContentInstances.id}
    OR ${worldInstanceBindings.containerInstanceId} = ${worldContentInstances.id}))`);
export async function readShopCatalog(
  db: Database,
  auth: AuthContext,
): Promise<ShopCatalogDto> {
  return db.transaction(async (tx) => {
    const { campaign, config } = await lockEconomy(tx, auth);
    if (!config?.enabled) return { enabled: false, date: null, merchants: [] };
    const regionRows = await tx
      .select({ id: worldContent.id, name: worldContent.name })
      .from(worldContent)
      .where(
        and(
          eq(worldContent.type, "LOCATION"),
          worldContentPlayerVisibleIn(auth.campaignId),
        ),
      );
    const regions = new Map(regionRows.map((r) => [r.id, r.name]));
    const merchants = await tx
      .select({
        id: economyMerchants.id,
        name: economyMerchants.name,
        regionId: economyMerchants.regionId,
      })
      .from(economyMerchants)
      .where(
        and(
          eq(economyMerchants.campaignId, auth.campaignId),
          eq(economyMerchants.visible, true),
        ),
      )
      .orderBy(economyMerchants.name)
      .limit(101);
    if (merchants.length > 100) throw new Error("ECONOMY_CATALOG_LIMIT");
    const rows = await tx
      .select({
        id: economyOffers.id,
        merchantId: economyOffers.merchantId,
        name: worldContent.name,
        override: worldContentInstances.displayNameOverride,
        quantity: worldContentInstances.quantity,
        condition: worldContentInstances.condition,
      })
      .from(economyOffers)
      .innerJoin(
        worldContentInstances,
        and(
          eq(worldContentInstances.id, economyOffers.instanceId),
          eq(worldContentInstances.campaignId, economyOffers.campaignId),
        ),
      )
      .innerJoin(
        worldContent,
        eq(worldContent.id, worldContentInstances.worldContentId),
      )
      .innerJoin(
        economyMerchants,
        and(
          eq(economyMerchants.id, economyOffers.merchantId),
          eq(economyMerchants.campaignId, economyOffers.campaignId),
        ),
      )
      .where(
        and(
          eq(economyOffers.campaignId, auth.campaignId),
          eq(economyOffers.visible, true),
          eq(economyMerchants.visible, true),
          eq(worldContent.type, "ITEM"),
          isNotNull(worldContent.basePriceCopper),
          worldContentPlayerVisibleIn(auth.campaignId),
          eq(worldContentInstances.discovered, true),
          isNull(worldContentInstances.inventoryCharacterId),
          isNull(worldContentInstances.ownerMembershipId),
          gt(worldContentInstances.quantity, 0),
          unboundStock,
        ),
      )
      .orderBy(economyOffers.id)
      .limit(501);
    if (rows.length > 500) throw new Error("ECONOMY_CATALOG_LIMIT");
    const d = economyDate(config, campaign.day);
    return {
      enabled: true,
      date: { year: d.year, month: d.month, day: d.day, season: d.season },
      merchants: merchants
        .filter(
          (m) =>
            regions.has(m.regionId) &&
            config.regions.some((r) => r.worldContentId === m.regionId),
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          region: regions.get(m.regionId)!,
          offers: rows
            .filter((r) => r.merchantId === m.id)
            .map((r) => ({
              id: r.id,
              name: r.override ?? r.name,
              quantity: r.quantity!,
              condition: r.condition,
            })),
        })),
    };
  });
}
export async function readEconomyManager(
  db: Database,
  auth: AuthContext,
): Promise<EconomyManagerDto> {
  if (auth.role !== "GM") throw new Error("ECONOMY_FORBIDDEN");
  return db.transaction(async (tx) => {
    const { config, economy } = await lockEconomy(tx, auth);
    const merchants = await tx
      .select()
      .from(economyMerchants)
      .where(eq(economyMerchants.campaignId, auth.campaignId))
      .orderBy(economyMerchants.name)
      .limit(101);
    const offers = await tx
      .select()
      .from(economyOffers)
      .where(eq(economyOffers.campaignId, auth.campaignId))
      .orderBy(economyOffers.id)
      .limit(501);
    const instances = await tx
      .select({
        id: worldContentInstances.id,
        canonicalName: worldContent.name,
        override: worldContentInstances.displayNameOverride,
        quantity: worldContentInstances.quantity,
        worldContentId: worldContent.id,
        worldRevision: worldContent.revision,
        basePriceCopper: worldContent.basePriceCopper,
      })
      .from(worldContentInstances)
      .innerJoin(
        worldContent,
        eq(worldContent.id, worldContentInstances.worldContentId),
      )
      .where(
        and(
          eq(worldContentInstances.campaignId, auth.campaignId),
          eq(worldContent.type, "ITEM"),
          ne(worldContent.lifecycle, "ARCHIVED"),
          isNotNull(worldContentInstances.quantity),
          isNull(worldContentInstances.inventoryCharacterId),
          isNull(worldContentInstances.ownerMembershipId),
          unboundStock,
        ),
      )
      .orderBy(worldContentInstances.id)
      .limit(1001);
    const regions = await tx
      .select({ id: worldContent.id, name: worldContent.name })
      .from(worldContent)
      .where(
        and(
          eq(worldContent.type, "LOCATION"),
          ne(worldContent.lifecycle, "ARCHIVED"),
        ),
      )
      .orderBy(worldContent.name)
      .limit(1001);
    if (
      merchants.length > 100 ||
      offers.length > 500 ||
      instances.length > 1000 ||
      regions.length > 1000
    )
      throw new Error("ECONOMY_CATALOG_LIMIT");
    return {
      revision: economy?.revision ?? null,
      config,
      merchants: merchants.map(({ campaignId: _, ...m }) => m),
      offers: offers.map(({ campaignId: _, ...o }) => o),
      instances: instances.map(
        ({ canonicalName, override, quantity, ...i }) => ({
          ...i,
          name: override ?? canonicalName,
          quantity: quantity!,
        }),
      ),
      regions,
    };
  });
}
export async function readEconomyHistory(
  db: Database,
  auth: AuthContext,
  cursor?: string,
): Promise<EconomyHistoryDto> {
  const visibility = and(
    eq(economyPurchases.campaignId, auth.campaignId),
    auth.role === "GM"
      ? undefined
      : eq(economyPurchases.actorMembershipId, auth.membershipId),
  );
  const [anchor] = cursor
    ? await db
        .select()
        .from(economyPurchases)
        .where(and(visibility, eq(economyPurchases.id, cursor)))
        .limit(1)
    : [];
  if (cursor && !anchor) throw new Error("ECONOMY_UNAVAILABLE");
  const rows = await db
    .select({
      id: economyPurchases.id,
      receipt: economyPurchases.receipt,
      // The query never selects private inputs for a player.
      ...(auth.role === "GM" ? { inputs: economyQuotes.inputs } : {}),
    })
    .from(economyPurchases)
    .innerJoin(economyQuotes, eq(economyQuotes.id, economyPurchases.quoteId))
    .where(
      and(
        visibility,
        anchor
          ? or(
              lt(economyPurchases.createdAt, anchor.createdAt),
              and(
                eq(economyPurchases.createdAt, anchor.createdAt),
                lt(economyPurchases.id, anchor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(economyPurchases.createdAt), desc(economyPurchases.id))
    .limit(26);
  const items = rows.slice(0, 25).map((r) => ({
    id: r.id,
    receipt: r.receipt as EconomyReceiptDto,
    ...(auth.role === "GM" && "inputs" in r ? { inputs: r.inputs } : {}),
  }));
  return { items, nextCursor: rows.length > 25 ? items.at(-1)!.id : null };
}
