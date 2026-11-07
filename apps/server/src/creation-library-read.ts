import { and, asc, eq, gt, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { characters, creationObjects, creationObjectEdges, creationTemplateOrigins, creationTemplates, creationTemplateVersions,
  memberships, economyOffers, worldContent, worldContentInstances, worldInstanceBindings } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationAccessMembers } from "./creation-access.js";
import { creationHash, requireCreationMember, type CreationDatabase, type CreationTransaction } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";
import { creationObjectSnapshotSchema } from "./creation-runtime-state.js";
import { worldContentPlayerVisibleIn } from "./world-content.js";

export async function creationOrigins(tx: CreationTransaction, campaignId: string, templateIds: string[]) {
  if (!templateIds.length) return [];
  return tx.select({ templateId: creationTemplateOrigins.templateId, sourceVersionId: creationTemplateOrigins.sourceVersionId,
    sourceTemplateId: creationTemplates.id, sourceAuthorMembershipId: creationTemplates.authorMembershipId,
    sourceAuthorName: memberships.displayName }).from(creationTemplateOrigins)
    .innerJoin(creationTemplateVersions, eq(creationTemplateVersions.id, creationTemplateOrigins.sourceVersionId))
    .innerJoin(creationTemplates, eq(creationTemplates.id, creationTemplateVersions.templateId))
    .innerJoin(memberships, eq(memberships.id, creationTemplates.authorMembershipId))
    .where(and(eq(creationTemplateOrigins.campaignId, campaignId), inArray(creationTemplateOrigins.templateId, templateIds)));
}
export function readCreationMaterials(db: CreationDatabase, auth: AuthContext, characterId: string, after?: string) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId); await requireCreationMember(tx, auth);
    await creationAccessMembers(tx, auth, characterId);
    const [character] = await tx.select().from(characters).where(and(eq(characters.id, characterId), eq(characters.campaignId, auth.campaignId))).limit(1);
    if (!character) throw new Error("CREATION_UNAVAILABLE");
    const rows = await tx.select({ id: worldContentInstances.id, worldContentId: worldContent.id, canonicalName: worldContent.name,
      name: sql<string>`coalesce(${worldContentInstances.displayNameOverride}, ${worldContent.name})`,
      quantity: worldContentInstances.quantity, revision: worldContentInstances.revision }).from(worldContentInstances)
      .innerJoin(worldContent, eq(worldContent.id, worldContentInstances.worldContentId))
      .where(and(eq(worldContentInstances.campaignId, auth.campaignId), eq(worldContentInstances.inventoryCharacterId, characterId),
        eq(worldContent.type, "ITEM"), ne(worldContent.lifecycle, "ARCHIVED"), gt(worldContentInstances.quantity, 0),
        or(isNull(worldContentInstances.ownerMembershipId), character.ownerMembershipId ? eq(worldContentInstances.ownerMembershipId, character.ownerMembershipId) : undefined),
        auth.role === "GM" ? undefined : and(eq(worldContentInstances.discovered, true), worldContentPlayerVisibleIn(auth.campaignId)),
        notExists(tx.select({ id: creationObjects.id }).from(creationObjects).where(eq(creationObjects.instanceId, worldContentInstances.id))),
        notExists(tx.select({ id: economyOffers.id }).from(economyOffers).where(eq(economyOffers.instanceId, worldContentInstances.id))),
        notExists(tx.select({ id: worldInstanceBindings.instanceId }).from(worldInstanceBindings).where(or(
          eq(worldInstanceBindings.instanceId, worldContentInstances.id), eq(worldInstanceBindings.containerInstanceId, worldContentInstances.id)))),
        after ? gt(worldContentInstances.id, after) : undefined)).orderBy(asc(worldContentInstances.id)).limit(101);
    return { characterId, items: rows.slice(0, 100), nextAfter: rows.length > 100 ? rows[99]!.id : null };
  });
}
export function readCreationMaterialCatalog(db: CreationDatabase, auth: AuthContext, after?: string, ids?: string[]) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const rows = await tx.select({ id: worldContent.id, name: worldContent.name }).from(worldContent).where(and(eq(worldContent.type, "ITEM"),
      ne(worldContent.lifecycle, "ARCHIVED"), auth.role === "GM" ? undefined : worldContentPlayerVisibleIn(auth.campaignId),
      ids ? inArray(worldContent.id, ids) : undefined, after ? gt(worldContent.id, after) : undefined)).orderBy(asc(worldContent.id)).limit(ids ? 129 : 101);
    if (ids) return { items: rows, nextAfter: null };
    return { items: rows.slice(0, 100), nextAfter: rows.length > 100 ? rows[99]!.id : null };
  });
}
/** Root access is rechecked for every page. Recursive UNION covers all ancestors
 * and deduplicates shared ancestors; pagination never means a truncated tree. */
