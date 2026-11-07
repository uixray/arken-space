import { z } from "zod";

// These are calculation/storage bounds, not a proposed Arken-Har balance.
export const CREATION_METRICS = ["power", "priceCopper", "craftSp", "usageCost"] as const;
export type CreationMetric = (typeof CREATION_METRICS)[number];
export const CREATION_METRIC_LIMITS: Record<CreationMetric, number> = {
  power: 1_000_000_000, priceCopper: 1_000_000_000_000, craftSp: 1_000_000_000, usageCost: 100_000,
};
export const creationKindSchema = z.enum(["SKILL", "ARTIFACT"]);
export type CreationKind = z.infer<typeof creationKindSchema>;
export const CREATION_SLOTS: Record<CreationKind, readonly string[]> = {
  SKILL: ["ACTION", "TARGET", "SCHOOL", "EFFECT", "MODIFIER", "LIMITATION"],
  ARTIFACT: ["BASE", "MATERIAL", "CORE", "EFFECT", "MODIFIER", "LIMITATION"],
};
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const label = z.string().trim().min(1).max(100);
const id = z.string().uuid();
const revision = z.number().int().min(0).max(2_000_000_000);
const bounded = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const creationMetricsSchema = z.object({ power: bounded, priceCopper: bounded,
  craftSp: bounded, usageCost: bounded }).strict();
export type CreationMetrics = z.infer<typeof creationMetricsSchema>;
const range = z.object({ min: bounded, max: bounded }).strict().refine(v => v.min <= v.max,
  "Нижняя граница не должна превышать верхнюю.");
const ranges = z.object({ power: range, priceCopper: range, craftSp: range, usageCost: range }).strict();
const factor = z.number().int().min(0).max(100_000);
const factors = z.object({ power: factor, priceCopper: factor, craftSp: factor, usageCost: factor }).strict();

