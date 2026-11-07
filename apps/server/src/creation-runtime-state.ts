import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { creationDesignSchema, creationMetricsSchema, creationPaidBasisSchema, entryDataSchema } from "@arken/contracts";
import { characterCatalogEntries, characters, creationObjects, creationReviews, creationTemplates,
  creationTemplateVersions } from "@arken/db";
import type { AuthContext } from "./auth.js";
import { checkedCreationEvaluation, loadCreationRules } from "./creation-authoring.js";
import { creationHash, requireCreationMember, type CreationDatabase, type CreationTransaction } from "./creation-state.js";
import { lockInventoryGraph } from "./inventory-assignment.js";

type ReadDb = CreationDatabase | CreationTransaction;
export const creationObjectSnapshotSchema = z.object({ versionHash: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(100), description: z.string().max(10000),
  entryKind: z.enum(["SKILL", "ABILITY"]), entryData: entryDataSchema,
  baseItemId: z.string().uuid().nullable(), appearance: z.string().max(2000),
}).strict();
export const storedEvaluationSchema = z.object({ evaluator: z.literal("creation-1"), valid: z.boolean(),
  errors: z.array(z.object({ code: z.string(), message: z.string(), componentId: z.string().optional() }).strict()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
  totals: creationMetricsSchema.nullable(),
  breakdown: z.array(z.object({ componentId: z.string(), name: z.string(), contribution: creationMetricsSchema,
    factorsBasisPoints: creationMetricsSchema, parameters: z.record(z.string(), z.number().int()) }).strict()),
  card: z.object({ name: z.string(), description: z.string(), appearance: z.string(), components: z.array(z.string()),
    requirements: z.array(z.object({ statKey: z.string(), minimum: z.number().finite() }).strict()),
    materials: z.array(z.object({ worldContentId: z.string().uuid(), quantity: z.number().int().positive() }).strict()),
    artifact: z.object({ baseItemId: z.string().uuid(), category: z.string(), rarity: z.string() }).strict().nullable(),
    manualEffects: z.array(z.string()) }).strict(),
  entryData: z.record(z.string(), z.unknown()).nullable(),
}).strict();
export async function boundCreationEntry(db: ReadDb, entryId: string) {
  const [row] = await db.select().from(creationObjects).where(eq(creationObjects.entryId, entryId)).limit(1);
  return row ?? null;
}
export async function boundCreationInstance(db: ReadDb, campaignId: string, instanceId: string) {
  const [row] = await db.select().from(creationObjects).where(and(
    eq(creationObjects.campaignId, campaignId), eq(creationObjects.instanceId, instanceId))).limit(1);
  return row ?? null;
}
/** Call BEFORE character/campaign row locks. Only newly inserted entries may be
 * bound, in the same transaction; a pre-existing ordinary entry is never attached
 * later. Thus the non-bound fast path cannot race an attachment to that entry. */
export async function lockBoundCreationEntry(tx: CreationTransaction, auth: AuthContext, entryId: string) {
  if (!await boundCreationEntry(tx, entryId)) return false;
  await lockInventoryGraph(tx, auth.campaignId);
  await requireCreationMember(tx, auth);
  return true;
}
function mechanics(data: Record<string, unknown>) {
  if (!data.uses || typeof data.uses !== "object" || Array.isArray(data.uses)) return data;
  const { current: _current, lastRechargeDay: _day, lastBattleCounter: _battle, ...rule } =
    data.uses as Record<string, unknown>;
  return { ...data, uses: rule };
}
export function creationEntryKind(data: Record<string, unknown>): "SKILL" | "ABILITY" {
  return typeof data.skillValue === "number" && !(Array.isArray(data.rollActions) && data.rollActions.length) &&
    !data.activation && !data.areaEffect ? "SKILL" : "ABILITY";
}
/** Issued mechanics stay frozen: do not rerun the current evaluator over an old
 * issued version. Only the current explicit GM permit and the immutable binding
 * are read. Caller holds graph -> character -> entry locks for execution. */
export async function assertCreationEntryUsable(tx: CreationTransaction, auth: AuthContext,
  entry: typeof characterCatalogEntries.$inferSelect, character: Pick<typeof characters.$inferSelect, "id" | "campaignId">) {
  const obj = await boundCreationEntry(tx, entry.id);
  if (!obj) return null;
  if (character.campaignId !== auth.campaignId || entry.characterId !== character.id ||
      obj.campaignId !== auth.campaignId || obj.characterId !== character.id || obj.status !== "ACTIVE")
    throw new Error("CREATION_OBJECT_UNAVAILABLE");
  const parsed = creationObjectSnapshotSchema.safeParse(obj.snapshot);
  if (!parsed.success || creationHash(obj.snapshot) !== obj.snapshotHash ||
      !creationPaidBasisSchema.safeParse(obj.paidBasis).success)
    throw new Error("CREATION_DATA_UNAVAILABLE");
  const snapshot = parsed.data;
  if (entry.sourceCatalogEntryId || entry.kind !== snapshot.entryKind || entry.name !== snapshot.name ||
      entry.description !== snapshot.description || creationHash(mechanics(entry.data)) !== creationHash(mechanics(snapshot.entryData)))
    throw new Error("CREATION_DATA_UNAVAILABLE");
  const frozen = await loadApprovedCreationVersion(tx, auth, obj.versionId, "FROZEN_INPUT");
  const card = frozen.evaluation.card, sourceData = frozen.evaluation.entryData!;
  if (frozen.version.versionHash !== snapshot.versionHash || frozen.template.kind !== obj.kind ||
      snapshot.name !== card.name || snapshot.description !== card.description || snapshot.appearance !== card.appearance ||
      snapshot.baseItemId !== (card.artifact?.baseItemId ?? null) || snapshot.entryKind !== creationEntryKind(sourceData) ||
      creationHash(mechanics(sourceData)) !== creationHash(mechanics(snapshot.entryData)))
    throw new Error("CREATION_DATA_UNAVAILABLE");
  return { obj, snapshot, rule: frozen.rules, review: frozen.review };
}
/** For NEW issuance/recipe validation, unlike frozen gameplay, recalculate and
 * compare the approved exact version. An evaluator change needs a new version. */
export async function loadApprovedCreationVersion(tx: CreationTransaction, auth: AuthContext, versionId: string,
  mode: "ISSUE" | "FROZEN_INPUT" = "ISSUE") {
  const [row] = await tx.select({ version: creationTemplateVersions, template: creationTemplates })
    .from(creationTemplateVersions).innerJoin(creationTemplates, and(
      eq(creationTemplates.id, creationTemplateVersions.templateId), eq(creationTemplates.campaignId, creationTemplateVersions.campaignId)))
    .where(and(eq(creationTemplateVersions.campaignId, auth.campaignId), eq(creationTemplateVersions.id, versionId))).limit(1);
  if (!row) throw new Error("CREATION_UNAVAILABLE");
  const rules = await loadCreationRules(tx, auth, row.version.ruleVersionId, "REVIEW");
  const [review] = await tx.select().from(creationReviews).where(and(eq(creationReviews.campaignId, auth.campaignId),
    eq(creationReviews.versionId, versionId))).orderBy(desc(creationReviews.revision)).limit(1);
  if (review?.decision !== "APPROVED") throw new Error("CREATION_APPROVAL_REQUIRED");
  const parsed = creationDesignSchema.safeParse(row.version.design);
  if (!parsed.success || rules.source.kind !== row.template.kind) throw new Error("CREATION_DATA_UNAVAILABLE");
  const stored = storedEvaluationSchema.safeParse(row.version.evaluation);
  if (!stored.success || creationHash({ ruleVersionId: rules.version.id, ruleSourceHash: rules.version.sourceHash,
    design: row.version.design, evaluation: row.version.evaluation }) !== row.version.versionHash)
    throw new Error("CREATION_DATA_UNAVAILABLE");
  // Consuming/rebasing an old issued object must not silently rerun its mechanics
  // through a changed evaluator. The newly issued output is still recalculated.
  const evaluation = mode === "ISSUE" ? checkedCreationEvaluation(rules.source, parsed.data) : stored.data;
  if (!evaluation.valid || !evaluation.entryData || !evaluation.totals) throw new Error("CREATION_INVALID_DESIGN");
  if (!entryDataSchema.safeParse(evaluation.entryData).success) throw new Error("CREATION_DATA_UNAVAILABLE");
  const hash = creationHash({ ruleVersionId: rules.version.id, ruleSourceHash: rules.version.sourceHash,
    design: parsed.data, evaluation });
  if (mode === "ISSUE" && hash !== row.version.versionHash) throw new Error("CREATION_EVALUATOR_CHANGED");
  return { ...row, rules, review, design: parsed.data, evaluation };
}
/** Internal mutation capability; never accepted from client JSON or exposed as
 * arbitrary SQL. DB triggers still restrict immutable version/basis fields. */
export async function mutateCreationObject<T>(tx: CreationTransaction, objectId: string, run: () => Promise<T>) {
  await tx.execute(sql`select set_config('arken.creation_object', ${objectId}, true)`);
  // On an error the transaction is rolled back; issuing another statement in a
  // failed PostgreSQL transaction would mask the original error with 25P02.
  const result = await run();
  await tx.execute(sql`select set_config('arken.creation_object', '', true)`);
  return result;
}
