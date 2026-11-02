import { z } from "zod";

export const ECONOMY_MAX_COPPER = 1_000_000_000_000;
const id = z.string().uuid();
const revision = z.number().int().nonnegative();
const label = z.string().trim().min(1).max(100);
const percent = z.number().int().min(0).max(10000);
const copper = z.number().int().min(0).max(ECONOMY_MAX_COPPER);
export const economyConfigSchema = z.object({
  enabled: z.boolean(),
  calendar: z.object({
    anchorCampaignDay: z.number().int().min(1).max(2_000_000_000),
    anchorYear: z.number().int().min(-1_000_000).max(1_000_000),
    months: z.array(z.object({ name: label, days: z.number().int().min(1).max(366),
      seasonId: id }).strict()).min(1).max(36),
  }).strict(),
  seasons: z.array(z.object({ id, name: label, percent }).strict()).min(1).max(24),
  regions: z.array(z.object({ worldContentId: id, percent }).strict()).min(1).max(128),
  charismaStatKey: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(40),
  charismaBands: z.array(z.object({ min: z.number().finite(), max: z.number().finite(),
    percent }).strict()).min(1).max(64),
}).strict().superRefine((value, ctx) => {
  const seasons = new Set(value.seasons.map((s) => s.id));
  if (seasons.size !== value.seasons.length ||
      new Set(value.regions.map((r) => r.worldContentId)).size !== value.regions.length)
    ctx.addIssue({ code: "custom", message: "Сезоны и регионы не должны повторяться." });
  if (value.calendar.months.some((m) => !seasons.has(m.seasonId)))
    ctx.addIssue({ code: "custom", message: "Выберите существующий сезон для каждого месяца." });
  const bands = [...value.charismaBands].sort((a, b) => a.min - b.min);
  if (bands.some((b, i) => b.min > b.max || (i > 0 && b.min <= bands[i - 1]!.max)))
    ctx.addIssue({ code: "custom", message: "Диапазоны харизмы включают обе границы и не должны пересекаться." });
});
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
export const saveEconomyConfigSchema = z.object({ actionId: id,
  revision: revision.nullable(), config: economyConfigSchema }).strict();
export const saveMerchantSchema = z.object({ actionId: id, id, revision: revision.nullable(),
  name: label, regionId: id, visible: z.boolean(), percent }).strict();
export const saveShopOfferSchema = z.object({ actionId: id, id, revision: revision.nullable(),
  merchantId: id, instanceId: id, visible: z.boolean(), supplyPercent: percent,
  gmPercent: percent, overrideCopper: copper.nullable(),
  reason: z.string().trim().max(500),
}).strict().superRefine((v, ctx) => {
  if ((v.overrideCopper !== null || v.gmPercent !== 100) && !v.reason)
    ctx.addIssue({ code: "custom", message: "Для ручной цены или поправки нужна причина." });
});
export const economyQuoteCommandSchema = z.object({ characterId: id, offerId: id,
  quantity: z.number().int().min(1).max(1_000_000) }).strict();
export const economyPurchaseCommandSchema = z.object({ actionId: id, quoteId: id }).strict();
export interface EconomyDate { year: number; month: string; day: number; season: string }
export interface ShopOfferDto { id: string; name: string; quantity: number; condition: string | null }
export interface ShopMerchantDto { id: string; name: string; region: string; offers: ShopOfferDto[] }
export interface ShopCatalogDto { enabled: boolean; date: EconomyDate | null; merchants: ShopMerchantDto[] }
export interface EconomyQuoteDto {
  id: string; characterId: string; offerId: string; itemName: string; merchantName: string;
  quantity: number; totalCopper: number; expiresAt: string; date: EconomyDate;
  affordable: boolean; rounding: "CEIL_ONCE_TO_COPPER";
}
export interface EconomyReceiptDto {
  actionId: string; quoteId: string; characterId: string; itemName: string;
  merchantName: string; quantity: number; totalCopper: number; inventoryInstanceId: string;
  purchasedAt: string; date: EconomyDate;
}
export interface EconomyManagerDto {
  revision: number | null; config: EconomyConfig | null;
  merchants: Array<Omit<z.infer<typeof saveMerchantSchema>, "actionId" | "revision"> & { revision: number }>;
  offers: Array<Omit<z.infer<typeof saveShopOfferSchema>, "actionId" | "revision"> & { revision: number }>;
  instances: Array<{ id: string; name: string; quantity: number; worldContentId: string; worldRevision: number; basePriceCopper: number | null }>;
  regions: Array<{ id: string; name: string }>;
}
export interface EconomyHistoryDto {
  items: Array<{ id: string; receipt: EconomyReceiptDto; inputs?: unknown }>;
  nextCursor: string | null;
}
