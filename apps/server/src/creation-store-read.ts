import { and, asc, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { creationDesignSchema, creationStorePolicySchema } from "@arken/contracts";
import { creationLicences, creationListings, creationListingVersions, creationPurchases, creationReviews,
  creationRulePacks, creationRuleVersions, creationStorePolicies, creationTemplates, creationTemplateVersions, memberships } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationAccessMembers } from "./creation-access.js";
import { creationHash, requireCreationMember, type CreationDatabase } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { latestCreationListing, parsedCreationListing, requireCreationListingCapacity, validateCreationListing } from "./creation-listings.js";
import { storedEvaluationSchema } from "./creation-runtime-state.js";

export function readCreationStorePolicy(db: CreationDatabase, auth: AuthContext) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const [row] = await tx.select().from(creationStorePolicies).where(eq(creationStorePolicies.campaignId, auth.campaignId)).limit(1);
    if (!row) return { policy: null, revision: null };
    const parsed = creationStorePolicySchema.safeParse(row.policy);
    if (!parsed.success) throw new Error("CREATION_DATA_UNAVAILABLE");
    return { policy: parsed.data, revision: row.revision };
  });
}
const unavailable = new Set(["CREATION_STORE_DISABLED", "CREATION_LISTING_UNAVAILABLE", "CREATION_LISTING_SOLD_OUT",
  "CREATION_LISTING_EXPIRED", "CREATION_RULES_DISABLED", "CREATION_APPROVAL_REQUIRED", "CREATION_STORE_POLICY",
  "CREATION_ITEM_UNAVAILABLE", "CREATION_STORE_HIDDEN_MATERIAL", "CREATION_RECIPE_DISABLED", "CREATION_RECIPE_STALE",
  "CREATION_EVALUATOR_CHANGED", "CREATION_STORE_PAYOUT"]);
const publicTerms = (source: ReturnType<typeof parsedCreationListing>) => ({ versionId: source.versionId,
  mode: source.mode, recipeVersionId: source.recipeVersionId, priceCopper: source.priceCopper,
  collection: source.collection, note: source.note, maxPurchases: source.maxPurchases, availableUntil: source.availableUntil });
export function readCreationListings(db: CreationDatabase, auth: AuthContext, manage = false, after?: string) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const rows = await tx.select().from(creationListings).where(and(eq(creationListings.campaignId, auth.campaignId),
      manage ? (auth.role === "GM" ? undefined : eq(creationListings.authorMembershipId, auth.membershipId)) : eq(creationListings.enabled, true),
      after ? gt(creationListings.id, after) : undefined)).orderBy(asc(creationListings.id)).limit(51);
    const page = rows.slice(0, 50), items: Array<Record<string, unknown>> = [];
    for (const listing of page) {
      const version = await latestCreationListing(tx, auth.campaignId, listing.id), source = parsedCreationListing(version);
      let blocked: string | null = null;
      let details: Awaited<ReturnType<typeof validateCreationListing>> | null = null;
      try {
        requireCreationListingCapacity(source, listing.soldCount);
        details = await validateCreationListing(tx, auth, source, listing.authorMembershipId, false);
      } catch (e) {
        if (!(e instanceof Error) || !unavailable.has(e.message)) throw e;
        blocked = e.message;
      }
      if (!manage && blocked) continue;
      items.push({ id: listing.id, revision: listing.revision, enabled: listing.enabled,
        soldCount: listing.soldCount, listingVersionId: version.id, number: version.number,
        author: { membershipId: listing.authorMembershipId, displayName: details?.author.displayName ?? null },
        terms: publicTerms(source), blocked,
        card: details ? { ...details.approved.evaluation.card, entryData: details.approved.evaluation.entryData,
          totals: details.approved.evaluation.totals, kind: details.approved.template.kind } : null,
        gmMark: details ? { decision: details.approved.review.decision, revision: details.approved.review.revision } : null,
        fabrication: details?.recipe?.source.cost ?? null,
        ...(manage ? { source, sourceHash: version.sourceHash, blockedByGm: listing.blockedByGm } : {}) });
    }
    // Cursor advances over scanned rows as well, so hidden lots cannot trap a page.
    return { items, nextAfter: rows.length > 50 ? page[49]!.id : null };
  });
}
export function readCreationListingHistory(db: CreationDatabase, auth: AuthContext, listingId: string, before?: number) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const [listing] = await tx.select().from(creationListings).where(and(eq(creationListings.campaignId, auth.campaignId),
      eq(creationListings.id, listingId))).limit(1);
    if (!listing) throw new Error("CREATION_UNAVAILABLE");
    const manage = auth.role === "GM" || listing.authorMembershipId === auth.membershipId;
    if (!manage) {
      if (!listing.enabled) throw new Error("CREATION_UNAVAILABLE");
      await validateCreationListing(tx, auth, parsedCreationListing(await latestCreationListing(tx, auth.campaignId, listingId)),
        listing.authorMembershipId, false);
    }
    const rows = await tx.select().from(creationListingVersions).where(and(eq(creationListingVersions.campaignId, auth.campaignId),
      eq(creationListingVersions.listingId, listingId), before === undefined ? undefined : lt(creationListingVersions.number, before)))
      .orderBy(desc(creationListingVersions.number)).limit(21);
    return { listingId, items: rows.slice(0, 20).map(v => ({ id: v.id, number: v.number, createdAt: v.createdAt,
      terms: publicTerms(parsedCreationListing(v)), ...(manage ? { source: parsedCreationListing(v) } : {}) })),
      nextBefore: rows.length > 20 ? rows[19]!.number : null };
  });
}
/** Purchased versions remain readable after delisting, rules disable or review
 * revocation. New issuance still requires a current permit. Never expose other
 * unpublished versions of the author's template or their private GM reasons. */
