import { consumeCreationObject } from "./creation-consumption.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { creationOperationQuoteSchema, type CreationOperationQuote, type CreationOperationReceipt } from "@arken/contracts";
import { characterCatalogEntries, characters, creationObjectEdges, creationObjects, creationOperationQuotes,
  creationOperations, worldContentInstanceActions, worldContentInstances } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationWalletAfter, emptyCreationBasis, readCreationBasis, loadCreationOperationState, type CreationQuoteRequest } from "./creation-operation-state.js";
import { creationEntryKind, creationObjectSnapshotSchema } from "./creation-runtime-state.js";
import { creationAction, creationHash, requireCreationMember, type CreationDatabase, type CreationTransaction } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";

export async function quoteCreationOperation(db: CreationDatabase, auth: AuthContext,
  command: CreationQuoteRequest): Promise<CreationOperationQuote> {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const state = await loadCreationOperationState(tx, auth, command);
    const id = randomUUID(), expiresAt = new Date(Date.now() + 120_000);
    const view: CreationOperationQuote = { id, characterId: command.characterId,
      recipeVersionId: command.recipeVersionId, recipeName: state.recipe.source.name,
      operation: state.recipe.source.operation, inputObjectIds: [...command.inputObjectIds],
      output: state.recipe.source.output && state.validated.output ? { ...state.recipe.source.output,
        name: state.validated.output.evaluation.card.name, kind: state.recipe.source.kind } : null,
      spend: state.spend, returns: state.returns, affordable: state.affordable,
      expiresAt: expiresAt.toISOString(), rounding: "FLOOR_EACH_REFUND_RESOURCE" };
    await tx.insert(creationOperationQuotes).values({ id, campaignId: auth.campaignId, actorMembershipId: auth.membershipId,
      characterId: command.characterId, recipeVersionId: command.recipeVersionId, request: command,
      inputs: state.inputs, inputHash: state.inputHash, view, expiresAt });
    return view;
  });
}

/** One transaction owns the wallet, all consumed inputs, emitted rows, private
 * receipt and ancestry. creationAction replays BEFORE expiry or current permits. */
export function commitCreationOperation(db: CreationDatabase, auth: AuthContext,
  command: { actionId: string; quoteId: string }) {
  return creationAction(db, auth, command.actionId, "creation.operation", command, async tx => {
    const [quote] = await tx.select().from(creationOperationQuotes).where(and(eq(creationOperationQuotes.id, command.quoteId),
      eq(creationOperationQuotes.campaignId, auth.campaignId), eq(creationOperationQuotes.actorMembershipId, auth.membershipId)))
      .limit(1).for("update");
    if (!quote) throw new Error("CREATION_QUOTE_UNAVAILABLE");
    const [used] = await tx.select({ id: creationOperations.id }).from(creationOperations)
      .where(eq(creationOperations.quoteId, quote.id)).limit(1);
    if (used) throw new Error("CREATION_QUOTE_USED");
    if (quote.expiresAt.getTime() <= Date.now()) throw new Error("CREATION_QUOTE_EXPIRED");
    const parsed = creationOperationQuoteSchema.safeParse(quote.request);
    if (!parsed.success || parsed.data.characterId !== quote.characterId || parsed.data.recipeVersionId !== quote.recipeVersionId ||
        creationHash(quote.inputs) !== quote.inputHash) throw new Error("CREATION_DATA_UNAVAILABLE");
    const state = await loadCreationOperationState(tx, auth, parsed.data);
    if (state.recipe.source.operation !== "CRAFT") throw new Error("CREATION_SCOPE_LIMIT");
    if (state.inputHash !== quote.inputHash) throw new Error("CREATION_QUOTE_STALE");
    if (quote.expiresAt.getTime() <= Date.now()) throw new Error("CREATION_QUOTE_EXPIRED");
    return { ...await applyCreationOperation(tx, auth, command, state) };
  });
}

/** Caller owns one creationAction transaction and validated/locked state.
 * Storefront COPY invokes this only after payment revalidation. Its extra sale
 * debit is never included in the object's refundable fabrication basis. */
