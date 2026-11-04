import { createHash } from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  campaignEconomies,
  campaigns,
  characters,
  characterControllers,
  economyMerchants,
  economyOffers,
  gameEvents,
  memberships,
  worldContent,
  worldContentInstanceActions,
  worldContentInstances,
  worldInstanceBindings,
} from "@arken/db";
import { economyConfigSchema } from "@arken/contracts";
import type { AuthContext } from "./auth.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { worldContentPlayerVisibleIn } from "./world-content.js";
import { economyDate, priceCopper, walletCopper } from "./economy-math.js";

export type Database = ReturnType<
  typeof import("@arken/db").createDatabase
>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const scope = (
  campaignId: string,
  id: string,
  table: typeof economyMerchants | typeof economyOffers,
) => and(eq(table.campaignId, campaignId), eq(table.id, id));

export async function lockEconomy(
  tx: Transaction,
  auth: AuthContext,
  receiptOnly = false,
) {
  // Graph first: legacy instance/binding mutations already use graph -> entity -> character.
  await lockInventoryGraph(tx, auth.campaignId);
  const [campaign] = await tx
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, auth.campaignId))
    .limit(1)
    .for("share");
  if (!campaign) throw new Error("ECONOMY_UNAVAILABLE");
  const [member] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.id, auth.membershipId),
        eq(memberships.campaignId, auth.campaignId),
      ),
    )
    .limit(1)
    .for("share");
  if (!member || member.role !== auth.role)
    throw new Error("ECONOMY_FORBIDDEN");
  const [economy] = await tx
    .select()
    .from(campaignEconomies)
    .where(eq(campaignEconomies.campaignId, auth.campaignId))
    .limit(1)
    .for("update");
  const parsed =
    economy && !receiptOnly
      ? economyConfigSchema.safeParse(economy.config)
      : null;
  if (parsed && !parsed.success)
    throw new Error("ECONOMY_CONFIGURATION_UNAVAILABLE");
  return { campaign, economy, config: parsed?.success ? parsed.data : null };
}
export async function lockEconomyAction(
  tx: Transaction,
  auth: AuthContext,
  actionId: string,
  type: string,
  body: unknown,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${auth.campaignId + ":" + actionId}, 0))`,
  );
  const hash = fingerprint({ type, body });
  const [event] = await tx
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, auth.campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  if (event) {
    if (
      event.type !== type ||
      event.membershipId !== auth.membershipId ||
      (event.payload as { requestHash?: string } | null)?.requestHash !== hash
    )
      throw new Error("ECONOMY_ACTION_CONFLICT");
    return { duplicate: true, hash };
  }
  const [other] = await tx
    .select({ id: worldContentInstanceActions.actionId })
    .from(worldContentInstanceActions)
    .where(
      and(
        eq(worldContentInstanceActions.campaignId, auth.campaignId),
        eq(worldContentInstanceActions.actionId, actionId),
      ),
    )
    .limit(1);
  if (other) throw new Error("ECONOMY_ACTION_CONFLICT");
  return { duplicate: false, hash };
}
export async function recordEconomyAction(
  tx: Transaction,
  auth: AuthContext,
  actionId: string,
  type: string,
  hash: string,
  entityId: string | null,
  revision: number | null,
) {
  await tx
    .insert(gameEvents)
    .values({
      campaignId: auth.campaignId,
      membershipId: auth.membershipId,
      actionId,
      type,
      entityType: "economy",
      entityId,
      entityRevision: revision,
      payload: { requestHash: hash },
    });
}

export async function requireStock(
  tx: Transaction,
  campaignId: string,
  instanceId: string,
) {
  const [instance] = await tx
    .select()
    .from(worldContentInstances)
    .where(
      and(
        eq(worldContentInstances.campaignId, campaignId),
        eq(worldContentInstances.id, instanceId),
      ),
    )
    .limit(1)
    .for("update");
  if (
    !instance ||
    instance.inventoryCharacterId ||
    instance.ownerMembershipId ||
    instance.quantity == null
  )
    throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  // No scene/token/container reference is silently copied or sold away.
  const [binding] = await tx
    .select({ id: worldInstanceBindings.instanceId })
    .from(worldInstanceBindings)
    .where(
      and(
        eq(worldInstanceBindings.campaignId, campaignId),
        or(
          eq(worldInstanceBindings.instanceId, instanceId),
          eq(worldInstanceBindings.containerInstanceId, instanceId),
        ),
      ),
    )
    .limit(1);
  if (binding) throw new Error("ECONOMY_STOCK_BOUND");
  return instance;
}
export async function loadPriceState(
  tx: Transaction,
  auth: AuthContext,
  locked: Awaited<ReturnType<typeof lockEconomy>>,
  command: { characterId: string; offerId: string; quantity: number },
) {
  const { campaign, economy, config } = locked;
  if (!economy || !config?.enabled) throw new Error("ECONOMY_DISABLED");
  const [offer] = await tx
    .select()
    .from(economyOffers)
    .where(scope(auth.campaignId, command.offerId, economyOffers))
    .limit(1)
    .for("update");
  if (!offer) throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  const [merchant] = await tx
    .select()
    .from(economyMerchants)
    .where(scope(auth.campaignId, offer.merchantId, economyMerchants))
    .limit(1)
    .for("update");
  if (
    !merchant ||
    (auth.role !== "GM" && (!offer.visible || !merchant.visible))
  )
    throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  // Graph prevents a legacy instance writer racing this preliminary identity read.
  const [identity] = await tx
    .select({ id: worldContentInstances.worldContentId })
    .from(worldContentInstances)
    .where(
      and(
        eq(worldContentInstances.campaignId, auth.campaignId),
        eq(worldContentInstances.id, offer.instanceId),
      ),
    )
    .limit(1);
  if (!identity) throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  const entities = await tx
    .select()
    .from(worldContent)
    .where(inArray(worldContent.id, [identity.id, merchant.regionId]))
    .orderBy(asc(worldContent.id))
    .for("share");
  const item = entities.find((e) => e.id === identity.id);
  const region = entities.find((e) => e.id === merchant.regionId);
  if (
    item?.type !== "ITEM" ||
    item.lifecycle === "ARCHIVED" ||
    region?.type !== "LOCATION" ||
    region.lifecycle === "ARCHIVED"
  )
    throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  if (auth.role !== "GM") {
    const visible = await tx
      .select({ id: worldContent.id })
      .from(worldContent)
      .where(
        and(
          inArray(worldContent.id, [item.id, region.id]),
          worldContentPlayerVisibleIn(auth.campaignId),
        ),
      );
    if (visible.length !== 2) throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  }
  const [character] = await tx
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, command.characterId),
        eq(characters.campaignId, auth.campaignId),
      ),
    )
    .limit(1)
    .for("update");
  if (!character || character.lifecycle !== "ACTIVE")
    throw new Error("ECONOMY_FORBIDDEN");
  if (auth.role !== "GM" && character.ownerMembershipId !== auth.membershipId) {
    const [controller] = await tx
      .select()
      .from(characterControllers)
      .where(
        and(
          eq(characterControllers.characterId, character.id),
          eq(characterControllers.membershipId, auth.membershipId),
        ),
      )
      .limit(1)
      .for("share");
    if (!controller) throw new Error("ECONOMY_FORBIDDEN");
  }
  const instance = await requireStock(tx, auth.campaignId, offer.instanceId);
  if (auth.role !== "GM" && !instance.discovered)
    throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  if (instance.quantity! < command.quantity)
    throw new Error("ECONOMY_STOCK_UNAVAILABLE");
  if (item.basePriceCopper === null) throw new Error("ECONOMY_UNPRICED_ITEM");
  const date = economyDate(config, campaign.day);
  const regionRule = config.regions.find((r) => r.worldContentId === region.id);
  const season = config.seasons.find((s) => s.id === date.seasonId)!;
  const charisma = (character.stats as Record<string, number>)[
    config.charismaStatKey
  ];
  const band = Number.isFinite(charisma)
    ? config.charismaBands.find((b) => charisma! >= b.min && charisma! <= b.max)
    : null;
  if (!regionRule || !band) throw new Error("ECONOMY_RULE_MISSING");
  const factors = {
    region: regionRule.percent,
    season: season.percent,
    merchant: merchant.percent,
    supply: offer.supplyPercent,
    charisma: band.percent,
    gm: offer.gmPercent,
  };
  const total = priceCopper(
    item.basePriceCopper,
    command.quantity,
    Object.values(factors),
    offer.overrideCopper,
  );
  const dateView = {
    year: date.year,
    month: date.month,
    day: date.day,
    season: date.season,
  };
  const inputs = {
    campaignRevision: campaign.revision,
    economyRevision: economy.revision,
    merchantRevision: merchant.revision,
    offerRevision: offer.revision,
    itemRevision: item.revision,
    regionRevision: region.revision,
    characterRevision: character.revision,
    instanceRevision: instance.revision,
    campaignDay: campaign.day,
    date: dateView,
    regionId: region.id,
    charismaKey: config.charismaStatKey,
    charisma,
    factors,
    baseCopper: item.basePriceCopper,
    overrideCopper: offer.overrideCopper,
    reason: offer.reason,
    wallet: character.wallet,
    quantity: command.quantity,
    totalCopper: total,
    stock: instance.quantity,
    rounding: "CEIL_ONCE_TO_COPPER",
    characterId: character.id,
    offerId: offer.id,
  };
  return {
    inputs,
    inputHash: fingerprint(inputs),
    character,
    instance,
    item,
    merchant,
    offer,
    date: dateView,
    totalCopper: total,
    affordable: walletCopper(character.wallet) >= BigInt(total),
  };
}