/** A closed integer expression. No executable code, property paths or free-form formula. */
const numericExpression = z.object({ base: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  terms: z.array(z.object({ parameter: key, scale: z.number().int().min(-10_000).max(10_000) }).strict()).max(12),
}).strict();
const parameter = z.object({ key, label, min: z.number().int().min(-10_000).max(10_000),
  max: z.number().int().min(-10_000).max(10_000), step: z.number().int().min(1).max(10_000),
  initial: z.number().int().min(-10_000).max(10_000),
  // Per-step contribution measured from min, explicitly supplied by the GM.
  perStep: creationMetricsSchema,
}).strict().superRefine((p, ctx) => {
  if (p.min > p.max || p.initial < p.min || p.initial > p.max ||
      (p.initial - p.min) % p.step !== 0 || (p.max - p.min) % p.step !== 0)
    ctx.addIssue({ code: "custom", message: "Проверьте диапазон, шаг и начальное значение параметра." });
});
const selectionCondition = z.object({ allOf: z.array(key).max(128), anyOf: z.array(key).max(128),
  noneOf: z.array(key).max(128), tags: z.array(z.object({ tag: key,
    min: z.number().int().min(0).max(128), max: z.number().int().min(0).max(128) }).strict()
    .refine(v => v.min <= v.max, "Проверьте границы количества тегов.")).max(32),
  // Optional, without a default: old rule versions keep their parsed bytes.
  parameters: z.array(z.object({ componentId: key, parameter: key,
    min: z.number().int().min(-10_000).max(10_000), max: z.number().int().min(-10_000).max(10_000),
  }).strict().refine(v => v.min <= v.max, "Проверьте границы параметра.")).max(64).optional(),
}).strict();
const effect = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ROLL"), id: key, label, rollKind: z.enum(["HIT", "DAMAGE", "CUSTOM"]),
    sides: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(10),
      z.literal(12), z.literal(20), z.literal(100)]), count: numericExpression,
    modifier: numericExpression, characteristic: key.nullable() }).strict(),
  z.object({ kind: z.literal("ROLL_ADJUST"), targetComponentId: key, targetRollId: key,
    alternatives: z.array(z.object({ componentId: key, rollId: key }).strict()).max(15).optional(),
    countDelta: numericExpression, modifierDelta: numericExpression }).strict(),
  z.object({ kind: z.literal("SKILL_VALUE"), value: numericExpression }).strict(),
  z.object({ kind: z.literal("ACTIVATION") }).strict(),
  z.object({ kind: z.literal("CONSUME_ITEM") }).strict(),
  z.object({ kind: z.literal("USES"), maximum: numericExpression,
    recharge: z.enum(["DAY", "BATTLE", "WEEK", "SHORT_REST"]) }).strict(),
  z.object({ kind: z.literal("RESTORE_MANA_AREA"), radiusMillimeters: numericExpression }).strict(),
  // Prose is an explicit manual action, never an automatically executed teleport/summon/status.
  z.object({ kind: z.literal("MANUAL"), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal("MANUAL_TEMPLATE"), text: z.string().trim().min(1).max(2000),
    when: selectionCondition,
    values: z.record(key, numericExpression).refine(v => Object.keys(v).length <= 8, "Не больше восьми чисел в описании."),
  }).strict().superRefine((v, ctx) => {
    const tokens = [...v.text.matchAll(/\{([a-z][a-z0-9_-]{0,39})\}/g)].map(m => m[1]!);
    if (/[{}]/.test(v.text.replace(/\{([a-z][a-z0-9_-]{0,39})\}/g, "")) ||
        tokens.some(k => !Object.hasOwn(v.values, k)) || Object.keys(v.values).some(k => !tokens.includes(k)))
      ctx.addIssue({ code: "custom", message: "Каждая подстановка {ключ} должна иметь выражение; лишние выражения и фигурные скобки не допускаются." });
  }),
]);
const component = z.object({ id: key, name: label, description: z.string().max(2000),
  slot: z.enum(["ACTION", "TARGET", "SCHOOL", "BASE", "MATERIAL", "CORE", "EFFECT", "MODIFIER", "LIMITATION"]),
  tags: z.array(key).max(16), parameters: z.array(parameter).max(12),
  // Null can be stored in a GM draft, but cannot be activated or evaluated as zero.
  contribution: creationMetricsSchema.nullable(), factorsBasisPoints: factors,
  requirements: z.array(z.object({ statKey: key, minimum: z.number().int().min(-1000).max(1_000_000) }).strict()).max(20),
  materials: z.array(z.object({ worldContentId: id, quantity: z.number().int().min(1).max(1_000_000) }).strict()).max(8),
  artifact: z.object({ baseItemId: id, category: z.enum(["WEAPON", "ARMOR", "ACCESSORY", "RELIC", "CONSUMABLE"]),
    rarity: label }).strict().nullable(), effects: z.array(effect).max(12),
}).strict().superRefine((c, ctx) => {
  const params = new Set(c.parameters.map(p => p.key));
  if (params.size !== c.parameters.length || new Set(c.tags).size !== c.tags.length)
    ctx.addIssue({ code: "custom", message: "Параметры и теги компонента не должны повторяться." });
  const expressions = c.effects.flatMap(e => e.kind === "ROLL" ? [e.count, e.modifier] :
    e.kind === "ROLL_ADJUST" ? [e.countDelta, e.modifierDelta] :
    e.kind === "SKILL_VALUE" ? [e.value] : e.kind === "RESTORE_MANA_AREA" ? [e.radiusMillimeters] :
      e.kind === "USES" ? [e.maximum] : e.kind === "MANUAL_TEMPLATE" ? Object.values(e.values) : []);
  if (expressions.some(e => new Set(e.terms.map(t => t.parameter)).size !== e.terms.length ||
      e.terms.some(t => !params.has(t.parameter))))
    ctx.addIssue({ code: "custom", message: "Выражение ссылается на неизвестный или повторный параметр." });
  const rolls = c.effects.filter(e => e.kind === "ROLL");
  if (new Set(rolls.map(e => e.id)).size !== rolls.length)
    ctx.addIssue({ code: "custom", message: "Идентификаторы бросков компонента не должны повторяться." });
});
export const creationRuleSourceSchema = z.object({ format: z.literal(1), kind: creationKindSchema,
  name: label, description: z.string().max(4000),
  slots: z.array(z.object({ slot: z.string().min(1).max(20),
    min: z.number().int().min(0).max(16), max: z.number().int().min(0).max(16) }).strict()
    .refine(v => v.min <= v.max, "Проверьте границы слота.")).length(6),
  components: z.array(component).min(1).max(128),
  compatibility: z.array(z.object({ id: key, when: selectionCondition, require: selectionCondition,
    severity: z.enum(["ERROR", "WARNING"]), message: z.string().trim().min(1).max(500) }).strict()).max(128),
  limits: ranges, manualAdjustment: ranges,
  // The existing runtime supports one resource, not a second parallel cost system.
  usageResource: z.enum(["physical", "magic"]).nullable(),
}).strict().superRefine((r, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: "custom", message });
  const slots = CREATION_SLOTS[r.kind];
  if (new Set(r.slots.map(s => s.slot)).size !== 6 || r.slots.some(s => !slots.includes(s.slot)))
    add("Нужны все шесть слотов выбранного конструктора без повторов.");
  const ids = new Set(r.components.map(c => c.id));
  const tags = new Set(r.components.flatMap(c => c.tags));
  if (ids.size !== r.components.length) add("Идентификаторы компонентов не должны повторяться.");
  if (r.components.some(c => !slots.includes(c.slot))) add("Компонент относится к другому конструктору.");
  for (const s of r.slots)
    if (r.components.filter(c => c.slot === s.slot).length < s.min) add("Недостаточно компонентов для обязательного слота.");
  if (r.components.some(c => c.artifact !== null && (r.kind !== "ARTIFACT" || c.slot !== "BASE")))
    add("Основа артефакта задаётся только в слоте BASE конструктора артефактов.");
  if (r.kind === "ARTIFACT" && (r.slots.find(s => s.slot === "BASE")?.min !== 1 ||
      r.slots.find(s => s.slot === "BASE")?.max !== 1 || r.components.some(c => c.slot === "BASE" && !c.artifact)))
    add("Артефакт должен выбирать ровно одну типизированную ITEM-основу.");
  if (new Set(r.compatibility.map(c => c.id)).size !== r.compatibility.length)
    add("Идентификаторы ограничений не должны повторяться.");
  const conditions = [...r.compatibility.flatMap(c => [c.when, c.require]),
    ...r.components.flatMap(c => c.effects.flatMap(e => e.kind === "MANUAL_TEMPLATE" ? [e.when] : []))];
  for (const condition of conditions) {
    if ([...condition.allOf, ...condition.anyOf, ...condition.noneOf].some(k => !ids.has(k)) ||
        condition.tags.some(t => !tags.has(t.tag))) add("Ограничение ссылается на неизвестный компонент или тег.");
    const bounds = condition.parameters ?? [];
    if (new Set(bounds.map(p => `${p.componentId}:${p.parameter}`)).size !== bounds.length)
      add("Параметр не должен повторяться в одном условии.");
    for (const bound of bounds) {
      const parameter = r.components.find(item => item.id === bound.componentId)?.parameters.find(p => p.key === bound.parameter);
      if (!parameter) add("Ограничение ссылается на неизвестный параметр компонента.");
      else {
        const low = Math.max(parameter.min, bound.min), high = Math.min(parameter.max, bound.max);
        if (low > high || parameter.min + Math.ceil((low - parameter.min) / parameter.step) * parameter.step > high)
          add("Условие параметра недостижимо с его диапазоном и шагом.");
      }
    }
  }
  for (const [componentIndex, c] of r.components.entries()) for (const [effectIndex, e] of c.effects.entries()) {
    if (e.kind !== "ROLL_ADJUST") continue;
    const targets = [{ componentId: e.targetComponentId, rollId: e.targetRollId }, ...(e.alternatives ?? [])];
    if (new Set(targets.map(t => `${t.componentId}:${t.rollId}`)).size !== targets.length)
      ctx.addIssue({ code: "custom", path: ["components", componentIndex, "effects", effectIndex], message: "Цели усиления не должны повторяться." });
    for (const target of targets) if (!r.components.find(candidate => candidate.id === target.componentId)?.effects.some(
      candidate => candidate.kind === "ROLL" && candidate.id === target.rollId))
      ctx.addIssue({ code: "custom", path: ["components", componentIndex, "effects", effectIndex],
        message: "Каждая цель усиления должна быть существующим броском компонента этого набора." });
  }
  for (const metric of CREATION_METRICS) {
    if (r.limits[metric].min < 0 || r.limits[metric].max > CREATION_METRIC_LIMITS[metric])
      add("Предел результата превышает безопасный диапазон расчёта.");
    if (r.manualAdjustment[metric].min > 0 || r.manualAdjustment[metric].max < 0)
      add("Диапазон ручной поправки должен включать ноль.");
  }
});
export type CreationRuleSource = z.infer<typeof creationRuleSourceSchema>;
export const creationDesignSchema = z.object({ name: label, lore: z.string().max(10000),
  appearance: z.string().max(2000),
  selections: z.array(z.object({ componentId: key,
    parameters: z.record(key, z.number().int().min(-10_000).max(10_000)) }).strict()).min(1).max(96),
  adjustments: creationMetricsSchema, adjustmentReason: z.string().trim().max(500),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.selections.map(s => s.componentId)).size !== v.selections.length)
    ctx.addIssue({ code: "custom", message: "Компонент нельзя выбрать дважды." });
  if (CREATION_METRICS.some(k => v.adjustments[k] !== 0) && !v.adjustmentReason)
    ctx.addIssue({ code: "custom", message: "Для ручной поправки нужна причина." });
});
export type CreationDesign = z.infer<typeof creationDesignSchema>;
export const saveCreationRulesSchema = z.object({ actionId: id, packId: id,
  expectedRevision: revision.nullable(), source: creationRuleSourceSchema, publish: z.boolean() }).strict();
