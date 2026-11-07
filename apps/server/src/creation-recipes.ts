import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import type { z } from "zod";
import { creationRecipeGraphHasCycle, creationRecipeSourceSchema,
  type CreationRecipeSource, type saveCreationRecipeSchema, type setCreationRecipeEnabledSchema } from "@arken/contracts";
import { creationObjects, creationRecipes, creationRecipeVersions, creationTemplates, creationTemplateVersions, worldContent } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { creationAction, creationHash, requireCreationMember, type CreationDatabase, type CreationTransaction } from "./creation-state.js";
import { loadApprovedCreationVersion } from "./creation-runtime-state.js";
import { creationAccessMembers, licensedCreationVersions } from "./creation-access.js";
import { lockInventoryGraph } from "./inventory-assignment.js";

const scope = (campaignId: string, id: string) => and(eq(creationRecipes.campaignId, campaignId), eq(creationRecipes.id, id));
const versionIds = (source: CreationRecipeSource) => [...new Set([
  ...source.inputs.map(i => i.versionId), ...(source.output ? [source.output.versionId] : []),
])].sort();
export function parsedCreationRecipe(source: unknown, sourceHash: string) {
  const parsed = creationRecipeSourceSchema.safeParse(source);
  if (!parsed.success || creationHash(parsed.data) !== sourceHash) throw new Error("CREATION_DATA_UNAVAILABLE");
  return parsed.data;
}
/** Shared by publishing and future quote/commit. Graph lock is already held;
 * canonical resources are locked in UUID order before character/instance rows. */
