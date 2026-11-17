import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { creationListingSourceSchema, creationStorePolicySchema, type CreationListingSource,
  type saveCreationListingSchema, type saveCreationStorePolicySchema, type setCreationListingEnabledSchema } from "@arken/contracts";
import { characters, creationListings, creationListingVersions, creationStorePolicies, memberships, worldContent } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationAction, creationHash, type CreationDatabase, type CreationTransaction } from "./creation-state.js";
import { loadApprovedCreationVersion } from "./creation-runtime-state.js";
import { loadCurrentCreationRecipe, validateCreationRecipe } from "./creation-recipes.js";
import { worldContentPlayerVisibleIn } from "./world-content.js";

export async function loadCreationStorePolicy(tx: CreationTransaction, campaignId: string) {
  const [row] = await tx.select().from(creationStorePolicies).where(eq(creationStorePolicies.campaignId, campaignId)).limit(1);
  if (!row) throw new Error("CREATION_STORE_DISABLED");
  const parsed = creationStorePolicySchema.safeParse(row.policy);
  if (!parsed.success) throw new Error("CREATION_DATA_UNAVAILABLE");
  if (!parsed.data.enabled) throw new Error("CREATION_STORE_DISABLED");
  return { revision: row.revision, policy: parsed.data };
}
export function saveCreationStorePolicy(db: CreationDatabase, auth: AuthContext, command: z.infer<typeof saveCreationStorePolicySchema>) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return creationAction(db, auth, command.actionId, "creation.store.policy", command, async tx => {
    const [row] = await tx.select().from(creationStorePolicies).where(eq(creationStorePolicies.campaignId, auth.campaignId)).limit(1);
    if ((row?.revision ?? null) !== command.expectedRevision) throw new Error("CREATION_CONFLICT");
    const revision = (row?.revision ?? -1) + 1;
    if (row) await tx.update(creationStorePolicies).set({ policy: command.policy, revision, updatedAt: new Date() })
      .where(eq(creationStorePolicies.campaignId, auth.campaignId));
    else await tx.insert(creationStorePolicies).values({ campaignId: auth.campaignId, revision, policy: command.policy });
    return { policy: command.policy, revision, reason: command.reason };
  });
}
export function parsedCreationListing(row: typeof creationListingVersions.$inferSelect) {
  const parsed = creationListingSourceSchema.safeParse(row.source);
  if (!parsed.success || parsed.data.versionId !== row.templateVersionId || creationHash(parsed.data) !== row.sourceHash)
    throw new Error("CREATION_DATA_UNAVAILABLE");
  return parsed.data;
}
export async function latestCreationListing(tx: CreationTransaction, campaignId: string, listingId: string) {
  const [row] = await tx.select().from(creationListingVersions).where(and(eq(creationListingVersions.campaignId, campaignId),
    eq(creationListingVersions.listingId, listingId))).orderBy(desc(creationListingVersions.number)).limit(1);
  if (!row) throw new Error("CREATION_UNAVAILABLE");
  return row;
}
export async function loadCurrentCreationListing(tx: CreationTransaction, auth: AuthContext, versionId: string) {
  const [row] = await tx.select({ listing: creationListings, version: creationListingVersions }).from(creationListingVersions)
    .innerJoin(creationListings, and(eq(creationListings.id, creationListingVersions.listingId),
      eq(creationListings.campaignId, creationListingVersions.campaignId)))
    .where(and(eq(creationListingVersions.campaignId, auth.campaignId), eq(creationListingVersions.id, versionId))).limit(1);
  if (!row || !row.listing.enabled || row.listing.blockedByGm) throw new Error("CREATION_LISTING_UNAVAILABLE");
  if ((await latestCreationListing(tx, auth.campaignId, row.listing.id)).id !== row.version.id)
    throw new Error("CREATION_QUOTE_STALE");
  const source = parsedCreationListing(row.version);
  requireCreationListingCapacity(source, row.listing.soldCount);
  return { ...row, source };
}
export function requireCreationListingCapacity(source: CreationListingSource, soldCount: number) {
  if (soldCount >= (source.maxPurchases ?? 1_000_000)) throw new Error("CREATION_LISTING_SOLD_OUT");
  if (source.availableUntil && Date.parse(source.availableUntil) <= Date.now()) throw new Error("CREATION_LISTING_EXPIRED");
}
/** Read mode never locks canonical rows: a page of unrelated lots must not lock
 * ITEMs in arbitrary per-lot order. Buy re-locks all canonical IDs in one sorted
 * batch in lifecycle state (COPY) or here (TEMPLATE) before either wallet. */