export async function applyCreationOperation(tx: CreationTransaction, auth: AuthContext,
  command: { actionId: string; quoteId: string }, state: Awaited<ReturnType<typeof loadCreationOperationState>>,
  additionalCopperDebit = 0): Promise<CreationOperationReceipt> {
  if (!state.affordable || !state.nextWallet) throw new Error("CREATION_INSUFFICIENT_FUNDS");
  const extra = readCreationBasis({ ...emptyCreationBasis(), copper: additionalCopperDebit });
  const walletAfter = creationWalletAfter(state.nextWallet, extra, emptyCreationBasis());
  const now = new Date(), operationId = randomUUID();
  await tx.update(characters).set({ wallet: walletAfter, revision: state.character.revision + 1, updatedAt: now })
    .where(and(eq(characters.id, state.character.id), eq(characters.campaignId, auth.campaignId)));
  const instanceChanges: Array<{ id: string; revision: number; quantity: number;
    effect: "SPEND" | "CONSUME" | "CREATE" | "REFUND" }> = [];
  for (const picked of state.pickedMaterials) {
    const quantity = picked.instance.quantity! - picked.quantity, revision = picked.instance.revision + 1;
    await tx.update(worldContentInstances).set({ quantity, revision, updatedAt: now,
      inventoryCharacterId: quantity > 0 ? state.character.id : null }).where(and(
      eq(worldContentInstances.id, picked.instance.id), eq(worldContentInstances.campaignId, auth.campaignId)));
    instanceChanges.push({ id: picked.instance.id, revision, quantity, effect: "SPEND" });
  }
  for (const object of state.objects) {
    const consumed = await consumeCreationObject(tx, auth.campaignId, object,
      state.inputInstances.find(i => i.id === object.instanceId), now);
    if (consumed) instanceChanges.push(consumed);
  }
  // Refunds are plain canonical materials, never copied GM notes/locations or
  // regenerated created objects. Each zero-quantity historical row is retained.
  const refunds: Array<{ instanceId: string; worldContentId: string; quantity: number }> = [];
  for (const material of state.returns.materials) {
    const id = randomUUID();
    await tx.insert(worldContentInstances).values({ id, campaignId: auth.campaignId, worldContentId: material.worldContentId,
      quantity: material.quantity, inventoryCharacterId: state.character.id,
      discovered: state.visibleItemIds.has(material.worldContentId) });
    refunds.push({ instanceId: id, ...material });
    instanceChanges.push({ id, revision: 0, quantity: material.quantity, effect: "REFUND" });
  }
  let outputObjectId: string | null = null, entryId: string | null = null, instanceId: string | null = null;
  const output = state.validated.output, point = state.recipe.source.output;
  if (output && point && state.outputData && state.paidBasis) {
    outputObjectId = randomUUID(); entryId = randomUUID();
    const card = output.evaluation.card;
    const snapshot = creationObjectSnapshotSchema.parse({ versionHash: output.version.versionHash,
      name: card.name, description: card.description, appearance: card.appearance,
      entryKind: creationEntryKind(state.outputData), entryData: state.outputData, baseItemId: card.artifact?.baseItemId ?? null });
    await tx.insert(characterCatalogEntries).values({ id: entryId, characterId: state.character.id,
      sourceCatalogEntryId: null, kind: snapshot.entryKind, name: snapshot.name,
      description: snapshot.description, data: snapshot.entryData });
    if (state.recipe.source.kind === "ARTIFACT") {
      if (!snapshot.baseItemId) throw new Error("CREATION_DATA_UNAVAILABLE");
      instanceId = randomUUID();
      await tx.insert(worldContentInstances).values({ id: instanceId, campaignId: auth.campaignId,
        worldContentId: snapshot.baseItemId, displayNameOverride: snapshot.name, quantity: 1,
        inventoryCharacterId: state.character.id, discovered: state.visibleItemIds.has(snapshot.baseItemId) });
      instanceChanges.push({ id: instanceId, revision: 0, quantity: 1, effect: "CREATE" });
    }
    await tx.insert(creationObjects).values({ id: outputObjectId, campaignId: auth.campaignId, versionId: point.versionId,
      kind: state.recipe.source.kind, characterId: state.character.id, entryId, instanceId, status: "ACTIVE",
      level: point.level, stage: point.stage, snapshot, snapshotHash: creationHash(snapshot), paidBasis: state.paidBasis,
      createdActionId: command.actionId, createdByMembershipId: auth.membershipId });
  } else if (point) throw new Error("CREATION_DATA_UNAVAILABLE");
  const receipt: CreationOperationReceipt = { actionId: command.actionId, quoteId: command.quoteId, characterId: state.character.id,
    recipeVersionId: state.recipe.version.id, operation: state.recipe.source.operation,
    consumedObjectIds: state.objects.map(o => o.id), outputObjectId, entryId, instanceId,
    spent: state.spend, returned: state.returns, completedAt: now.toISOString() };
  await tx.insert(creationOperations).values({ id: operationId, campaignId: auth.campaignId, actionId: command.actionId,
    quoteId: command.quoteId, actorMembershipId: auth.membershipId, characterId: state.character.id, receipt,
    provenance: { inputHash: state.inputHash, recipeHash: state.recipe.version.sourceHash,
      inputObjects: state.objects.map(o => ({ id: o.id, versionId: o.versionId, snapshotHash: o.snapshotHash, paidBasis: o.paidBasis })),
      paidBasis: state.paidBasis, walletBefore: state.character.wallet, walletAfter, additionalCopperDebit,
      pickedMaterials: state.pickedMaterials.map(p => ({ instanceId: p.instance.id, worldContentId: p.instance.worldContentId,
        quantity: p.quantity })), refunds, instanceChanges } });
  if (outputObjectId && state.objects.length) await tx.insert(creationObjectEdges).values(state.objects.map(o => ({
    campaignId: auth.campaignId, inputObjectId: o.id, outputObjectId: outputObjectId!, operationId,
  })));
  if (instanceChanges.length) await tx.insert(worldContentInstanceActions).values({ campaignId: auth.campaignId,
    actionId: command.actionId, type: "creation.operation", entityType: "world_content_instance",
    entityId: instanceId ?? instanceChanges[0]!.id, actorMembershipId: auth.membershipId,
    payload: { operationId, instanceChanges } });
  return receipt;
}
