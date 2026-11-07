import { z } from "zod";
import { saveCreationRulesSchema, setCreationRulesEnabledSchema, saveCreationTemplateSchema,
  forkCreationTemplateSchema, reviewCreationSchema } from "./creation.js";
import { saveCreationRecipeSchema, setCreationRecipeEnabledSchema, commitCreationOperationSchema,
  transferCreationObjectSchema } from "./creation-lifecycle.js";
import { saveCreationStorePolicySchema, saveCreationListingSchema, setCreationListingEnabledSchema,
  commitCreationPurchaseSchema } from "./creation-store.js";

/** Exact existing creationAction type/body pairing, shared by replay and cancel. */
export const creationCommandDefinitions: Record<string, { type: string; schema: z.ZodTypeAny }> = {
  "POST rules/versions": { type: "creation.rules.version", schema: saveCreationRulesSchema },
  "PUT rules/enabled": { type: "creation.rules.enabled", schema: setCreationRulesEnabledSchema },
  "POST templates/versions": { type: "creation.template.version", schema: saveCreationTemplateSchema },
  "POST templates/fork": { type: "creation.template.fork", schema: forkCreationTemplateSchema },
  "POST reviews": { type: "creation.template.review", schema: reviewCreationSchema },
  "POST recipes/versions": { type: "creation.recipe.version", schema: saveCreationRecipeSchema },
  "PUT recipes/enabled": { type: "creation.recipe.enabled", schema: setCreationRecipeEnabledSchema },
  "POST operations/commit": { type: "creation.operation", schema: commitCreationOperationSchema },
  "POST objects/transfer": { type: "creation.transfer", schema: transferCreationObjectSchema },
  "PUT store/policy": { type: "creation.store.policy", schema: saveCreationStorePolicySchema },
  "POST store/listings": { type: "creation.store.listing", schema: saveCreationListingSchema },
  "PUT store/listings/enabled": { type: "creation.store.listing.enabled", schema: setCreationListingEnabledSchema },
  "POST store/commit": { type: "creation.store.purchase", schema: commitCreationPurchaseSchema },
};
export const cancelCreationCommandSchema = z.object({ method: z.enum(["POST", "PUT"]), path: z.string().max(80),
  body: z.record(z.string(), z.unknown()) }).strict();
export const creationCancellationReceiptSchema = z.object({ actionId: z.string().uuid(),
  outcome: z.literal("CANCELLED"), type: z.string(), duplicate: z.boolean().optional() }).strict();
