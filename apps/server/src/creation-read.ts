import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { creationActions, creationReviews, creationRulePacks, creationRuleVersions,
  creationTemplates, creationTemplateVersions } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { requireCreationMember, type CreationDatabase } from "./creation-state.js";
import { creationOrigins } from "./creation-library-read.js";

export function readCreationRules(db: CreationDatabase, auth: AuthContext) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const packs = await tx.select().from(creationRulePacks).where(and(eq(creationRulePacks.campaignId, auth.campaignId),
      auth.role === "GM" ? undefined : eq(creationRulePacks.enabled, true))).orderBy(asc(creationRulePacks.id));
    if (!packs.length) return { items: [] };
    const active = await tx.selectDistinctOn([creationRuleVersions.packId]).from(creationRuleVersions).where(and(
      eq(creationRuleVersions.campaignId, auth.campaignId), inArray(creationRuleVersions.packId, packs.map(p => p.id)),
      eq(creationRuleVersions.published, true))).orderBy(creationRuleVersions.packId, desc(creationRuleVersions.number));
    const latest = auth.role === "GM" ? await tx.selectDistinctOn([creationRuleVersions.packId]).from(creationRuleVersions).where(and(
      eq(creationRuleVersions.campaignId, auth.campaignId), inArray(creationRuleVersions.packId, packs.map(p => p.id))))
      .orderBy(creationRuleVersions.packId, desc(creationRuleVersions.number)) : [];
    const activeByPack = new Map(active.map(v => [v.packId, v]));
    const latestByPack = new Map(latest.map(v => [v.packId, v]));
    return { items: packs.filter(p => auth.role === "GM" || activeByPack.has(p.id)).map(pack => ({
      id: pack.id, kind: pack.kind, name: pack.name, revision: pack.revision, enabled: pack.enabled,
      activeVersion: activeByPack.get(pack.id) ?? null,
      ...(auth.role === "GM" ? { latestVersion: latestByPack.get(pack.id) ?? null } : {}),
    })) };
  });
}
export function readCreationRuleHistory(db: CreationDatabase, auth: AuthContext, packId: string, before?: number) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const [pack] = await tx.select().from(creationRulePacks).where(and(
      eq(creationRulePacks.campaignId, auth.campaignId), eq(creationRulePacks.id, packId))).limit(1);
    if (!pack || (auth.role !== "GM" && !pack.enabled)) throw new Error("CREATION_UNAVAILABLE");
    const rows = await tx.select().from(creationRuleVersions).where(and(
      eq(creationRuleVersions.campaignId, auth.campaignId), eq(creationRuleVersions.packId, pack.id),
      auth.role === "GM" ? undefined : eq(creationRuleVersions.published, true),
      before === undefined ? undefined : lt(creationRuleVersions.number, before)))
      .orderBy(desc(creationRuleVersions.number)).limit(21);
    return { items: rows.slice(0, 20), nextBefore: rows.length > 20 ? rows[19]!.number : null };
  });
}
export function readCreationLibrary(db: CreationDatabase, auth: AuthContext, after?: string) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const rows = await tx.select().from(creationTemplates).where(and(eq(creationTemplates.campaignId, auth.campaignId),
      auth.role === "GM" ? undefined : eq(creationTemplates.authorMembershipId, auth.membershipId),
      after ? gt(creationTemplates.id, after) : undefined)).orderBy(asc(creationTemplates.id)).limit(21);
    const page = rows.slice(0, 20);
    if (!page.length) return { items: [], nextAfter: null };
    const versions = await tx.selectDistinctOn([creationTemplateVersions.templateId]).from(creationTemplateVersions).where(and(
      eq(creationTemplateVersions.campaignId, auth.campaignId), inArray(creationTemplateVersions.templateId, page.map(p => p.id))))
      .orderBy(creationTemplateVersions.templateId, desc(creationTemplateVersions.number));
    const reviews = versions.length ? await tx.selectDistinctOn([creationReviews.versionId]).from(creationReviews).where(and(
      eq(creationReviews.campaignId, auth.campaignId), inArray(creationReviews.versionId, versions.map(v => v.id))))
      .orderBy(creationReviews.versionId, desc(creationReviews.revision)) : [];
    const versionByTemplate = new Map(versions.map(v => [v.templateId, v]));
    const reviewByVersion = new Map(reviews.map(r => [r.versionId, r]));
    const origins = await creationOrigins(tx, auth.campaignId, page.map(t => t.id));
    return { items: page.map(template => {
      const version = versionByTemplate.get(template.id);
      if (!version) throw new Error("CREATION_DATA_UNAVAILABLE");
      return { ...template, latestVersion: version, review: reviewByVersion.get(version.id) ?? null,
        origin: origins.find(o => o.templateId === template.id) ?? null };
    }), nextAfter: rows.length > 20 ? page[19]!.id : null };
  });
}
export function readCreationHistory(db: CreationDatabase, auth: AuthContext, templateId: string, before?: number) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const [template] = await tx.select().from(creationTemplates).where(and(eq(creationTemplates.campaignId, auth.campaignId),
      eq(creationTemplates.id, templateId), auth.role === "GM" ? undefined : eq(creationTemplates.authorMembershipId, auth.membershipId))).limit(1);
    if (!template) throw new Error("CREATION_UNAVAILABLE");
    const rows = await tx.select().from(creationTemplateVersions).where(and(eq(creationTemplateVersions.campaignId, auth.campaignId),
      eq(creationTemplateVersions.templateId, templateId), before === undefined ? undefined : lt(creationTemplateVersions.number, before)))
      .orderBy(desc(creationTemplateVersions.number)).limit(21);
    const page = rows.slice(0, 20);
    const reviews = page.length ? await tx.selectDistinctOn([creationReviews.versionId]).from(creationReviews).where(and(
      eq(creationReviews.campaignId, auth.campaignId), inArray(creationReviews.versionId, page.map(v => v.id))))
      .orderBy(creationReviews.versionId, desc(creationReviews.revision)) : [];
    const reviewByVersion = new Map(reviews.map(r => [r.versionId, r]));
    return { template, items: page.map(version => ({ ...version, review: reviewByVersion.get(version.id) ?? null })),
      nextBefore: rows.length > 20 ? page[19]!.number : null };
  });
}
export function readCreationReviews(db: CreationDatabase, auth: AuthContext, versionId: string, before?: number) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const [version] = await tx.select({ id: creationTemplateVersions.id }).from(creationTemplateVersions)
      .innerJoin(creationTemplates, and(eq(creationTemplates.id, creationTemplateVersions.templateId),
        eq(creationTemplates.campaignId, creationTemplateVersions.campaignId)))
      .where(and(eq(creationTemplateVersions.campaignId, auth.campaignId), eq(creationTemplateVersions.id, versionId),
        auth.role === "GM" ? undefined : eq(creationTemplates.authorMembershipId, auth.membershipId))).limit(1);
    if (!version) throw new Error("CREATION_UNAVAILABLE");
    const rows = await tx.select().from(creationReviews).where(and(eq(creationReviews.campaignId, auth.campaignId),
      eq(creationReviews.versionId, versionId), before === undefined ? undefined : lt(creationReviews.revision, before)))
      .orderBy(desc(creationReviews.revision)).limit(21);
    return { items: rows.slice(0, 20), nextBefore: rows.length > 20 ? rows[19]!.revision : null };
  });
}
export function readCreationAction(db: CreationDatabase, auth: AuthContext, actionId: string) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const [action] = await tx.select({ type: creationActions.type, receipt: creationActions.receipt, createdAt: creationActions.createdAt })
      .from(creationActions).where(and(eq(creationActions.campaignId, auth.campaignId),
        eq(creationActions.actorMembershipId, auth.membershipId), eq(creationActions.actionId, actionId))).limit(1);
    if (!action) throw new Error("CREATION_UNAVAILABLE");
    return { actionId, ...action };
  });
}
