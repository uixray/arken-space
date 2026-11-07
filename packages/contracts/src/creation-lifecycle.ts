import { z } from "zod";
import { creationKindSchema } from "./creation.js";

const id = z.string().uuid();
const revision = z.number().int().min(0).max(2_000_000_000);
const copper = z.number().int().min(0).max(1_000_000_000_000);
const sp = z.number().int().min(0).max(1_000_000_000);
const quantity = z.number().int().min(1).max(1_000_000);
export const creationStageSchema = z.enum(["CRAFTED", "EVOLVING", "MASTERWORK", "FORGED"]);
const point = z.object({ versionId: id, level: z.number().int().min(1).max(1000),
  stage: creationStageSchema }).strict();
const materials = z.array(z.object({ worldContentId: id, quantity }).strict()).max(128)
  .refine(rows => new Set(rows.map(r => r.worldContentId)).size === rows.length,
    "Материал не должен повторяться; укажите его общее количество.");
/** Actual paid inputs, not current nominal/market value. No synthetic wallet. */
export const creationPaidBasisSchema = z.object({ copper, sp, materials }).strict();
export type CreationPaidBasis = z.infer<typeof creationPaidBasisSchema>;
const refund = z.object({ copperBasisPoints: z.number().int().min(0).max(9999),
  spBasisPoints: z.number().int().min(0).max(9999),
  materialsBasisPoints: z.number().int().min(0).max(9999) }).strict();

/** Every recipe is an explicit GM version. No proposed content numbers become defaults. */
export const creationRecipeSourceSchema = z.object({ format: z.literal(1),
  name: z.string().trim().min(1).max(100), reason: z.string().trim().min(1).max(2000),
  kind: creationKindSchema, operation: z.enum(["CRAFT", "UPGRADE", "MERGE", "DISASSEMBLE"]),
  inputs: z.array(point).max(8), output: point.nullable(), cost: creationPaidBasisSchema,
  refund: refund.nullable(),
}).strict().superRefine((r, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (r.operation === "DISASSEMBLE") {
    if (r.inputs.length !== 1 || r.output !== null || !r.refund)
      fail("Разбор требует один вход, возврат и отсутствие нового объекта.");
  } else {
    if (!r.output || r.refund !== null) fail("Изготовление/развитие не создаёт денежный или материальный возврат.");
    if (r.operation === "CRAFT" && (r.inputs.length !== 0 || r.output?.level !== 1 || r.output?.stage !== "CRAFTED"))
      fail("Изготовление создаёт один объект первого уровня Crafted без входных созданных объектов.");
    if (r.operation === "UPGRADE" && r.inputs.length !== 1) fail("Развитие требует один вход.");
    if (r.operation === "MERGE" && r.inputs.length < 2) fail("Слияние требует от двух до восьми отдельных входов.");
    if (r.output && r.inputs.some(p => p.level > r.output!.level)) fail("Рецепт не должен скрыто понижать уровень.");
  }
});
export type CreationRecipeSource = z.infer<typeof creationRecipeSourceSchema>;
export type CreationPoint = z.infer<typeof point>;
export const saveCreationRecipeSchema = z.object({ actionId: id, recipeId: id,
  expectedRevision: revision.nullable(), source: creationRecipeSourceSchema, publish: z.boolean() }).strict();
export const setCreationRecipeEnabledSchema = z.object({ actionId: id, recipeId: id,
  expectedRevision: revision, enabled: z.boolean(), reason: z.string().trim().min(1).max(1000) }).strict();
export const creationMaterialPicksSchema = z.array(z.object({ instanceId: id, quantity }).strict()).max(128)
  .refine(rows => new Set(rows.map(p => p.instanceId)).size === rows.length, "Один экземпляр нельзя расходовать дважды.");
export const creationOperationQuoteSchema = z.object({ characterId: id, recipeVersionId: id,
  inputObjectIds: z.array(id).max(8),
  materialPicks: creationMaterialPicksSchema,
}).strict().superRefine((v, ctx) => {
  if (new Set(v.inputObjectIds).size !== v.inputObjectIds.length ||
      new Set(v.materialPicks.map(p => p.instanceId)).size !== v.materialPicks.length)
    ctx.addIssue({ code: "custom", message: "Один экземпляр нельзя расходовать дважды." });
});
export const commitCreationOperationSchema = z.object({ actionId: id, quoteId: id }).strict();
export const transferCreationObjectSchema = z.object({ actionId: id, objectId: id,
  expectedRevision: revision, characterId: id, reason: z.string().trim().min(1).max(1000) }).strict();

