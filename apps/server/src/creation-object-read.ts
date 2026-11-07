import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { entryDataSchema } from "@arken/contracts";
import { z } from "zod";
import { characterCatalogEntries, characterControllers, characters, creationObjectEdges, creationObjects, creationOperations,
  creationReviews, creationRulePacks, creationRuleVersions, creationTemplates, creationTemplateVersions, memberships } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationObjectSnapshotSchema } from "./creation-runtime-state.js";
import { creationHash, requireCreationMember, type CreationDatabase } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
const issuedCardMetadata = z.object({ card: z.object({
  requirements: z.array(z.object({statKey:z.string(),minimum:z.number().finite()})).max(128),
  artifact: z.object({category:z.string(),rarity:z.string()}).nullable(),
}) });

/** Current holder/controller may see the issued card and immediate lineage, not
 * the original author's private recipe, old wallets or historical receipts. */
export function readCreationObjects(db: CreationDatabase, auth: AuthContext, characterId: string, after?: string) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const [character] = await tx.select().from(characters).where(and(eq(characters.campaignId, auth.campaignId),
      eq(characters.id, characterId))).limit(1).for("share");
    if (!character) throw new Error("CREATION_UNAVAILABLE");
    if (auth.role !== "GM" && character.ownerMembershipId !== auth.membershipId) {
      const [controller] = await tx.select({ id: characterControllers.membershipId }).from(characterControllers)
        .where(and(eq(characterControllers.characterId, characterId), eq(characterControllers.membershipId, auth.membershipId)))
        .limit(1).for("share");
      if (!controller) throw new Error("CREATION_FORBIDDEN");
    }
    const rows = await tx.select().from(creationObjects).where(and(eq(creationObjects.campaignId, auth.campaignId),
      eq(creationObjects.characterId, characterId), eq(creationObjects.status, "ACTIVE"),
      after ? gt(creationObjects.id, after) : undefined)).orderBy(asc(creationObjects.id)).limit(51);
    const page = rows.slice(0, 50);
    const entries = page.length ? await tx.select().from(characterCatalogEntries).where(and(
      eq(characterCatalogEntries.characterId, characterId), inArray(characterCatalogEntries.id, page.map(o => o.entryId!)))) : [];
    const rules = page.length ? await tx.select({ versionId: creationTemplateVersions.id, enabled: creationRulePacks.enabled,
      evaluation: creationTemplateVersions.evaluation })
      .from(creationTemplateVersions).innerJoin(creationRuleVersions, eq(creationRuleVersions.id, creationTemplateVersions.ruleVersionId))
      .innerJoin(creationRulePacks, eq(creationRulePacks.id, creationRuleVersions.packId))
      .where(and(eq(creationTemplateVersions.campaignId, auth.campaignId), inArray(creationTemplateVersions.id, page.map(o => o.versionId)))) : [];
    const authors = page.length ? await tx.select({ versionId: creationTemplateVersions.id,
      membershipId: creationTemplates.authorMembershipId, displayName: memberships.displayName })
      .from(creationTemplateVersions).innerJoin(creationTemplates, eq(creationTemplates.id, creationTemplateVersions.templateId))
      .innerJoin(memberships, eq(memberships.id, creationTemplates.authorMembershipId))
      .where(and(eq(creationTemplateVersions.campaignId, auth.campaignId), inArray(creationTemplateVersions.id, page.map(o => o.versionId)))) : [];
    const parents = page.length ? await tx.select().from(creationObjectEdges).where(and(
      eq(creationObjectEdges.campaignId, auth.campaignId), inArray(creationObjectEdges.outputObjectId, page.map(o => o.id)))) : [];
    const reviews = page.length ? await tx.selectDistinctOn([creationReviews.versionId], {
      versionId: creationReviews.versionId, revision: creationReviews.revision, decision: creationReviews.decision })
      .from(creationReviews).where(and(eq(creationReviews.campaignId, auth.campaignId),
        inArray(creationReviews.versionId, page.map(o => o.versionId))))
      .orderBy(asc(creationReviews.versionId), desc(creationReviews.revision)) : [];
    return { characterId, items: page.map(o => {
      const snapshot = creationObjectSnapshotSchema.safeParse(o.snapshot);
      const entry = entries.find(e => e.id === o.entryId);
      const liveData = entryDataSchema.safeParse(entry?.data);
      const rule = rules.find(r => r.versionId === o.versionId);
      const metadata = issuedCardMetadata.safeParse(rule?.evaluation);
      if (!snapshot.success || !entry || !liveData.success || creationHash(o.snapshot) !== o.snapshotHash)
        throw new Error("CREATION_DATA_UNAVAILABLE");
      return { id: o.id, versionId: o.versionId, kind: o.kind, entryId: o.entryId, instanceId: o.instanceId,
        level: o.level, stage: o.stage, revision: o.revision, snapshot: snapshot.data, createdAt: o.createdAt,
        runtimeEntry: { id: entry.id, revision: entry.revision, data: liveData.data },
        rulesEnabled: rule?.enabled ?? false,
        metadataAvailable: metadata.success,
        requirements: metadata.success ? metadata.data.card.requirements : [],
        artifact: metadata.success ? metadata.data.card.artifact : null,
        author: authors.find(a => a.versionId === o.versionId) ?? null,
        review: reviews.find(r => r.versionId === o.versionId) ?? null,
        parentObjectIds: parents.filter(e => e.outputObjectId === o.id).map(e => e.inputObjectId) };
    }), nextAfter: rows.length > 50 ? page[49]!.id : null };
  });
}
/** Historical receipts stay actor-owned even after transfer/archival. New
 * controllers never inherit them. GM may read the campaign's operation log. */
export function readCreationOperations(db: CreationDatabase, auth: AuthContext, characterId?: string, after?: string) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const rows = await tx.select({ id: creationOperations.id, receipt: creationOperations.receipt,
      createdAt: creationOperations.createdAt }).from(creationOperations).where(and(
      eq(creationOperations.campaignId, auth.campaignId),
      auth.role === "GM" ? undefined : eq(creationOperations.actorMembershipId, auth.membershipId),
      characterId ? eq(creationOperations.characterId, characterId) : undefined,
      after ? gt(creationOperations.id, after) : undefined)).orderBy(asc(creationOperations.id)).limit(51);
    return { items: rows.slice(0, 50), nextAfter: rows.length > 50 ? rows[49]!.id : null };
  });
}
