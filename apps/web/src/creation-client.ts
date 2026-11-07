import type { CreationDesign, CreationEvaluation, CreationKind, CreationRuleSource, CreationRecipeSource,
  CreationListingSource, CreationStorePolicy, CreationOperationReceipt, CreationPurchaseReceipt } from "@arken/contracts";
import { api } from "./api";
export type CreationContext = { campaignId: string; membershipId: string };
export type CreationCharacter = { id: string; name: string; ownerMembershipId: string | null };
export type Page<T> = { items: T[]; nextAfter: string | null };
export type Review = { decision: "APPROVED" | "REJECTED" | "REVOKED"; revision: number; reason?: string };
export type RuleVersion = { id: string; packId: string; number: number; source: CreationRuleSource; published: boolean };
export type RulePack = { id: string; name: string; kind: CreationKind; revision: number; enabled: boolean;
  activeVersion: RuleVersion | null; latestVersion?: RuleVersion | null };
export type TemplateVersion = { id: string; templateId: string; number: number; ruleVersionId: string;
  versionHash: string; design: CreationDesign; evaluation: CreationEvaluation; review?: Review | null };
export type Template = { id: string; kind: CreationKind; authorMembershipId: string; revision: number;
  latestVersion: TemplateVersion; review: Review | null; origin?: { sourceVersionId: string; sourceAuthorName: string } | null };
export type Licence = { id: string; ownerMembershipId: string; purchaseId: string; createdAt: string;
  version: TemplateVersion & { kind: CreationKind }; author: { membershipId: string; displayName: string };
  rulesEnabled: boolean; review: Review | null };
export type CreationObject = { id: string; versionId: string; kind: CreationKind; level: number;
  stage: "CRAFTED" | "EVOLVING" | "MASTERWORK" | "FORGED"; status?: string; revision: number;
  entryId: string | null; instanceId: string | null; createdAt: string; parentObjectIds: string[];
  snapshot: { name: string; description: string; appearance: string; entryData: Record<string, unknown> };
  runtimeEntry?: { id: string; revision: number; data: Record<string, unknown> };
  requirements?: Array<{ statKey: string; minimum: number }>;
  artifact?: { category: string; rarity: string } | null;
  metadataAvailable?: boolean;
  author?: { membershipId: string; displayName: string } | null; rulesEnabled: boolean; review: Review | null };
/** Historical ancestors intentionally exclude current rights, wallets and runtime entries. */
export type CreationAncestor = Pick<CreationObject,
  "id" | "versionId" | "kind" | "level" | "stage" | "status" | "snapshot" | "createdAt" | "author" | "parentObjectIds">;
export type Recipe = { recipe: { id: string; name: string; enabled: boolean; revision: number };
  version: { id: string; number: number; published: boolean }; source: CreationRecipeSource };
export type RecipePage = { recipes: Recipe[]; drafts?: Recipe[] };
export type Material = { id: string; worldContentId: string; canonicalName: string; name: string; quantity: number; revision: number };
export type Listing = { id: string; revision: number; listingVersionId: string; number: number; enabled: boolean;
  soldCount: number; blocked: string | null; blockedByGm?: boolean; author: { membershipId: string; displayName: string | null };
  terms: Pick<CreationListingSource, "versionId" | "mode" | "recipeVersionId" | "priceCopper" | "collection" | "note" | "maxPurchases" | "availableUntil">;
  card: (CreationEvaluation["card"] & { kind: CreationKind; entryData: Record<string, unknown>; totals: CreationEvaluation["totals"] }) | null;
  fabrication: CreationRecipeSource["cost"] | null; gmMark: Review | null; source?: CreationListingSource };
export type PolicyView = { policy: CreationStorePolicy | null; revision: number | null };
export type OperationRow = { id: string; receipt: CreationOperationReceipt; createdAt: string };
export type PurchaseRow = { id: string; receipt: CreationPurchaseReceipt; createdAt: string };
export type IncomeRow = { id: string; listingVersionId: string; priceCopper: number; authorIncomeCopper: number; sinkCopper: number; createdAt: string };

export async function creationApi<T>(context: CreationContext, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-creation-campaign", context.campaignId); headers.set("x-creation-membership", context.membershipId);
  const controller = new AbortController(), mutation = (init?.method ?? "GET") !== "GET";
  const timeout = window.setTimeout(() => controller.abort(new Error(mutation
    ? "Ответ не подтверждён. Восстановите сохранённое действие, не создавая новое."
    : "Мастерская не ответила. Попробуйте обновить раздел.")), 30_000);
  const cancel = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) cancel(); else init?.signal?.addEventListener("abort", cancel, { once: true });
  try { return await api<T>(path, { ...init, headers, signal: controller.signal }); }
  finally { window.clearTimeout(timeout); init?.signal?.removeEventListener("abort", cancel); }
}
export function creationRequest<T>(context: CreationContext, path: string, body: unknown, method = "POST") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (body && typeof body === "object" && "actionId" in body && typeof body.actionId === "string") headers.set("x-action-id", body.actionId);
  return creationApi<T>(context, path, { method, headers, body: JSON.stringify(body) });
}
export const creationPath = (path: string, query: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(query).filter((pair): pair is [string, string] => pair[1] !== undefined && pair[1] !== ""));
  return `/api/creation/${path}${qs.size ? `?${qs}` : ""}`;
};