export function readCreationLicences(db: CreationDatabase, auth: AuthContext, characterId?: string, after?: string) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const owners = await creationAccessMembers(tx, auth, characterId);
    const rows = await tx.select({ licence: creationLicences, version: creationTemplateVersions, template: creationTemplates,
      rule: creationRuleVersions, pack: creationRulePacks, authorName: memberships.displayName })
      .from(creationLicences).innerJoin(creationTemplateVersions, and(eq(creationTemplateVersions.id, creationLicences.versionId),
        eq(creationTemplateVersions.campaignId, creationLicences.campaignId)))
      .innerJoin(creationTemplates, eq(creationTemplates.id, creationTemplateVersions.templateId))
      .innerJoin(creationRuleVersions, eq(creationRuleVersions.id, creationTemplateVersions.ruleVersionId))
      .innerJoin(creationRulePacks, eq(creationRulePacks.id, creationRuleVersions.packId))
      .innerJoin(memberships, eq(memberships.id, creationTemplates.authorMembershipId))
      .where(and(eq(creationLicences.campaignId, auth.campaignId), inArray(creationLicences.ownerMembershipId, owners),
        after ? gt(creationLicences.id, after) : undefined)).orderBy(asc(creationLicences.id)).limit(51);
    const page = rows.slice(0, 50);
    const reviews = page.length ? await tx.selectDistinctOn([creationReviews.versionId], {
      versionId: creationReviews.versionId, decision: creationReviews.decision, revision: creationReviews.revision })
      .from(creationReviews).where(and(eq(creationReviews.campaignId, auth.campaignId),
        inArray(creationReviews.versionId, page.map(r => r.version.id)))).orderBy(asc(creationReviews.versionId), desc(creationReviews.revision)) : [];
    return { items: page.map(row => {
      const design = creationDesignSchema.safeParse(row.version.design), evaluation = storedEvaluationSchema.safeParse(row.version.evaluation);
      if (!design.success || !evaluation.success || creationHash(row.rule.source) !== row.rule.sourceHash ||
          creationHash({ ruleVersionId: row.rule.id, ruleSourceHash: row.rule.sourceHash, design: row.version.design,
            evaluation: row.version.evaluation }) !== row.version.versionHash) throw new Error("CREATION_DATA_UNAVAILABLE");
      return { id: row.licence.id, ownerMembershipId: row.licence.ownerMembershipId, purchaseId: row.licence.purchaseId,
        createdAt: row.licence.createdAt, author: { membershipId: row.template.authorMembershipId, displayName: row.authorName },
        version: { id: row.version.id, templateId: row.template.id, kind: row.template.kind, number: row.version.number,
          ruleVersionId: row.version.ruleVersionId, versionHash: row.version.versionHash, design: design.data, evaluation: evaluation.data },
        rulesEnabled: row.pack.enabled && row.rule.published, review: reviews.find(r => r.versionId === row.version.id) ?? null };
    }), nextAfter: rows.length > 50 ? page[49]!.licence.id : null };
  });
}
export function readCreationPurchases(db: CreationDatabase, auth: AuthContext, income = false, after?: string) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const rows = await tx.select().from(creationPurchases).where(and(eq(creationPurchases.campaignId, auth.campaignId),
      auth.role === "GM" ? undefined : income ? eq(creationPurchases.authorMembershipId, auth.membershipId) :
        or(eq(creationPurchases.actorMembershipId, auth.membershipId), eq(creationPurchases.beneficiaryMembershipId, auth.membershipId)),
      after ? gt(creationPurchases.id, after) : undefined)).orderBy(asc(creationPurchases.id)).limit(51);
    return { items: rows.slice(0, 50).map(r => income ? { id: r.id, listingVersionId: r.listingVersionId,
      versionId: r.templateVersionId, payoutCharacterId: r.payoutCharacterId, priceCopper: r.priceCopper,
      authorIncomeCopper: r.authorIncomeCopper, sinkCopper: r.sinkCopper, createdAt: r.createdAt } :
      { id: r.id, receipt: r.receipt, createdAt: r.createdAt }), nextAfter: rows.length > 50 ? rows[49]!.id : null };
  });
}
