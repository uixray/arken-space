import { z } from "zod";
import { creationKindSchema } from "./creation.js";
import { creationMaterialPicksSchema, type CreationPaidBasis, type CreationOperationReceipt } from "./creation-lifecycle.js";

const id = z.string().uuid();
const revision = z.number().int().min(0).max(2_000_000_000);
const copper = z.number().int().min(0).max(1_000_000_000_000);
/** No default prices, commission or enabled policy: the GM supplies all of them. */
export const creationStorePolicySchema = z.object({ format: z.literal(1), enabled: z.boolean(),
  allowPlayerListings: z.boolean(), allowedKinds: z.array(creationKindSchema).min(1).max(2)
    .refine(v => new Set(v).size === v.length),
  minimumPriceCopper: copper, maximumPriceCopper: copper,
  commissionBasisPoints: z.number().int().min(0).max(10000),
}).strict().refine(v => v.minimumPriceCopper <= v.maximumPriceCopper, "Минимальная цена выше максимальной.");
export type CreationStorePolicy = z.infer<typeof creationStorePolicySchema>;
export const saveCreationStorePolicySchema = z.object({ actionId: id, expectedRevision: revision.nullable(),
  policy: creationStorePolicySchema, reason: z.string().trim().min(1).max(1000) }).strict();
export const creationListingSourceSchema = z.object({ format: z.literal(1), versionId: id,
  mode: z.enum(["COPY", "TEMPLATE"]), recipeVersionId: id.nullable(), priceCopper: copper,
  payout: z.enum(["AUTHOR", "SINK"]), payoutCharacterId: id.nullable(),
  collection: z.string().trim().max(100), note: z.string().trim().max(2000),
  maxPurchases: z.number().int().min(1).max(1_000_000).nullable(),
  availableUntil: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((v, ctx) => {
  if ((v.mode === "COPY") !== (v.recipeVersionId !== null))
    ctx.addIssue({ code: "custom", message: "Копия требует рецепт изготовления; шаблон не выдаёт экземпляр." });
  if ((v.payout === "AUTHOR") !== (v.payoutCharacterId !== null))
    ctx.addIssue({ code: "custom", message: "Доход автора требует его персонажа; системный лот направляет всю цену в sink." });
});
export type CreationListingSource = z.infer<typeof creationListingSourceSchema>;
export const saveCreationListingSchema = z.object({ actionId: id, listingId: id, expectedRevision: revision.nullable(),
  source: creationListingSourceSchema }).strict();
export const setCreationListingEnabledSchema = z.object({ actionId: id, listingId: id, expectedRevision: revision,
  enabled: z.boolean(), reason: z.string().trim().min(1).max(1000) }).strict();
export const creationStoreQuoteSchema = z.object({ listingVersionId: id, characterId: id,
  materialPicks: creationMaterialPicksSchema }).strict();
export const commitCreationPurchaseSchema = z.object({ actionId: id, quoteId: id }).strict();
export interface CreationStoreQuote {
  id: string; listingId: string; listingVersionId: string; versionId: string; name: string;
  mode: "COPY" | "TEMPLATE"; characterId: string; beneficiaryMembershipId: string | null;
  priceCopper: number; authorIncomeCopper: number; sinkCopper: number;
  fabrication: CreationPaidBasis; total: CreationPaidBasis; affordable: boolean;
  expiresAt: string; rounding: "CEIL_COMMISSION_COPPER";
}
export interface CreationPurchaseReceipt {
  purchaseId: string; actionId: string; quoteId: string; listingId: string; listingVersionId: string;
  versionId: string; name: string; authorMembershipId: string; mode: "COPY" | "TEMPLATE";
  characterId: string; beneficiaryMembershipId: string | null;
  priceCopper: number; authorIncomeCopper: number; sinkCopper: number;
  total: CreationPaidBasis; licenceId: string | null; operation: CreationOperationReceipt | null; completedAt: string;
}
