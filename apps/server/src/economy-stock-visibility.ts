import { sql } from "drizzle-orm";
import { economyOffers, worldContentInstances } from "@arken/db";

/** Stock is served only by the shop projection, not a generic instance/asset list. */
export const nonShopInstance = () => sql`NOT EXISTS (SELECT 1 FROM ${economyOffers}
  WHERE ${economyOffers.campaignId} = ${worldContentInstances.campaignId}
  AND ${economyOffers.instanceId} = ${worldContentInstances.id})`;