export const setCreationRulesEnabledSchema = z.object({ actionId: id, packId: id,
  expectedRevision: revision, enabled: z.boolean(), reason: z.string().trim().min(1).max(500) }).strict();
export const evaluateCreationSchema = z.object({ ruleVersionId: id, design: creationDesignSchema }).strict();
export const saveCreationTemplateSchema = z.object({ actionId: id, templateId: id,
  expectedRevision: revision.nullable(), previousVersionId: id.nullable(),
  ruleVersionId: id, design: creationDesignSchema }).strict();
export const forkCreationTemplateSchema = z.object({ actionId: id, templateId: id,
  sourceVersionId: id, ruleVersionId: id, name: label }).strict();
export const reviewCreationSchema = z.object({ actionId: id, versionId: id,
  expectedRevision: revision.nullable(), decision: z.enum(["APPROVED", "REJECTED", "REVOKED"]),
  reason: z.string().trim().min(1).max(1000) }).strict();
export const creationReadQuerySchema = z.object({ after: id.optional() }).strict();

export interface CreationEvaluation {
  evaluator: "creation-1";
  valid: boolean;
  errors: Array<{ code: string; message: string; componentId?: string }>;
  warnings: Array<{ code: string; message: string }>;
  totals: CreationMetrics | null;
  breakdown: Array<{ componentId: string; name: string; contribution: CreationMetrics;
    factorsBasisPoints: CreationMetrics; parameters: Record<string, number> }>;
  card: { name: string; description: string; appearance: string; components: string[];
    requirements: Array<{ statKey: string; minimum: number }>;
    materials: Array<{ worldContentId: string; quantity: number }>;
    artifact: { baseItemId: string; category: string; rarity: string } | null;
    manualEffects: string[] };
  // Generated only by the evaluator, then checked by the existing runtime schema on the server.
  entryData: Record<string, unknown> | null;
}