export interface CreationOperationQuote {
  id: string; characterId: string; recipeVersionId: string; recipeName: string;
  operation: CreationRecipeSource["operation"]; inputObjectIds: string[];
  output: (CreationPoint & { name: string; kind: "SKILL" | "ARTIFACT" }) | null;
  spend: CreationPaidBasis; returns: CreationPaidBasis; affordable: boolean;
  expiresAt: string; rounding: "FLOOR_EACH_REFUND_RESOURCE";
}
export interface CreationOperationReceipt {
  actionId: string; quoteId: string; characterId: string; recipeVersionId: string;
  operation: CreationRecipeSource["operation"]; consumedObjectIds: string[];
  outputObjectId: string | null; entryId: string | null; instanceId: string | null;
  spent: CreationPaidBasis; returned: CreationPaidBasis; completedAt: string;
}

const pointKey = (kind: string, p: CreationPoint) => `${kind}:${p.versionId}:${p.level}:${p.stage}`;
/** Check all currently enabled recipe versions together, not just the edited edge.
 * Material/money conservation is a separate paid-basis invariant at commit time:
 * craft/upgrade/merge only consume; disassembly may only return a strict fraction
 * of the once-consumed input's historical basis. This graph alone is not a proof
 * of economy balance, market pricing or manually edited player coin provenance. */
export function creationRecipeGraphHasCycle(recipes: readonly CreationRecipeSource[]) {
  const edges = new Map<string, Set<string>>(), incoming = new Map<string, number>();
  for (const r of recipes) {
    if (!r.output) continue;
    const to = pointKey(r.kind, r.output);
    if (!incoming.has(to)) incoming.set(to, 0);
    for (const input of r.inputs) {
      const from = pointKey(r.kind, input);
      if (!incoming.has(from)) incoming.set(from, 0);
      const next = edges.get(from) ?? new Set<string>();
      if (!next.has(to)) { next.add(to); incoming.set(to, incoming.get(to)! + 1); }
      edges.set(from, next);
    }
  }
  const queue = [...incoming].filter(([, n]) => n === 0).map(([key]) => key);
  let visited = 0;
  for (let i = 0; i < queue.length; i++) {
    visited++;
    for (const to of edges.get(queue[i]!) ?? []) {
      const n = incoming.get(to)! - 1; incoming.set(to, n); if (!n) queue.push(to);
    }
  }
  return visited !== incoming.size;
}

/** Provenance arithmetic only; never derives a refund from evaluation.priceCopper. */
export function mergeCreationPaidBasis(values: readonly CreationPaidBasis[]): CreationPaidBasis {
  const items = new Map<string, bigint>(); let money = 0n, points = 0n;
  for (const raw of values) {
    const value = creationPaidBasisSchema.parse(raw);
    money += BigInt(value.copper); points += BigInt(value.sp);
    for (const m of value.materials) items.set(m.worldContentId, (items.get(m.worldContentId) ?? 0n) + BigInt(m.quantity));
  }
  // Bounds are checked after conversion; values are far below Number.MAX_SAFE_INTEGER.
  if (money > 1_000_000_000_000n || points > 1_000_000_000n || [...items.values()].some(n => n > 1_000_000n))
    throw new Error("CREATION_BASIS_LIMIT");
  return creationPaidBasisSchema.parse({ copper: Number(money), sp: Number(points), materials:
    [...items].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([worldContentId, n]) => ({ worldContentId, quantity: Number(n) })) });
}
export function creationRefund(basis: CreationPaidBasis, rule: NonNullable<CreationRecipeSource["refund"]>): CreationPaidBasis {
  const b = creationPaidBasisSchema.parse(basis), rates = refund.parse(rule);
  const part = (n: number, rate: number) => Number(BigInt(n) * BigInt(rate) / 10000n);
  return { copper: part(b.copper, rates.copperBasisPoints), sp: part(b.sp, rates.spBasisPoints),
    materials: b.materials.map(m => ({ ...m, quantity: part(m.quantity, rates.materialsBasisPoints) })).filter(m => m.quantity > 0) };
}