export async function validateCreationRecipe(tx: CreationTransaction, auth: AuthContext, source: CreationRecipeSource,
  additionalItemIds: readonly string[] = [], lockItems = true) {
  const loaded = new Map<string, Awaited<ReturnType<typeof loadApprovedCreationVersion>>>();
  for (const versionId of versionIds(source)) {
    const value = await loadApprovedCreationVersion(tx, auth, versionId,
      source.output?.versionId === versionId ? "ISSUE" : "FROZEN_INPUT");
    if (value.template.kind !== source.kind) throw new Error("CREATION_RECIPE_KIND");
    loaded.set(versionId, value);
  }
  const output = source.output ? loaded.get(source.output.versionId)! : null;
  const required = new Map<string, number>();
  for (const m of output?.evaluation.card.materials ?? []) required.set(m.worldContentId, m.quantity);
  const baseId = output?.evaluation.card.artifact?.baseItemId;
  // Base and ingredients are physical requirements. Fully consumed inputs may
  // carry them forward once, rather than charging the entire recipe again at
  // every upgrade. This is NOT a material refund or a second inventory balance.
  if (baseId) required.set(baseId, (required.get(baseId) ?? 0) + 1);
  for (const point of source.inputs) {
    const card = loaded.get(point.versionId)!.evaluation.card;
    const carried = [...card.materials, ...(card.artifact ? [{ worldContentId: card.artifact.baseItemId, quantity: 1 }] : [])];
    for (const m of carried) if (required.has(m.worldContentId))
      required.set(m.worldContentId, Math.max(0, required.get(m.worldContentId)! - m.quantity));
  }
  for (const [id, count] of required) if (!count) required.delete(id);
  const actual = new Map(source.cost.materials.map(m => [m.worldContentId, m.quantity]));
  if ([...required].some(([id, count]) => (actual.get(id) ?? 0) < count)) throw new Error("CREATION_RECIPE_MATERIALS");
  const requiredCraftSp = Math.max(0, (output?.evaluation.totals?.craftSp ?? 0) - source.inputs.reduce(
    (sum, point) => sum + loaded.get(point.versionId)!.evaluation.totals!.craftSp, 0));
  if (source.cost.sp < requiredCraftSp) throw new Error("CREATION_RECIPE_SP");
  const itemIds = [...new Set([...source.cost.materials.map(m => m.worldContentId),
    ...(baseId ? [baseId] : []), ...additionalItemIds])].sort();
  let itemVersions: Array<{ id: string; revision: number }> = [];
  if (itemIds.length) {
    const query = tx.select({ id: worldContent.id, type: worldContent.type, lifecycle: worldContent.lifecycle, revision: worldContent.revision })
      .from(worldContent).where(inArray(worldContent.id, itemIds)).orderBy(asc(worldContent.id));
    const items = lockItems ? await query.for("share") : await query;
    if (items.length !== itemIds.length || items.some(i => i.type !== "ITEM" || i.lifecycle === "ARCHIVED"))
      throw new Error("CREATION_ITEM_UNAVAILABLE");
    itemVersions = items.map(i => ({ id: i.id, revision: i.revision }));
  }
  return { loaded, output, itemVersions, requiredCraftSp,
    requiredMaterials: [...required].map(([worldContentId, quantity]) => ({ worldContentId, quantity })) };
}
async function currentPublishedRecipes(tx: CreationTransaction, campaignId: string, enabledOnly: boolean) {
  const rows = await tx.selectDistinctOn([creationRecipeVersions.recipeId], { recipe: creationRecipes, version: creationRecipeVersions })
    .from(creationRecipeVersions).innerJoin(creationRecipes, and(eq(creationRecipes.id, creationRecipeVersions.recipeId),
      eq(creationRecipes.campaignId, creationRecipeVersions.campaignId)))
    .where(and(eq(creationRecipes.campaignId, campaignId), eq(creationRecipeVersions.published, true),
      enabledOnly ? eq(creationRecipes.enabled, true) : undefined))
    .orderBy(asc(creationRecipeVersions.recipeId), desc(creationRecipeVersions.number)).limit(257);
  if (rows.length > 256) throw new Error("CREATION_CATALOG_LIMIT");
  return rows;
}
async function requireAcyclicRecipes(tx: CreationTransaction, campaignId: string, replacingId: string,
  replacement: CreationRecipeSource) {
  const rows = await currentPublishedRecipes(tx, campaignId, true);
  const sources = rows.filter(r => r.recipe.id !== replacingId).map(r => parsedCreationRecipe(r.version.source, r.version.sourceHash));
  if (creationRecipeGraphHasCycle([...sources, replacement])) throw new Error("CREATION_RECIPE_CYCLE");
}
export async function loadCurrentCreationRecipe(tx: CreationTransaction, auth: AuthContext, versionId: string) {
  const [row] = await tx.select({ recipe: creationRecipes, version: creationRecipeVersions }).from(creationRecipeVersions)
    .innerJoin(creationRecipes, and(eq(creationRecipes.id, creationRecipeVersions.recipeId),
      eq(creationRecipes.campaignId, creationRecipeVersions.campaignId)))
    .where(and(eq(creationRecipeVersions.campaignId, auth.campaignId), eq(creationRecipeVersions.id, versionId))).limit(1);
  if (!row || !row.recipe.enabled || !row.version.published) throw new Error("CREATION_RECIPE_DISABLED");
  const [latest] = await tx.select({ id: creationRecipeVersions.id }).from(creationRecipeVersions).where(and(
    eq(creationRecipeVersions.campaignId, auth.campaignId), eq(creationRecipeVersions.recipeId, row.recipe.id),
    eq(creationRecipeVersions.published, true))).orderBy(desc(creationRecipeVersions.number)).limit(1);
  if (latest?.id !== versionId) throw new Error("CREATION_RECIPE_STALE");
  return { ...row, source: parsedCreationRecipe(row.version.source, row.version.sourceHash) };
}
export function saveCreationRecipe(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof saveCreationRecipeSchema>) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return creationAction(db, auth, body.actionId, "creation.recipe.version", body, async tx => {
    const [recipe] = await tx.select().from(creationRecipes).where(scope(auth.campaignId, body.recipeId)).limit(1).for("update");
    if ((recipe?.revision ?? null) !== body.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (!recipe) {
      const rows = await tx.select({ id: creationRecipes.id }).from(creationRecipes)
        .where(eq(creationRecipes.campaignId, auth.campaignId)).limit(256);
      if (rows.length >= 256) throw new Error("CREATION_CATALOG_LIMIT");
    }
    if (body.publish) {
      await validateCreationRecipe(tx, auth, body.source);
      await requireAcyclicRecipes(tx, auth.campaignId, body.recipeId, body.source);
    }
    const [latest] = await tx.select({ number: creationRecipeVersions.number }).from(creationRecipeVersions)
      .where(and(eq(creationRecipeVersions.campaignId, auth.campaignId), eq(creationRecipeVersions.recipeId, body.recipeId)))
      .orderBy(desc(creationRecipeVersions.number)).limit(1);
    if ((latest?.number ?? 0) >= 1000) throw new Error("CREATION_VERSION_LIMIT");
    const revision = (recipe?.revision ?? -1) + 1, number = (latest?.number ?? 0) + 1, versionId = randomUUID();
    if (recipe) await tx.update(creationRecipes).set({ revision, name: body.publish ? body.source.name : recipe.name,
      enabled: body.publish ? true : recipe.enabled }).where(scope(auth.campaignId, body.recipeId));
    else await tx.insert(creationRecipes).values({ id: body.recipeId, campaignId: auth.campaignId,
      name: body.source.name, enabled: body.publish, revision, createdByMembershipId: auth.membershipId });
    await tx.insert(creationRecipeVersions).values({ id: versionId, campaignId: auth.campaignId, recipeId: body.recipeId,
      number, published: body.publish, source: body.source, sourceHash: creationHash(body.source), createdByMembershipId: auth.membershipId });
    return { recipeId: body.recipeId, versionId, number, revision, published: body.publish };
  });
}
export function setCreationRecipeEnabled(db: CreationDatabase, auth: AuthContext, body: z.infer<typeof setCreationRecipeEnabledSchema>) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return creationAction(db, auth, body.actionId, "creation.recipe.enabled", body, async tx => {
    const [recipe] = await tx.select().from(creationRecipes).where(scope(auth.campaignId, body.recipeId)).limit(1).for("update");
    if (!recipe) throw new Error("CREATION_UNAVAILABLE");
    if (recipe.revision !== body.expectedRevision) throw new Error("CREATION_CONFLICT");
    if (body.enabled) {
      const [version] = await tx.select().from(creationRecipeVersions).where(and(eq(creationRecipeVersions.campaignId, auth.campaignId),
        eq(creationRecipeVersions.recipeId, recipe.id), eq(creationRecipeVersions.published, true)))
        .orderBy(desc(creationRecipeVersions.number)).limit(1);
      if (!version) throw new Error("CREATION_RECIPE_DISABLED");
      const source = parsedCreationRecipe(version.source, version.sourceHash);
      await validateCreationRecipe(tx, auth, source);
      await requireAcyclicRecipes(tx, auth.campaignId, recipe.id, source);
    }
    await tx.update(creationRecipes).set({ enabled: body.enabled, revision: recipe.revision + 1 }).where(scope(auth.campaignId, recipe.id));
    return { recipeId: recipe.id, revision: recipe.revision + 1, enabled: body.enabled, reason: body.reason };
  });
}
/** Licences allow new fabrication. Possession of required runtime inputs allows
 * GM-published development/consumption, never unlimited new copies or authorship. */