export function readCreationLineage(db: CreationDatabase, auth: AuthContext, objectId: string, after?: string) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId); await requireCreationMember(tx, auth);
    const [root] = await tx.select().from(creationObjects).where(and(eq(creationObjects.campaignId, auth.campaignId), eq(creationObjects.id, objectId))).limit(1);
    if (!root) throw new Error("CREATION_UNAVAILABLE");
    await creationAccessMembers(tx, auth, root.characterId);
    if (auth.role !== "GM") {
      // A transferred descendant can retain ancestors bound to characters the
      // current player cannot access. Check the entire graph before paging:
      // otherwise parent IDs or later pages could disclose private snapshots.
      // Controller replacement updates the owning character row first. Lock
      // every character in stable order so access cannot change between the
      // check and projection within this transaction.
      await tx.execute(sql`with recursive ancestry(id) as (
        select id from creation_objects where campaign_id=${auth.campaignId}::uuid and id=${objectId}::uuid
        union select e.input_object_id from creation_object_edges e inner join ancestry a on e.output_object_id=a.id
        where e.campaign_id=${auth.campaignId}::uuid
      ) select c.id from characters c where c.campaign_id=${auth.campaignId}::uuid and exists (
        select 1 from ancestry a join creation_objects o on o.id=a.id and o.campaign_id=c.campaign_id
        where o.character_id=c.id
      ) order by c.id for share of c`);
      const accessResult: unknown = await tx.execute<{ denied: boolean }>(sql`with recursive ancestry(id) as (
        select id from creation_objects where campaign_id=${auth.campaignId}::uuid and id=${objectId}::uuid
        union select e.input_object_id from creation_object_edges e inner join ancestry a on e.output_object_id=a.id
        where e.campaign_id=${auth.campaignId}::uuid
      ) select exists (
        select 1 from ancestry a join creation_objects o on o.id=a.id and o.campaign_id=${auth.campaignId}::uuid
        join characters c on c.id=o.character_id and c.campaign_id=o.campaign_id
        where c.owner_membership_id is distinct from ${auth.membershipId}::uuid
          and not exists (select 1 from character_controllers cc where cc.character_id=c.id and cc.membership_id=${auth.membershipId}::uuid)
      ) as denied`);
      const accessRows = Array.isArray(accessResult) ? accessResult :
        accessResult && typeof accessResult === "object" && "rows" in accessResult && Array.isArray(accessResult.rows)
          ? accessResult.rows : null;
      if (!accessRows || accessRows.length !== 1 || typeof accessRows[0]?.denied !== "boolean")
        throw new Error("CREATION_DATA_UNAVAILABLE");
      if (accessRows[0].denied) throw new Error("CREATION_ANCESTRY_FORBIDDEN");
    }
    const result = await tx.execute<{ id: string }>(sql`with recursive ancestry(id) as (
      select id from creation_objects where campaign_id=${auth.campaignId}::uuid and id=${objectId}::uuid
      union select e.input_object_id from creation_object_edges e inner join ancestry a on e.output_object_id=a.id
      where e.campaign_id=${auth.campaignId}::uuid
    ) select id from ancestry ${after ? sql`where id>${after}::uuid` : sql``} order by id limit 51`);
    // postgres-js returns rows directly; PGlite's Drizzle adapter wraps them.
    // Reject an unexpected driver shape instead of silently omitting lineage.
    const rowsResult: unknown = result;
    const ids = Array.isArray(rowsResult) ? rowsResult :
      rowsResult && typeof rowsResult === "object" && "rows" in rowsResult && Array.isArray(rowsResult.rows)
        ? rowsResult.rows : null;
    if (!ids || !ids.every((row): row is { id: string } => row && typeof row.id === "string"))
      throw new Error("CREATION_DATA_UNAVAILABLE");
    const page = ids.slice(0, 50).map(r => r.id);
    const rows = page.length ? await tx.select({ object: creationObjects, authorId: creationTemplates.authorMembershipId,
      authorName: memberships.displayName }).from(creationObjects)
      .innerJoin(creationTemplateVersions, eq(creationTemplateVersions.id, creationObjects.versionId))
      .innerJoin(creationTemplates, eq(creationTemplates.id, creationTemplateVersions.templateId))
      .innerJoin(memberships, eq(memberships.id, creationTemplates.authorMembershipId))
      .where(and(eq(creationObjects.campaignId, auth.campaignId), inArray(creationObjects.id, page))).orderBy(asc(creationObjects.id)) : [];
    const edges = page.length ? await tx.select().from(creationObjectEdges).where(and(eq(creationObjectEdges.campaignId, auth.campaignId),
      inArray(creationObjectEdges.outputObjectId, page))) : [];
    return { rootId: objectId, items: rows.map(({ object, authorId, authorName }) => {
      const snapshot = creationObjectSnapshotSchema.safeParse(object.snapshot);
      if (!snapshot.success || creationHash(object.snapshot) !== object.snapshotHash) throw new Error("CREATION_DATA_UNAVAILABLE");
      return { id: object.id, versionId: object.versionId, kind: object.kind, level: object.level, stage: object.stage,
        status: object.status, snapshot: snapshot.data, createdAt: object.createdAt, author: { membershipId: authorId, displayName: authorName },
        parentObjectIds: edges.filter(e => e.outputObjectId === object.id).map(e => e.inputObjectId) };
    }), nextAfter: ids.length > 50 ? page[49]! : null };
  });
}