export async function validateCreationListing(tx: CreationTransaction, auth: AuthContext, source: CreationListingSource,
  authorMembershipId: string, lockItems: boolean) {
  const policy = await loadCreationStorePolicy(tx, auth.campaignId);
  const [author] = await tx.select({ id: memberships.id, role: memberships.role, displayName: memberships.displayName })
    .from(memberships).where(and(eq(memberships.campaignId, auth.campaignId), eq(memberships.id, authorMembershipId))).limit(1);
  if (!author || (author.role !== "GM" && !policy.policy.allowPlayerListings)) throw new Error("CREATION_LISTING_UNAVAILABLE");
  const approved = await loadApprovedCreationVersion(tx, auth, source.versionId);
  if (approved.template.authorMembershipId !== author.id) throw new Error("CREATION_FORBIDDEN");
  if (!policy.policy.allowedKinds.includes(approved.template.kind) || source.priceCopper < policy.policy.minimumPriceCopper ||
      source.priceCopper > policy.policy.maximumPriceCopper) throw new Error("CREATION_STORE_POLICY");
  if (source.payout === "SINK" && author.role !== "GM") throw new Error("CREATION_STORE_PAYOUT");
  const recipe = source.recipeVersionId ? await loadCurrentCreationRecipe(tx, auth, source.recipeVersionId) : null;
  if (recipe && (recipe.source.operation !== "CRAFT" || recipe.source.inputs.length ||
      recipe.source.output?.versionId !== source.versionId || recipe.source.kind !== approved.template.kind))
    throw new Error("CREATION_STORE_RECIPE");
  let itemVersions: Array<{ id: string; revision: number }>;
  if (recipe) itemVersions = (await validateCreationRecipe(tx, auth, recipe.source, [], lockItems)).itemVersions;
  else {
    const card = approved.evaluation.card;
    const ids = [...new Set([...card.materials.map(m => m.worldContentId), ...(card.artifact ? [card.artifact.baseItemId] : [])])].sort();
    const query = tx.select({ id: worldContent.id, revision: worldContent.revision, type: worldContent.type, lifecycle: worldContent.lifecycle })
      .from(worldContent).where(inArray(worldContent.id, ids)).orderBy(asc(worldContent.id));
    const rows = ids.length ? (lockItems ? await query.for("share") : await query) : [];
    if (rows.length !== ids.length || rows.some(r => r.type !== "ITEM" || r.lifecycle === "ARCHIVED"))
      throw new Error("CREATION_ITEM_UNAVAILABLE");
    itemVersions = rows.map(r => ({ id: r.id, revision: r.revision }));
  }
  // Publishing is NOT a discovery operation, even for a GM-authored system lot.
  const visible = itemVersions.length ? await tx.select({ id: worldContent.id }).from(worldContent)
    .where(and(inArray(worldContent.id, itemVersions.map(i => i.id)), worldContentPlayerVisibleIn(auth.campaignId))) : [];
  if (visible.length !== itemVersions.length) throw new Error("CREATION_STORE_HIDDEN_MATERIAL");
  return { policy, author, approved, recipe, itemVersions };
}
export async function requireCreationPayee(tx: CreationTransaction, campaignId: string, source: CreationListingSource,
  authorMembershipId: string, lock: "share" | "update" = "share") {
  if (!source.payoutCharacterId) return null;
  const [character] = await tx.select().from(characters).where(and(eq(characters.campaignId, campaignId),
    eq(characters.id, source.payoutCharacterId))).limit(1).for(lock);
  if (!character || character.lifecycle !== "ACTIVE" || character.ownerMembershipId !== authorMembershipId)
    throw new Error("CREATION_STORE_PAYOUT");
  return character;
}
export function saveCreationListing(db: CreationDatabase, auth: AuthContext, command: z.infer<typeof saveCreationListingSchema>) {
  return creationAction(db, auth, command.actionId, "creation.store.listing", command, async tx => {
    const [listing] = await tx.select().from(creationListings).where(and(eq(creationListings.campaignId, auth.campaignId),
      eq(creationListings.id, command.listingId))).limit(1);
    // A GM may hide somebody else's lot, not impersonate its author or payout destination.
    if (listing && listing.authorMembershipId !== auth.membershipId) throw new Error("CREATION_FORBIDDEN");
    if (listing?.blockedByGm && auth.role !== "GM") throw new Error("CREATION_LISTING_MODERATED");
    if ((listing?.revision ?? null) !== command.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (!listing && (await tx.select({ id: creationListings.id }).from(creationListings)
      .where(eq(creationListings.campaignId, auth.campaignId)).limit(256)).length >= 256) throw new Error("CREATION_CATALOG_LIMIT");
    requireCreationListingCapacity(command.source, listing?.soldCount ?? 0);
    await validateCreationListing(tx, auth, command.source, auth.membershipId, true);
    await requireCreationPayee(tx, auth.campaignId, command.source, auth.membershipId);
    const latest = listing ? await latestCreationListing(tx, auth.campaignId, listing.id) : null;
    if ((latest?.number ?? 0) >= 1000) throw new Error("CREATION_VERSION_LIMIT");
    // A lot cannot be repurposed from a sold licence into unrelated content.
    if (latest) {
      const prior = parsedCreationListing(latest);
      if (prior.versionId !== command.source.versionId || prior.mode !== command.source.mode)
        throw new Error("CREATION_LISTING_IDENTITY");
    }
    const number = (latest?.number ?? 0) + 1, revision = (listing?.revision ?? -1) + 1, versionId = randomUUID();
    if (listing) await tx.update(creationListings).set({ revision, enabled: true, blockedByGm: false }).where(eq(creationListings.id, listing.id));
    else await tx.insert(creationListings).values({ id: command.listingId, campaignId: auth.campaignId,
      authorMembershipId: auth.membershipId, enabled: true, revision });
    await tx.insert(creationListingVersions).values({ id: versionId, campaignId: auth.campaignId, listingId: command.listingId,
      templateVersionId: command.source.versionId, number, source: command.source, sourceHash: creationHash(command.source) });
    return { listingId: command.listingId, versionId, number, revision, soldCount: listing?.soldCount ?? 0 };
  });
}
export function setCreationListingEnabled(db: CreationDatabase, auth: AuthContext, command: z.infer<typeof setCreationListingEnabledSchema>) {
  return creationAction(db, auth, command.actionId, "creation.store.listing.enabled", command, async tx => {
    const [listing] = await tx.select().from(creationListings).where(and(eq(creationListings.campaignId, auth.campaignId),
      eq(creationListings.id, command.listingId))).limit(1);
    if (!listing || (auth.role !== "GM" && listing.authorMembershipId !== auth.membershipId)) throw new Error("CREATION_FORBIDDEN");
    if (listing.revision !== command.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (command.enabled) {
      if (listing.blockedByGm && auth.role !== "GM") throw new Error("CREATION_LISTING_MODERATED");
      const source = parsedCreationListing(await latestCreationListing(tx, auth.campaignId, listing.id));
      requireCreationListingCapacity(source, listing.soldCount);
      await validateCreationListing(tx, auth, source, listing.authorMembershipId, true);
      await requireCreationPayee(tx, auth.campaignId, source, listing.authorMembershipId);
    }
    await tx.update(creationListings).set({ revision: listing.revision + 1, enabled: command.enabled,
      blockedByGm: auth.role === "GM" ? !command.enabled : listing.blockedByGm }).where(eq(creationListings.id, listing.id));
    return { listingId: listing.id, revision: listing.revision + 1, enabled: command.enabled, reason: command.reason };
  });
}
