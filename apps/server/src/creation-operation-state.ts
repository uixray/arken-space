import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { z } from "zod";
import { creationPaidBasisSchema, creationRefund, entryDataSchema, mergeCreationPaidBasis, walletSchema,
  type CreationPaidBasis, type CreationPoint, type creationOperationQuoteSchema } from "@arken/contracts";
import { campaigns, characterCatalogEntries, characterControllers, characters, creationObjects,
  economyOffers, worldContent, worldContentInstances, worldInstanceBindings } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { characterRollStats } from "./character-dto.js";
import { walletCopper } from "./economy-math.js";
import { loadCurrentCreationRecipe, validateCreationRecipe } from "./creation-recipes.js";
import { assertCreationEntryUsable, creationObjectSnapshotSchema } from "./creation-runtime-state.js";
import { creationHash, type CreationTransaction } from "./creation-state.js";
import { worldContentPlayerVisibleIn } from "./world-content.js";
import { licensedCreationVersions } from "./creation-access.js";

export type CreationQuoteRequest = z.infer<typeof creationOperationQuoteSchema>;
export const emptyCreationBasis = (): CreationPaidBasis => ({ copper: 0, sp: 0, materials: [] });
const pointKey = (point: CreationPoint) => `${point.versionId}:${point.level}:${point.stage}`;
export function readCreationBasis(raw: unknown) {
  const parsed = creationPaidBasisSchema.safeParse(raw);
  if (!parsed.success) throw new Error("CREATION_DATA_UNAVAILABLE");
  return parsed.data;
}
export function readCreationWallet(raw: unknown) {
  const parsed = walletSchema.safeParse(raw);
  if (!parsed.success || !Object.values(parsed.data).every(Number.isSafeInteger))
    throw new Error("CREATION_WALLET_INVALID");
  return parsed.data;
}
/** Require the entire spend BEFORE refund: a refund cannot finance its own operation. */
export function creationWalletAfter(raw: unknown, cost: CreationPaidBasis, returns: CreationPaidBasis) {
  const wallet = readCreationWallet(raw), before = walletCopper(wallet);
  if (before < BigInt(cost.copper) || wallet.sp < cost.sp) throw new Error("CREATION_INSUFFICIENT_FUNDS");
  const after = before - BigInt(cost.copper) + BigInt(returns.copper);
  const sp = BigInt(wallet.sp) - BigInt(cost.sp) + BigInt(returns.sp);
  if (after / 100n > BigInt(Number.MAX_SAFE_INTEGER) || sp > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("CREATION_WALLET_INVALID");
  return { gold: Number(after / 100n), silver: Number(after % 100n / 10n), copper: Number(after % 10n), sp: Number(sp) };
}
/** Caller already holds graph -> campaign/member. Canonical rows must be locked first. */
export async function lockCreationCharacter(tx: CreationTransaction, auth: AuthContext, characterId: string) {
  const [character] = await tx.select().from(characters).where(and(eq(characters.campaignId, auth.campaignId),
    eq(characters.id, characterId))).limit(1).for("update");
  if (!character || character.lifecycle !== "ACTIVE") throw new Error("CREATION_FORBIDDEN");
  if (auth.role !== "GM" && character.ownerMembershipId !== auth.membershipId) {
    const [controller] = await tx.select({ id: characterControllers.membershipId }).from(characterControllers)
      .where(and(eq(characterControllers.characterId, character.id), eq(characterControllers.membershipId, auth.membershipId)))
      .limit(1).for("share");
    if (!controller) throw new Error("CREATION_FORBIDDEN");
  }
  return character;
}
export function requireCreationStats(character: typeof characters.$inferSelect, layout: unknown,
  requirements: readonly { statKey: string; minimum: number }[]) {
  const stats = characterRollStats(character, layout);
  if (requirements.some(r => !Number.isFinite(stats[r.statKey]) || stats[r.statKey]! < r.minimum))
    throw new Error("CREATION_REQUIREMENTS");
  return stats;
}
export async function requireUnlinkedCreationInstances(tx: CreationTransaction, campaignId: string, ids: string[]) {
  if (!ids.length) return;
  const [binding] = await tx.select({ id: worldInstanceBindings.instanceId }).from(worldInstanceBindings).where(and(
    eq(worldInstanceBindings.campaignId, campaignId), or(inArray(worldInstanceBindings.instanceId, ids),
      inArray(worldInstanceBindings.containerInstanceId, ids)))).limit(1);
  const [offer] = await tx.select({ id: economyOffers.id }).from(economyOffers).where(and(
    eq(economyOffers.campaignId, campaignId), inArray(economyOffers.instanceId, ids))).limit(1);
  if (binding || offer) throw new Error("CREATION_MATERIAL_BOUND");
}
/** graph protects all instance/discovery writers in this campaign; canonical
 * SHARE locks prevent concurrent global archive/identity changes. */
export async function requireCreationItemVisibility(tx: CreationTransaction, auth: AuthContext, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const visible = await tx.select({ id: worldContent.id }).from(worldContent)
    .where(and(inArray(worldContent.id, ids), worldContentPlayerVisibleIn(auth.campaignId)));
  if (auth.role !== "GM" && visible.length !== ids.length) throw new Error("CREATION_ITEM_UNAVAILABLE");
  return new Set(visible.map(i => i.id));
}

/** Shared quote/commit read. Lock order: graph -> campaign/member -> canonical
 * UUIDs -> character/controller -> objects -> entries -> instances. No writes. */
export async function loadCreationOperationState(tx: CreationTransaction, auth: AuthContext, command: CreationQuoteRequest,
  internal: { storeCopyVersionId?: string; lockCharacterIds?: readonly string[] } = {}) {
  const recipe = await loadCurrentCreationRecipe(tx, auth, command.recipeVersionId);
  const objectIds = [...command.inputObjectIds].sort();
  const identities = objectIds.length ? await tx.select().from(creationObjects).where(and(
    eq(creationObjects.campaignId, auth.campaignId), eq(creationObjects.characterId, command.characterId),
    inArray(creationObjects.id, objectIds))).orderBy(asc(creationObjects.id)) : [];
  if (identities.length !== objectIds.length || identities.some(o => o.status !== "ACTIVE" || !o.entryId || o.kind !== recipe.source.kind) ||
      creationHash(identities.map(pointKey).sort()) !== creationHash(recipe.source.inputs.map(pointKey).sort()))
    throw new Error("CREATION_INPUTS_MISMATCH");
  const priorBasis = mergeCreationPaidBasis(identities.map(o => readCreationBasis(o.paidBasis)));
  const returns = recipe.source.refund ? creationRefund(priorBasis, recipe.source.refund) : emptyCreationBasis();
  const picks = [...command.materialPicks].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  // Only identity pre-reads here; every mutable row is locked again below.
  const materialIdentities = picks.length ? await tx.select({ id: worldContentInstances.id, worldContentId: worldContentInstances.worldContentId })
    .from(worldContentInstances).where(and(eq(worldContentInstances.campaignId, auth.campaignId),
      inArray(worldContentInstances.id, picks.map(p => p.instanceId)))) : [];
  if (materialIdentities.length !== picks.length) throw new Error("CREATION_MATERIAL_UNAVAILABLE");
  const inputBases = identities.flatMap(o => {
    const snapshot = creationObjectSnapshotSchema.safeParse(o.snapshot);
    if (!snapshot.success) throw new Error("CREATION_DATA_UNAVAILABLE");
    return snapshot.data.baseItemId ? [snapshot.data.baseItemId] : [];
  });
  const validated = await validateCreationRecipe(tx, auth, recipe.source, [
    ...inputBases, ...materialIdentities.map(i => i.worldContentId), ...returns.materials.map(m => m.worldContentId),
  ]);
  const visibleItemIds = await requireCreationItemVisibility(tx, auth, validated.itemVersions.map(i => i.id));
  const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, auth.campaignId)).limit(1);
  if (!campaign) throw new Error("CREATION_FORBIDDEN");
  // Server-internal storefront integration only. No endpoint accepts this object.
  // Canonical rows have already been locked; lock both wallets in UUID order.
  if (internal.lockCharacterIds?.length) await tx.select({ id: characters.id }).from(characters)
    .where(and(eq(characters.campaignId, auth.campaignId), inArray(characters.id,
      [...new Set([command.characterId, ...internal.lockCharacterIds])].sort())))
    .orderBy(asc(characters.id)).for("update");
  const character = await lockCreationCharacter(tx, auth, command.characterId);
  const licensed = await licensedCreationVersions(tx, auth.campaignId,
    [auth.membershipId, ...(character.ownerMembershipId ? [character.ownerMembershipId] : [])],
    validated.output ? [validated.output.version.id] : []);
  const storeCopy = internal.storeCopyVersionId !== undefined && recipe.source.operation === "CRAFT" &&
    recipe.source.inputs.length === 0 && validated.output?.version.id === internal.storeCopyVersionId;
  if (internal.storeCopyVersionId && !storeCopy) throw new Error("CREATION_FORBIDDEN");
  // A published GM transition may consume held copies into a new approved
  // version. That grants the output object only, not a licence to fabricate it.
  const consumingTransition = recipe.source.operation !== "CRAFT" && objectIds.length > 0;
  const authorAccess = validated.output && [auth.membershipId, character.ownerMembershipId].includes(validated.output.template.authorMembershipId);
  if (validated.output && auth.role !== "GM" && !authorAccess &&
      !licensed.has(validated.output.version.id) && !storeCopy && !consumingTransition) throw new Error("CREATION_FORBIDDEN");
  const stats = requireCreationStats(character, campaign.statLayout, validated.output?.evaluation.card.requirements ?? []);
  const wallet = readCreationWallet(character.wallet);
  const objects = objectIds.length ? await tx.select().from(creationObjects).where(and(
    eq(creationObjects.campaignId, auth.campaignId), inArray(creationObjects.id, objectIds)))
    .orderBy(asc(creationObjects.id)).for("update") : [];
  // No writer can have changed identities while we hold graph; fail closed if a
  // future writer violates that assumption instead of continuing from stale data.
  if (creationHash(objects) !== creationHash(identities)) throw new Error("CREATION_CONFLICT");
  const entryIds = objects.map(o => o.entryId!).sort();
  const entries = entryIds.length ? await tx.select().from(characterCatalogEntries)
    .where(inArray(characterCatalogEntries.id, entryIds)).orderBy(asc(characterCatalogEntries.id)).for("update") : [];
  if (entries.length !== objects.length) throw new Error("CREATION_OBJECT_UNAVAILABLE");
  for (const entry of entries) {
    if (entry.characterId !== character.id || !await assertCreationEntryUsable(tx, auth, entry, character))
      throw new Error("CREATION_OBJECT_UNAVAILABLE");
  }
  const inputInstanceIds = objects.flatMap(o => o.instanceId ? [o.instanceId] : []);
  const allInstanceIds = [...new Set([...inputInstanceIds, ...picks.map(p => p.instanceId)])].sort();
  if (allInstanceIds.length !== inputInstanceIds.length + picks.length) throw new Error("CREATION_MATERIAL_BOUND");
  const instances = allInstanceIds.length ? await tx.select().from(worldContentInstances).where(and(
    eq(worldContentInstances.campaignId, auth.campaignId), inArray(worldContentInstances.id, allInstanceIds)))
    .orderBy(asc(worldContentInstances.id)).for("update") : [];
  if (instances.length !== allInstanceIds.length) throw new Error("CREATION_MATERIAL_UNAVAILABLE");
  await requireUnlinkedCreationInstances(tx, auth.campaignId, allInstanceIds);
  const materialBindings = picks.length ? await tx.select({ id: creationObjects.id }).from(creationObjects).where(and(
    eq(creationObjects.campaignId, auth.campaignId), inArray(creationObjects.instanceId, picks.map(p => p.instanceId)))).limit(1) : [];
  if (materialBindings.length) throw new Error("CREATION_MATERIAL_BOUND");
  const inputInstances = inputInstanceIds.map(id => instances.find(i => i.id === id)!);
  for (const instance of inputInstances) {
    const object = objects.find(o => o.instanceId === instance.id)!;
    const snapshot = creationObjectSnapshotSchema.parse(object.snapshot);
    if (instance.inventoryCharacterId !== character.id || instance.ownerMembershipId || instance.quantity !== 1 ||
        instance.worldContentId !== snapshot.baseItemId) throw new Error("CREATION_DATA_UNAVAILABLE");
  }
  const pickedMaterials = picks.map(pick => {
    const instance = instances.find(i => i.id === pick.instanceId)!;
    if (instance.inventoryCharacterId !== character.id || instance.quantity === null || instance.quantity < pick.quantity ||
        (instance.ownerMembershipId !== null && instance.ownerMembershipId !== character.ownerMembershipId) ||
        (auth.role !== "GM" && !instance.discovered)) throw new Error("CREATION_MATERIAL_UNAVAILABLE");
    return { instance, quantity: pick.quantity };
  });
  const picked = mergeCreationPaidBasis(pickedMaterials.map(p => ({ copper: 0, sp: 0,
    materials: [{ worldContentId: p.instance.worldContentId, quantity: p.quantity }] })));
  const spend = mergeCreationPaidBasis([recipe.source.cost]);
  if (creationHash(picked.materials) !== creationHash(spend.materials)) throw new Error("CREATION_MATERIALS_MISMATCH");
  const paidBasis = recipe.source.output ? mergeCreationPaidBasis([priorBasis, spend]) : null;
  const affordable = walletCopper(wallet) >= BigInt(spend.copper) && wallet.sp >= spend.sp;
  // Check overflow also at quote, not after confirmation. Insufficient funds is
  // a normal quote state; it never allows refund-assisted netting.
  const nextWallet = affordable ? creationWalletAfter(wallet, spend, returns) : null;
  const outputData = validated.output ? entryDataSchema.parse(validated.output.evaluation.entryData) : null;
  if (outputData?.uses) {
    const previous = entries.map(e => entryDataSchema.parse(e.data).uses).filter(u => u !== undefined);
    outputData.uses = { ...outputData.uses,
      current: Math.min(outputData.uses.max, ...previous.map(u => u.current)),
      lastRechargeDay: campaign.day, lastBattleCounter: campaign.battleCounter };
  }
  const inputs = { request: command, actor: auth.membershipId, campaignRevision: campaign.revision,
    day: campaign.day, battleCounter: campaign.battleCounter, characterRevision: character.revision,
    wallet, stats, ownerMembershipId: character.ownerMembershipId,
    outputAccess: storeCopy ? "STORE_COPY" : consumingTransition ? "CONSUMING_GM_RECIPE" : auth.role === "GM" ? "GM" :
      authorAccess ? "AUTHOR_OR_CHARACTER_OWNER" : "LICENCE_OR_NO_OUTPUT",
    recipeHash: recipe.version.sourceHash, recipeRevision: recipe.recipe.revision,
    versions: [...validated.loaded.values()].map(v => ({ id: v.version.id, hash: v.version.versionHash,
      reviewRevision: v.review.revision, ruleRevision: v.rules.pack.revision })),
    itemVersions: validated.itemVersions, visibleItemIds: [...visibleItemIds].sort(),
    objects: objects.map(o => ({ id: o.id, revision: o.revision, snapshotHash: o.snapshotHash, paidBasis: o.paidBasis })),
    entries: entries.map(e => ({ id: e.id, revision: e.revision, data: e.data })),
    instances: instances.map(i => ({ id: i.id, revision: i.revision, quantity: i.quantity })),
    spend, returns, outputData };
  return { recipe, validated, campaign, character, objects, entries, inputInstances, pickedMaterials,
    spend, returns, paidBasis, outputData, visibleItemIds, affordable, nextWallet, inputs, inputHash: creationHash(inputs) };
}
