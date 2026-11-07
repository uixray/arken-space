import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { creationReviews, creationRulePacks, creationRuleVersions, creationTemplates,
  creationTemplateVersions, creationTemplateOrigins, creationLicences, worldContent } from "@arken/db";
import { creationDesignSchema, creationRuleSourceSchema, entryDataSchema, evaluateCreation,
  type evaluateCreationSchema, type reviewCreationSchema, type saveCreationRulesSchema,
  type saveCreationTemplateSchema, type forkCreationTemplateSchema, type setCreationRulesEnabledSchema,
  type CreationDesign, type CreationEvaluation, type CreationRuleSource } from "@arken/contracts";
import type { z } from "zod";
import type { AuthContext } from "./auth.js";
import { creationAction, creationHash, requireCreationMember,
  type CreationDatabase, type CreationTransaction } from "./creation-state.js";

const same = (campaignId: string, id: string, table: typeof creationRulePacks | typeof creationTemplates) =>
  and(eq(table.campaignId, campaignId), eq(table.id, id));
function sourceFrom(value: unknown) {
  const parsed = creationRuleSourceSchema.safeParse(value);
  if (!parsed.success) throw new Error("CREATION_DATA_UNAVAILABLE");
  return parsed.data;
}
function designFrom(value: unknown) {
  const parsed = creationDesignSchema.safeParse(value);
  if (!parsed.success) throw new Error("CREATION_DATA_UNAVAILABLE");
  return parsed.data;
}
export function checkedCreationEvaluation(source: CreationRuleSource, design: CreationDesign): CreationEvaluation {
  const evaluated = evaluateCreation(source, design);
  if (evaluated.valid && !entryDataSchema.safeParse(evaluated.entryData).success) {
    evaluated.valid = false; evaluated.entryData = null; evaluated.totals = null;
    evaluated.errors.push({ code: "RUNTIME_UNSUPPORTED", message: "Результат не соответствует действующему игровому контракту." });
  }
  return evaluated;
}
export async function loadCreationRules(tx: CreationTransaction, auth: AuthContext, versionId: string,
  mode: "NEW_TEMPLATE" | "GM_PREVIEW" | "REVIEW") {
  const [row] = await tx.select({ version: creationRuleVersions, pack: creationRulePacks }).from(creationRuleVersions)
    .innerJoin(creationRulePacks, and(eq(creationRulePacks.id, creationRuleVersions.packId),
      eq(creationRulePacks.campaignId, creationRuleVersions.campaignId)))
    .where(and(eq(creationRuleVersions.campaignId, auth.campaignId), eq(creationRuleVersions.id, versionId))).limit(1);
  if (!row) throw new Error("CREATION_UNAVAILABLE");
  if (mode !== "GM_PREVIEW" || auth.role !== "GM") {
    if (!row.version.published || !row.pack.enabled) throw new Error("CREATION_RULES_DISABLED");
    if (mode === "NEW_TEMPLATE") {
      const [current] = await tx.select({ id: creationRuleVersions.id }).from(creationRuleVersions)
        .where(and(eq(creationRuleVersions.campaignId, auth.campaignId), eq(creationRuleVersions.packId, row.pack.id),
          eq(creationRuleVersions.published, true))).orderBy(desc(creationRuleVersions.number)).limit(1);
      if (current?.id !== row.version.id) throw new Error("CREATION_RULES_STALE");
    }
  }
  const source = sourceFrom(row.version.source);
  if (source.kind !== row.pack.kind || creationHash(source) !== row.version.sourceHash)
    throw new Error("CREATION_DATA_UNAVAILABLE");
  return { ...row, source };
}
async function validateBackingItems(tx: CreationTransaction, source: CreationRuleSource) {
  const ids = [...new Set(source.components.flatMap(c => [
    ...(c.artifact ? [c.artifact.baseItemId] : []), ...c.materials.map(m => m.worldContentId),
  ]))];
  if (!ids.length) return;
  const rows = await tx.select({ id: worldContent.id, type: worldContent.type, lifecycle: worldContent.lifecycle })
    .from(worldContent).where(inArray(worldContent.id, ids)).orderBy(asc(worldContent.id)).for("share");
  if (rows.length !== ids.length || rows.some(r => r.type !== "ITEM" || r.lifecycle === "ARCHIVED"))
    throw new Error("CREATION_ITEM_UNAVAILABLE");
}
export function saveCreationRules(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof saveCreationRulesSchema>) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return creationAction(db, auth, body.actionId, "creation.rules.version", body, async tx => {
    const [pack] = await tx.select().from(creationRulePacks).where(same(auth.campaignId, body.packId, creationRulePacks)).limit(1).for("update");
    if ((pack?.revision ?? null) !== body.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (pack && pack.kind !== body.source.kind) throw new Error("CREATION_KIND_CONFLICT");
    if (!pack) {
      const existing = await tx.select({ id: creationRulePacks.id }).from(creationRulePacks)
        .where(eq(creationRulePacks.campaignId, auth.campaignId)).limit(64);
      if (existing.length >= 64) throw new Error("CREATION_CATALOG_LIMIT");
    }
    if (body.publish) {
      if (body.source.components.some(c => c.contribution === null)) throw new Error("CREATION_UNPRICED_RULES");
      await validateBackingItems(tx, body.source);
    }
    const [latest] = await tx.select({ number: creationRuleVersions.number }).from(creationRuleVersions)
      .where(and(eq(creationRuleVersions.campaignId, auth.campaignId), eq(creationRuleVersions.packId, body.packId)))
      .orderBy(desc(creationRuleVersions.number)).limit(1);
    if ((latest?.number ?? 0) >= 1000) throw new Error("CREATION_VERSION_LIMIT");
    const revision = (pack?.revision ?? -1) + 1, number = (latest?.number ?? 0) + 1, versionId = randomUUID();
    // A saved GM draft must not replace the player-visible published pack label.
    if (pack) await tx.update(creationRulePacks).set({ name: body.publish ? body.source.name : pack.name, revision,
      enabled: body.publish ? true : pack.enabled }).where(same(auth.campaignId, pack.id, creationRulePacks));
    else await tx.insert(creationRulePacks).values({ id: body.packId, campaignId: auth.campaignId,
      kind: body.source.kind, name: body.source.name, enabled: body.publish, revision, createdByMembershipId: auth.membershipId });
    await tx.insert(creationRuleVersions).values({ id: versionId, campaignId: auth.campaignId, packId: body.packId,
      number, published: body.publish, source: body.source, sourceHash: creationHash(body.source), createdByMembershipId: auth.membershipId });
    return { packId: body.packId, versionId, number, revision, published: body.publish };
  });
}
export function setCreationRulesEnabled(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof setCreationRulesEnabledSchema>) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return creationAction(db, auth, body.actionId, "creation.rules.enabled", body, async tx => {
    const [pack] = await tx.select().from(creationRulePacks).where(same(auth.campaignId, body.packId, creationRulePacks)).limit(1).for("update");
    if (!pack) throw new Error("CREATION_UNAVAILABLE");
    if (pack.revision !== body.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (body.enabled) {
      const [published] = await tx.select({ id: creationRuleVersions.id }).from(creationRuleVersions).where(and(
        eq(creationRuleVersions.campaignId, auth.campaignId), eq(creationRuleVersions.packId, pack.id), eq(creationRuleVersions.published, true))).limit(1);
      if (!published) throw new Error("CREATION_RULES_DISABLED");
    }
    await tx.update(creationRulePacks).set({ enabled: body.enabled, revision: pack.revision + 1 }).where(same(auth.campaignId, pack.id, creationRulePacks));
    return { packId: pack.id, revision: pack.revision + 1, enabled: body.enabled, reason: body.reason };
  });
}
export function previewCreation(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof evaluateCreationSchema>) {
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const rule = await loadCreationRules(tx, auth, body.ruleVersionId, auth.role === "GM" ? "GM_PREVIEW" : "NEW_TEMPLATE");
    return { ruleVersionId: rule.version.id, ruleSourceHash: rule.version.sourceHash,
      evaluation: checkedCreationEvaluation(rule.source, body.design) };
  });
}
export function saveCreationTemplate(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof saveCreationTemplateSchema>) {
  return creationAction(db, auth, body.actionId, "creation.template.version", body,
    tx => persistCreationTemplate(tx, auth, body));
}
async function persistCreationTemplate(tx: CreationTransaction, auth: AuthContext,
  body: z.infer<typeof saveCreationTemplateSchema>, sourceVersionId?: string) {
    const [template] = await tx.select().from(creationTemplates).where(same(auth.campaignId, body.templateId, creationTemplates)).limit(1).for("update");
    if (template && template.authorMembershipId !== auth.membershipId) throw new Error("CREATION_FORBIDDEN");
    if ((template?.revision ?? null) !== body.expectedRevision) throw new Error("CREATION_CONFLICT");
    const [previous] = await tx.select().from(creationTemplateVersions).where(and(
      eq(creationTemplateVersions.campaignId, auth.campaignId), eq(creationTemplateVersions.templateId, body.templateId)))
      .orderBy(desc(creationTemplateVersions.number)).limit(1);
    if ((previous?.id ?? null) !== body.previousVersionId) throw new Error("CREATION_CONFLICT");
    if ((previous?.number ?? 0) >= 1000) throw new Error("CREATION_VERSION_LIMIT");
    const rule = await loadCreationRules(tx, auth, body.ruleVersionId, "NEW_TEMPLATE");
    if (template && template.kind !== rule.source.kind) throw new Error("CREATION_KIND_CONFLICT");
    if (!template) {
      const existing = await tx.select({ id: creationTemplates.id }).from(creationTemplates).where(and(
        eq(creationTemplates.campaignId, auth.campaignId), eq(creationTemplates.authorMembershipId, auth.membershipId))).limit(500);
      if (existing.length >= 500) throw new Error("CREATION_CATALOG_LIMIT");
    }
    const evaluation = checkedCreationEvaluation(rule.source, body.design);
    const versionHash = creationHash({ ruleVersionId: rule.version.id, ruleSourceHash: rule.version.sourceHash, design: body.design, evaluation });
    const versionId = randomUUID(), revision = (template?.revision ?? -1) + 1, number = (previous?.number ?? 0) + 1;
    if (template) await tx.update(creationTemplates).set({ revision }).where(same(auth.campaignId, template.id, creationTemplates));
    else await tx.insert(creationTemplates).values({ id: body.templateId, campaignId: auth.campaignId,
      authorMembershipId: auth.membershipId, kind: rule.source.kind, revision });
    await tx.insert(creationTemplateVersions).values({ id: versionId, campaignId: auth.campaignId, templateId: body.templateId,
      number, previousVersionId: body.previousVersionId, ruleVersionId: rule.version.id, design: body.design,
      evaluation, versionHash, createdByMembershipId: auth.membershipId });
    if (sourceVersionId) {
      if (template) throw new Error("CREATION_CONFLICT");
      await tx.insert(creationTemplateOrigins).values({ campaignId: auth.campaignId, templateId: body.templateId, sourceVersionId });
    }
    // Even a valid new version starts without approval; no approval inheritance.
    return { templateId: body.templateId, versionId, number, revision, versionHash, evaluation, approval: null };
}
export function forkCreationTemplate(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof forkCreationTemplateSchema>) {
  return creationAction(db, auth, body.actionId, "creation.template.fork", body, async tx => {
    const [row] = await tx.select({ version: creationTemplateVersions, template: creationTemplates, rule: creationRuleVersions })
      .from(creationTemplateVersions).innerJoin(creationTemplates, eq(creationTemplates.id, creationTemplateVersions.templateId))
      .innerJoin(creationRuleVersions, eq(creationRuleVersions.id, creationTemplateVersions.ruleVersionId))
      .where(and(eq(creationTemplateVersions.campaignId, auth.campaignId), eq(creationTemplateVersions.id, body.sourceVersionId))).limit(1);
    if (!row) throw new Error("CREATION_UNAVAILABLE");
    // Read/use as a controller is not a personal derivative-authoring licence.
    if (auth.role !== "GM" && row.template.authorMembershipId !== auth.membershipId) {
      const [licence] = await tx.select({ id: creationLicences.id }).from(creationLicences).where(and(
        eq(creationLicences.campaignId, auth.campaignId), eq(creationLicences.ownerMembershipId, auth.membershipId),
        eq(creationLicences.versionId, body.sourceVersionId))).limit(1);
      if (!licence) throw new Error("CREATION_FORBIDDEN");
    }
    if (creationHash(row.rule.source) !== row.rule.sourceHash || creationHash({ ruleVersionId: row.rule.id,
      ruleSourceHash: row.rule.sourceHash, design: row.version.design, evaluation: row.version.evaluation }) !== row.version.versionHash)
      throw new Error("CREATION_DATA_UNAVAILABLE");
    const rules = await loadCreationRules(tx, auth, body.ruleVersionId, "NEW_TEMPLATE");
    if (rules.source.kind !== row.template.kind) throw new Error("CREATION_KIND_CONFLICT");
    const result = await persistCreationTemplate(tx, auth, { actionId: body.actionId, templateId: body.templateId,
      expectedRevision: null, previousVersionId: null, ruleVersionId: body.ruleVersionId,
      design: { ...designFrom(row.version.design), name: body.name } }, body.sourceVersionId);
    return { ...result, sourceVersionId: body.sourceVersionId, sourceAuthorMembershipId: row.template.authorMembershipId };
  });
}
export function reviewCreation(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof reviewCreationSchema>) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return creationAction(db, auth, body.actionId, "creation.template.review", body, async tx => {
    const [version] = await tx.select().from(creationTemplateVersions).where(and(
      eq(creationTemplateVersions.campaignId, auth.campaignId), eq(creationTemplateVersions.id, body.versionId))).limit(1);
    if (!version) throw new Error("CREATION_UNAVAILABLE");
    const [previous] = await tx.select().from(creationReviews).where(and(
      eq(creationReviews.campaignId, auth.campaignId), eq(creationReviews.versionId, version.id)))
      .orderBy(desc(creationReviews.revision)).limit(1);
    if ((previous?.revision ?? null) !== body.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (body.decision === "APPROVED") {
      const rule = await loadCreationRules(tx, auth, version.ruleVersionId, "REVIEW");
      const design = designFrom(version.design), evaluation = checkedCreationEvaluation(rule.source, design);
      if (!evaluation.valid) throw new Error("CREATION_INVALID_DESIGN");
      if (creationHash({ ruleVersionId: rule.version.id, ruleSourceHash: rule.version.sourceHash, design, evaluation }) !== version.versionHash)
        throw new Error("CREATION_EVALUATOR_CHANGED");
      await validateBackingItems(tx, rule.source);
    }
    const reviewId = randomUUID(), revision = (previous?.revision ?? -1) + 1;
    await tx.insert(creationReviews).values({ id: reviewId, campaignId: auth.campaignId, versionId: version.id,
      revision, decision: body.decision, reason: body.reason, decidedByMembershipId: auth.membershipId });
    return { reviewId, versionId: version.id, versionHash: version.versionHash, revision, decision: body.decision, reason: body.reason };
  });
}
