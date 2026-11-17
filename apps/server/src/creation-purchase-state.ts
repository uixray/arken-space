import { and, asc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { mergeCreationPaidBasis, type creationStoreQuoteSchema } from "@arken/contracts";
import { characters, creationLicences, memberships } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationHash, type CreationTransaction } from "./creation-state.js";
import { creationWalletAfter, emptyCreationBasis, loadCreationOperationState, lockCreationCharacter,
  readCreationWallet, type CreationQuoteRequest } from "./creation-operation-state.js";
import { loadCurrentCreationListing, requireCreationPayee, validateCreationListing } from "./creation-listings.js";
import { walletCopper } from "./economy-math.js";

export type CreationPurchaseRequest = z.infer<typeof creationStoreQuoteSchema>;
/** The caller holds graph -> campaign/member. Both wallets are locked in UUID
 * order, after all canonical ingredients and before entries/instances. */
export async function loadCreationPurchaseState(tx: CreationTransaction, auth: AuthContext, command: CreationPurchaseRequest) {
  const lot = await loadCurrentCreationListing(tx, auth, command.listingVersionId);
  const [identity] = await tx.select({ owner: characters.ownerMembershipId }).from(characters)
    .where(and(eq(characters.campaignId, auth.campaignId), eq(characters.id, command.characterId))).limit(1);
  if (!identity) throw new Error("CREATION_FORBIDDEN");
  const memberIds = [...new Set([auth.membershipId, lot.listing.authorMembershipId, ...(identity.owner ? [identity.owner] : [])])].sort();
  const memberRows = await tx.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.campaignId, auth.campaignId), inArray(memberships.id, memberIds)))
    .orderBy(asc(memberships.id)).for("share");
  if (memberRows.length !== memberIds.length) throw new Error("CREATION_FORBIDDEN");
  const details = await validateCreationListing(tx, auth, lot.source, lot.listing.authorMembershipId, lot.source.mode === "TEMPLATE");
  const payoutId = lot.source.payoutCharacterId;
  const characterIds = [...new Set([command.characterId, ...(payoutId ? [payoutId] : [])])].sort();
  const fabricationRequest: CreationQuoteRequest | null = lot.source.mode === "COPY" ? {
    characterId: command.characterId, recipeVersionId: lot.source.recipeVersionId!, inputObjectIds: [], materialPicks: command.materialPicks,
  } : null;
  if (!fabricationRequest && command.materialPicks.length) throw new Error("CREATION_MATERIALS_MISMATCH");
  const fabrication = fabricationRequest ? await loadCreationOperationState(tx, auth, fabricationRequest,
    { storeCopyVersionId: lot.source.versionId, lockCharacterIds: characterIds }) : null;
  if (fabrication && fabrication.visibleItemIds.size !== fabrication.validated.itemVersions.length)
    throw new Error("CREATION_STORE_HIDDEN_MATERIAL");
  if (!fabrication) await tx.select({ id: characters.id }).from(characters).where(and(eq(characters.campaignId, auth.campaignId),
    inArray(characters.id, characterIds))).orderBy(asc(characters.id)).for("update");
  const character = fabrication?.character ?? await lockCreationCharacter(tx, auth, command.characterId);
  if (character.ownerMembershipId !== identity.owner) throw new Error("CREATION_CONFLICT");
  const payee = await requireCreationPayee(tx, auth.campaignId, lot.source, lot.listing.authorMembershipId, "update");
  if (character.id === payee?.id || character.ownerMembershipId === lot.listing.authorMembershipId)
    throw new Error("CREATION_STORE_SELF_PURCHASE");
  // A controller spends on behalf of the character, not to acquire a personal
  // entitlement with somebody else's wallet. The beneficiary is shown in quote.
  const beneficiaryMembershipId = lot.source.mode === "TEMPLATE" ? character.ownerMembershipId : null;
  if (lot.source.mode === "TEMPLATE") {
    if (!beneficiaryMembershipId) throw new Error("CREATION_STORE_OWNER_REQUIRED");
    const [prior] = await tx.select({ id: creationLicences.id }).from(creationLicences).where(and(
      eq(creationLicences.campaignId, auth.campaignId), eq(creationLicences.ownerMembershipId, beneficiaryMembershipId),
      eq(creationLicences.versionId, lot.source.versionId))).limit(1);
    if (prior) throw new Error("CREATION_LICENCE_OWNED");
  }
  const price = BigInt(lot.source.priceCopper);
  const sinkCopper = lot.source.payout === "SINK" ? Number(price) :
    Number((price * BigInt(details.policy.policy.commissionBasisPoints) + 9999n) / 10000n);
  const authorIncomeCopper = lot.source.priceCopper - sinkCopper;
  const total = mergeCreationPaidBasis([fabrication?.spend ?? emptyCreationBasis(),
    { ...emptyCreationBasis(), copper: lot.source.priceCopper }]);
  const wallet = readCreationWallet(character.wallet);
  const affordable = walletCopper(wallet) >= BigInt(total.copper) && wallet.sp >= total.sp;
  const walletAfter = affordable ? creationWalletAfter(wallet, total, emptyCreationBasis()) : null;
  const payeeWallet = payee ? readCreationWallet(payee.wallet) : null;
  const payeeWalletAfter = payeeWallet ? creationWalletAfter(payeeWallet, emptyCreationBasis(),
    { ...emptyCreationBasis(), copper: authorIncomeCopper }) : null;
  const inputs = { request: command, actor: auth.membershipId, listingId: lot.listing.id,
    listingRevision: lot.listing.revision, soldCount: lot.listing.soldCount, sourceHash: lot.version.sourceHash,
    policy: details.policy, versionHash: details.approved.version.versionHash,
    reviewRevision: details.approved.review.revision, ruleRevision: details.approved.rules.pack.revision,
    author: { id: details.author.id, role: details.author.role }, itemVersions: details.itemVersions,
    buyer: { id: character.id, owner: character.ownerMembershipId, revision: character.revision, wallet },
    payee: payee ? { id: payee.id, owner: payee.ownerMembershipId, revision: payee.revision, wallet: payeeWallet } : null,
    beneficiaryMembershipId, fabricationInputHash: fabrication?.inputHash ?? null, total, authorIncomeCopper, sinkCopper };
  return { lot, details, character, payee, beneficiaryMembershipId, fabrication, fabricationRequest,
    authorIncomeCopper, sinkCopper, total, affordable, walletAfter, payeeWalletAfter, inputs, inputHash: creationHash(inputs) };
}
