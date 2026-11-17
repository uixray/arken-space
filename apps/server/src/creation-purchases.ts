import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { creationStoreQuoteSchema, type CreationOperationQuote, type CreationOperationReceipt,
  type CreationPurchaseReceipt, type CreationStoreQuote } from "@arken/contracts";
import { characters, creationLicences, creationListings, creationOperationQuotes, creationPurchases, creationStoreQuotes } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationAction, creationHash, requireCreationMember, type CreationDatabase } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { loadCreationPurchaseState, type CreationPurchaseRequest } from "./creation-purchase-state.js";
import { emptyCreationBasis } from "./creation-operation-state.js";
import { applyCreationOperation } from "./creation-operations.js";
import { requireCreationListingCapacity } from "./creation-listings.js";

export function quoteCreationPurchase(db: CreationDatabase, auth: AuthContext, command: CreationPurchaseRequest) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const state = await loadCreationPurchaseState(tx, auth, command);
    const id = randomUUID(), expiresAt = new Date(Math.min(Date.now() + 120_000,
      state.lot.source.availableUntil ? Date.parse(state.lot.source.availableUntil) : Infinity));
    const view: CreationStoreQuote = { id, listingId: state.lot.listing.id, listingVersionId: state.lot.version.id,
      versionId: state.lot.source.versionId, name: state.details.approved.evaluation.card.name, mode: state.lot.source.mode,
      characterId: state.character.id, beneficiaryMembershipId: state.beneficiaryMembershipId,
      priceCopper: state.lot.source.priceCopper, authorIncomeCopper: state.authorIncomeCopper, sinkCopper: state.sinkCopper,
      fabrication: state.fabrication?.spend ?? emptyCreationBasis(), total: state.total, affordable: state.affordable,
      expiresAt: expiresAt.toISOString(), rounding: "CEIL_COMMISSION_COPPER" };
    await tx.insert(creationStoreQuotes).values({ id, campaignId: auth.campaignId, actorMembershipId: auth.membershipId,
      characterId: command.characterId, listingVersionId: command.listingVersionId, request: command,
      inputs: state.inputs, inputHash: state.inputHash, view, expiresAt });
    return view;
  });
}
export function commitCreationPurchase(db: CreationDatabase, auth: AuthContext, command: { actionId: string; quoteId: string }) {
  return creationAction(db, auth, command.actionId, "creation.store.purchase", command, async tx => {
    const [quote] = await tx.select().from(creationStoreQuotes).where(and(eq(creationStoreQuotes.id, command.quoteId),
      eq(creationStoreQuotes.campaignId, auth.campaignId), eq(creationStoreQuotes.actorMembershipId, auth.membershipId)))
      .limit(1).for("update");
    if (!quote) throw new Error("CREATION_QUOTE_UNAVAILABLE");
    const [used] = await tx.select({ id: creationPurchases.id }).from(creationPurchases).where(eq(creationPurchases.quoteId, quote.id)).limit(1);
    if (used) throw new Error("CREATION_QUOTE_USED");
    if (quote.expiresAt.getTime() <= Date.now()) throw new Error("CREATION_QUOTE_EXPIRED");
    const parsed = creationStoreQuoteSchema.safeParse(quote.request);
    if (!parsed.success || parsed.data.characterId !== quote.characterId || parsed.data.listingVersionId !== quote.listingVersionId ||
        creationHash(quote.inputs) !== quote.inputHash) throw new Error("CREATION_DATA_UNAVAILABLE");
    const state = await loadCreationPurchaseState(tx, auth, parsed.data);
    if (state.inputHash !== quote.inputHash) throw new Error("CREATION_QUOTE_STALE");
    requireCreationListingCapacity(state.lot.source, state.lot.listing.soldCount);
    if (quote.expiresAt.getTime() <= Date.now()) throw new Error("CREATION_QUOTE_EXPIRED");
    if (!state.affordable || !state.walletAfter) throw new Error("CREATION_INSUFFICIENT_FUNDS");
    const now = new Date(), purchaseId = randomUUID();
    let operation: CreationOperationReceipt | null = null;
    if (state.fabrication && state.fabricationRequest) {
      const f = state.fabrication, internalQuoteId = randomUUID();
      const view: CreationOperationQuote = { id: internalQuoteId, characterId: state.character.id,
        recipeVersionId: f.recipe.version.id, recipeName: f.recipe.source.name, operation: "CRAFT", inputObjectIds: [],
        output: { ...f.recipe.source.output!, name: state.details.approved.evaluation.card.name, kind: f.recipe.source.kind },
        spend: f.spend, returns: f.returns, affordable: true, expiresAt: quote.expiresAt.toISOString(), rounding: "FLOOR_EACH_REFUND_RESOURCE" };
      // This lifecycle quote does not exist until the purchase transaction, and
      // is consumed inside it. There is no separately committable free-copy quote.
      await tx.insert(creationOperationQuotes).values({ id: internalQuoteId, campaignId: auth.campaignId,
        actorMembershipId: auth.membershipId, characterId: state.character.id, recipeVersionId: f.recipe.version.id,
        request: state.fabricationRequest, inputs: f.inputs, inputHash: f.inputHash, view, expiresAt: quote.expiresAt });
      operation = await applyCreationOperation(tx, auth, { actionId: command.actionId, quoteId: internalQuoteId }, f, state.lot.source.priceCopper);
    } else await tx.update(characters).set({ wallet: state.walletAfter, revision: state.character.revision + 1, updatedAt: now })
      .where(and(eq(characters.campaignId, auth.campaignId), eq(characters.id, state.character.id)));
    if (state.payee && state.payeeWalletAfter && state.authorIncomeCopper > 0) await tx.update(characters)
      .set({ wallet: state.payeeWalletAfter, revision: state.payee.revision + 1, updatedAt: now })
      .where(and(eq(characters.campaignId, auth.campaignId), eq(characters.id, state.payee.id)));
    const licenceId = state.beneficiaryMembershipId ? randomUUID() : null;
    const receipt: CreationPurchaseReceipt = { purchaseId, actionId: command.actionId, quoteId: quote.id,
      listingId: state.lot.listing.id, listingVersionId: state.lot.version.id, versionId: state.lot.source.versionId,
      name: state.details.approved.evaluation.card.name, authorMembershipId: state.lot.listing.authorMembershipId,
      mode: state.lot.source.mode, characterId: state.character.id, beneficiaryMembershipId: state.beneficiaryMembershipId,
      priceCopper: state.lot.source.priceCopper, authorIncomeCopper: state.authorIncomeCopper, sinkCopper: state.sinkCopper,
      total: state.total, licenceId, operation, completedAt: now.toISOString() };
    await tx.insert(creationPurchases).values({ id: purchaseId, campaignId: auth.campaignId, actionId: command.actionId,
      quoteId: quote.id, actorMembershipId: auth.membershipId, characterId: state.character.id,
      authorMembershipId: state.lot.listing.authorMembershipId, payoutCharacterId: state.payee?.id ?? null,
      beneficiaryMembershipId: state.beneficiaryMembershipId, listingVersionId: state.lot.version.id,
      templateVersionId: state.lot.source.versionId, mode: state.lot.source.mode, outputObjectId: operation?.outputObjectId ?? null,
      priceCopper: state.lot.source.priceCopper, authorIncomeCopper: state.authorIncomeCopper, sinkCopper: state.sinkCopper,
      receipt, provenance: { inputHash: state.inputHash, listingSourceHash: state.lot.version.sourceHash,
        policy: state.details.policy, buyerBefore: state.character.wallet, buyerAfter: state.walletAfter,
        payeeBefore: state.payee?.wallet ?? null, payeeAfter: state.payeeWalletAfter } });
    if (licenceId && state.beneficiaryMembershipId) await tx.insert(creationLicences).values({ id: licenceId,
      campaignId: auth.campaignId, ownerMembershipId: state.beneficiaryMembershipId, versionId: state.lot.source.versionId, purchaseId });
    await tx.update(creationListings).set({ soldCount: state.lot.listing.soldCount + 1, revision: state.lot.listing.revision + 1 })
      .where(and(eq(creationListings.campaignId, auth.campaignId), eq(creationListings.id, state.lot.listing.id)));
    return { ...receipt };
  });
}