export function readCreationRecipes(db: CreationDatabase, auth: AuthContext, characterId?: string) {
  return db.transaction(async tx => {
    await lockInventoryGraph(tx, auth.campaignId);
    await requireCreationMember(tx, auth);
    const accessMembers = await creationAccessMembers(tx, auth, characterId);
    const rows = await currentPublishedRecipes(tx, auth.campaignId, auth.role !== "GM");
    const parsed = rows.map(row => ({ ...row, source: parsedCreationRecipe(row.version.source, row.version.sourceHash) }));
    if (auth.role === "GM") {
      const latest = await tx.selectDistinctOn([creationRecipeVersions.recipeId], { recipe: creationRecipes, version: creationRecipeVersions })
        .from(creationRecipeVersions).innerJoin(creationRecipes, and(eq(creationRecipes.id, creationRecipeVersions.recipeId),
          eq(creationRecipes.campaignId, creationRecipeVersions.campaignId)))
        .where(eq(creationRecipes.campaignId, auth.campaignId))
        .orderBy(asc(creationRecipeVersions.recipeId), desc(creationRecipeVersions.number)).limit(257);
      if (latest.length > 256) throw new Error("CREATION_CATALOG_LIMIT");
      return { recipes: parsed, scope: "GM", draftsIncluded: true,
        drafts: latest.filter(r => !r.version.published).map(r => ({ ...r, source: parsedCreationRecipe(r.version.source, r.version.sourceHash) })) };
    }
    const ids = [...new Set(parsed.flatMap(r => versionIds(r.source)))];
    const owned = ids.length ? await tx.select({ id: creationTemplateVersions.id }).from(creationTemplateVersions)
      .innerJoin(creationTemplates, and(eq(creationTemplates.id, creationTemplateVersions.templateId),
        eq(creationTemplates.campaignId, creationTemplateVersions.campaignId)))
      .where(and(eq(creationTemplates.campaignId, auth.campaignId), inArray(creationTemplates.authorMembershipId, accessMembers),
        inArray(creationTemplateVersions.id, ids))) : [];
    const licensed = await licensedCreationVersions(tx, auth.campaignId, accessMembers, ids);
    const visible = new Set([...owned.map(v => v.id), ...licensed]);
    const objects = characterId ? await tx.select({ id: creationObjects.versionId }).from(creationObjects).where(and(
      eq(creationObjects.campaignId, auth.campaignId), eq(creationObjects.characterId, characterId), eq(creationObjects.status, "ACTIVE"))) : [];
    const inputVisible = new Set([...visible, ...objects.map(o => o.id)]);
    return { recipes: parsed.filter(r => r.source.inputs.every(p => inputVisible.has(p.versionId)) &&
      (!r.source.output || visible.has(r.source.output.versionId) || (characterId !== undefined && r.source.inputs.length > 0))),
      scope: "AUTHOR_LICENSED_OR_HELD", draftsIncluded: false };
  });
}
export function readCreationRecipeHistory(db: CreationDatabase, auth: AuthContext, recipeId: string, before?: number) {
  if (auth.role !== "GM") throw new Error("CREATION_FORBIDDEN");
  return db.transaction(async tx => {
    await requireCreationMember(tx, auth);
    const [recipe] = await tx.select().from(creationRecipes).where(scope(auth.campaignId, recipeId)).limit(1);
    if (!recipe) throw new Error("CREATION_UNAVAILABLE");
    // Bounded source history; draft payloads stay GM-only.
    const page = await tx.select().from(creationRecipeVersions).where(and(eq(creationRecipeVersions.campaignId, auth.campaignId),
      eq(creationRecipeVersions.recipeId, recipe.id), before === undefined ? undefined : lt(creationRecipeVersions.number, before)))
      .orderBy(desc(creationRecipeVersions.number)).limit(21);
    return { recipe, versions: page.slice(0, 20).map(v => ({ ...v, source: parsedCreationRecipe(v.source, v.sourceHash) })),
      nextBefore: page.length > 20 ? page[19]!.number : null };
  });
}
