import { and, eq, inArray, ne } from "drizzle-orm";
import {
  campaignEconomies,
  economyMerchants,
  economyOffers,
  worldContent,
} from "@arken/db";
import {
  saveEconomyConfigSchema,
  saveMerchantSchema,
  saveShopOfferSchema,
} from "@arken/contracts";
import type { z } from "zod";
import type { AuthContext } from "./auth.js";
import {
  lockEconomy,
  lockEconomyAction,
  recordEconomyAction,
  requireStock,
  scope,
  type Database,
} from "./economy-state.js";

export async function saveEconomyConfig(
  db: Database,
  auth: AuthContext,
  body: z.infer<typeof saveEconomyConfigSchema>,
) {
  if (auth.role !== "GM") throw new Error("ECONOMY_FORBIDDEN");
  return db.transaction(async (tx) => {
    const action = await lockEconomyAction(
      tx,
      auth,
      body.actionId,
      "economy.config",
      body,
    );
    const state = await lockEconomy(tx, auth);
    if (action.duplicate) return { duplicate: true };
    if ((state.economy?.revision ?? null) !== body.revision)
      throw new Error("ECONOMY_CONFLICT");
    const ids = body.config.regions.map((r) => r.worldContentId);
    const regions = await tx
      .select()
      .from(worldContent)
      .where(inArray(worldContent.id, ids))
      .for("share");
    if (
      regions.length !== ids.length ||
      regions.some((r) => r.type !== "LOCATION" || r.lifecycle === "ARCHIVED")
    )
      throw new Error("ECONOMY_INVALID_REGION");
    const revision = (state.economy?.revision ?? -1) + 1;
    if (state.economy)
      await tx
        .update(campaignEconomies)
        .set({ config: body.config, revision })
        .where(eq(campaignEconomies.campaignId, auth.campaignId));
    else
      await tx
        .insert(campaignEconomies)
        .values({ campaignId: auth.campaignId, config: body.config, revision });
    await recordEconomyAction(
      tx,
      auth,
      body.actionId,
      "economy.config",
      action.hash,
      auth.campaignId,
      revision,
    );
    return { revision };
  });
}
export async function saveMerchant(
  db: Database,
  auth: AuthContext,
  body: z.infer<typeof saveMerchantSchema>,
) {
  if (auth.role !== "GM") throw new Error("ECONOMY_FORBIDDEN");
  return db.transaction(async (tx) => {
    const action = await lockEconomyAction(
      tx,
      auth,
      body.actionId,
      "economy.merchant",
      body,
    );
    const state = await lockEconomy(tx, auth);
    if (action.duplicate) return { duplicate: true };
    if (!state.config?.regions.some((r) => r.worldContentId === body.regionId))
      throw new Error("ECONOMY_INVALID_REGION");
    const [region] = await tx
      .select()
      .from(worldContent)
      .where(eq(worldContent.id, body.regionId))
      .limit(1)
      .for("share");
    if (region?.type !== "LOCATION" || region.lifecycle === "ARCHIVED")
      throw new Error("ECONOMY_INVALID_REGION");
    const [old] = await tx
      .select()
      .from(economyMerchants)
      .where(scope(auth.campaignId, body.id, economyMerchants))
      .limit(1)
      .for("update");
    if ((old?.revision ?? null) !== body.revision)
      throw new Error("ECONOMY_CONFLICT");
    if (!old) {
      const rows = await tx
        .select({ id: economyMerchants.id })
        .from(economyMerchants)
        .where(eq(economyMerchants.campaignId, auth.campaignId))
        .limit(100);
      if (rows.length >= 100) throw new Error("ECONOMY_CATALOG_LIMIT");
    }
    const { actionId, revision: _, ...values } = body;
    const revision = (old?.revision ?? -1) + 1;
    if (old)
      await tx
        .update(economyMerchants)
        .set({ ...values, revision })
        .where(scope(auth.campaignId, body.id, economyMerchants));
    else
      await tx
        .insert(economyMerchants)
        .values({ ...values, campaignId: auth.campaignId, revision });
    await recordEconomyAction(
      tx,
      auth,
      actionId,
      "economy.merchant",
      action.hash,
      body.id,
      revision,
    );
    return { revision };
  });
}
export async function saveShopOffer(
  db: Database,
  auth: AuthContext,
  body: z.infer<typeof saveShopOfferSchema>,
) {
  if (auth.role !== "GM") throw new Error("ECONOMY_FORBIDDEN");
  return db.transaction(async (tx) => {
    const action = await lockEconomyAction(
      tx,
      auth,
      body.actionId,
      "economy.offer",
      body,
    );
    const state = await lockEconomy(tx, auth);
    if (action.duplicate) return { duplicate: true };
    if (!state.config) throw new Error("ECONOMY_DISABLED");
    const [merchant] = await tx
      .select()
      .from(economyMerchants)
      .where(scope(auth.campaignId, body.merchantId, economyMerchants))
      .limit(1)
      .for("share");
    if (!merchant) throw new Error("ECONOMY_UNAVAILABLE");
    const [old] = await tx
      .select()
      .from(economyOffers)
      .where(scope(auth.campaignId, body.id, economyOffers))
      .limit(1)
      .for("update");
    if ((old?.revision ?? null) !== body.revision)
      throw new Error("ECONOMY_CONFLICT");
    // The graph lock also serializes these checks against other shop writers.
    // A deterministic occupied-stock conflict must not become an endless retry
    // of a database unique violation with a frozen command.
    const [listed] = await tx
      .select({ id: economyOffers.id })
      .from(economyOffers)
      .where(
        and(
          eq(economyOffers.campaignId, auth.campaignId),
          eq(economyOffers.instanceId, body.instanceId),
          ne(economyOffers.id, body.id),
        ),
      )
      .limit(1);
    if (listed) throw new Error("ECONOMY_INSTANCE_ALREADY_LISTED");
    if (!old) {
      const rows = await tx
        .select({ id: economyOffers.id })
        .from(economyOffers)
        .where(eq(economyOffers.campaignId, auth.campaignId))
        .limit(500);
      if (rows.length >= 500) throw new Error("ECONOMY_CATALOG_LIMIT");
    }
    // A former stock item may have been assigned through the legacy GM flow.
    // It is already unsellable; still let the GM hide its unchanged offer.
    if (!(old && old.instanceId === body.instanceId && !body.visible)) {
      const instance = await requireStock(tx, auth.campaignId, body.instanceId);
      const [item] = await tx
        .select()
        .from(worldContent)
        .where(eq(worldContent.id, instance.worldContentId))
        .limit(1)
        .for("share");
      if (item?.type !== "ITEM" || item.lifecycle === "ARCHIVED")
        throw new Error("ECONOMY_STOCK_UNAVAILABLE");
    }
    const { actionId, revision: _, ...values } = body;
    const revision = (old?.revision ?? -1) + 1;
    if (old)
      await tx
        .update(economyOffers)
        .set({ ...values, revision })
        .where(scope(auth.campaignId, body.id, economyOffers));
    else
      await tx
        .insert(economyOffers)
        .values({ ...values, campaignId: auth.campaignId, revision });
    await recordEconomyAction(
      tx,
      auth,
      actionId,
      "economy.offer",
      action.hash,
      body.id,
      revision,
    );
    return { revision };
  });
}
