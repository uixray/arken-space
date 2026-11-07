import { CREATION_METRICS, CREATION_METRIC_LIMITS, creationDesignSchema, creationRuleSourceSchema,
  type CreationDesign, type CreationEvaluation, type CreationMetric, type CreationMetrics,
  type CreationRuleSource } from "./creation.js";

const zero = (): CreationMetrics => ({ power: 0, priceCopper: 0, craftSp: 0, usageCost: 0 });
type Component = CreationRuleSource["components"][number];
type Condition = CreationRuleSource["compatibility"][number]["when"];
const conditionMatches = (condition: Condition, ids: Set<string>, tags: Map<string, number>,
  parameters: Map<string, Record<string, number>>) =>
  condition.allOf.every(id => ids.has(id)) && (!condition.anyOf.length || condition.anyOf.some(id => ids.has(id))) &&
  condition.noneOf.every(id => !ids.has(id)) && condition.tags.every(t =>
    (tags.get(t.tag) ?? 0) >= t.min && (tags.get(t.tag) ?? 0) <= t.max) &&
  (condition.parameters ?? []).every(bound => {
    const value = parameters.get(bound.componentId)?.[bound.parameter];
    return value !== undefined && value >= bound.min && value <= bound.max;
  });
const within = (n: number, range: { min: number; max: number }) => n >= range.min && n <= range.max;
const safeNumber = (n: bigint, limit = Number.MAX_SAFE_INTEGER) => {
  if (n < BigInt(-limit) || n > BigInt(limit)) throw new Error("CALCULATION_LIMIT");
  return Number(n);
};
type Expression = { base: number; terms: Array<{ parameter: string; scale: number }> };
function numberFrom(expression: Expression, parameters: Record<string, number>) {
  return safeNumber(expression.terms.reduce((sum, term) =>
    sum + BigInt(parameters[term.parameter]!) * BigInt(term.scale), BigInt(expression.base)));
}

/** Same pure calculation for GM preview and server persistence. It grants no approval/ownership. */
export function evaluateCreation(rawRules: CreationRuleSource, rawDesign: CreationDesign): CreationEvaluation {
  const rules = creationRuleSourceSchema.parse(rawRules);
  const design = creationDesignSchema.parse(rawDesign);
  const result: CreationEvaluation = { evaluator: "creation-1", valid: false, errors: [], warnings: [],
    totals: null, breakdown: [], entryData: null,
    card: { name: design.name, description: design.lore, appearance: design.appearance,
      components: [], requirements: [], materials: [], artifact: null, manualEffects: [] } };
  const error = (code: string, message: string, componentId?: string) =>
    result.errors.push({ code, message, ...(componentId ? { componentId } : {}) });
  const byId = new Map(rules.components.map(c => [c.id, c]));
  const selected: Array<{ component: Component; parameters: Record<string, number> }> = [];
  for (const choice of design.selections) {
    const component = byId.get(choice.componentId);
    if (!component) { error("UNKNOWN_COMPONENT", "Компонент отсутствует в этой версии правил.", choice.componentId); continue; }
    const parameters: Record<string, number> = {};
    let invalid = Object.keys(choice.parameters).some(k => !component.parameters.some(p => p.key === k));
    for (const p of component.parameters) {
      const value = Object.hasOwn(choice.parameters, p.key) ? choice.parameters[p.key]! : p.initial;
      if (!within(value, p) || (value - p.min) % p.step !== 0) invalid = true;
      parameters[p.key] = value;
    }
    if (invalid) error("PARAMETER_RANGE", "Неизвестный параметр, неверный шаг или выход за пределы.", component.id);
    else selected.push({ component, parameters });
  }
  const ids = new Set(selected.map(s => s.component.id));
  const tags = new Map<string, number>();
  for (const { component } of selected) for (const tag of component.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  for (const slot of rules.slots) {
    const count = selected.filter(s => s.component.slot === slot.slot).length;
    if (count < slot.min || count > slot.max) error("SLOT_COUNT", `Слот ${slot.slot}: нужно от ${slot.min} до ${slot.max}, выбрано ${count}.`);
  }
  const selectedParameters = new Map(selected.map(s => [s.component.id, s.parameters]));
  for (const rule of rules.compatibility) if (conditionMatches(rule.when, ids, tags, selectedParameters) &&
      !conditionMatches(rule.require, ids, tags, selectedParameters)) {
    const item = { code: `COMPATIBILITY:${rule.id}`, message: rule.message };
    if (rule.severity === "ERROR") result.errors.push(item); else result.warnings.push(item);
  }
  const totals = zero();
  const sums = Object.fromEntries(CREATION_METRICS.map(k => [k, 0n])) as Record<CreationMetric, bigint>;
  const numerators = Object.fromEntries(CREATION_METRICS.map(k => [k, 1n])) as Record<CreationMetric, bigint>;
  let denominator = 1n;
  const requirements = new Map<string, number>();
  const materials = new Map<string, number>();
  const rolls: Array<Record<string, unknown>> = [];
  const rollTargets = new Map<string, { index: number; count: number; sides: number; modifier: number; characteristic: string | null }>();
  const rollAdjustments: Array<{ targets: string[]; count: number; modifier: number; componentId: string }> = [];
  let skillValue: number | undefined;
  let activation = false;
  let consumptionCount = 0;
  let uses: { current: number; max: number; recharge: "DAY" | "BATTLE" | "WEEK" | "SHORT_REST" } | undefined;
  let areaEffect: Record<string, unknown> | undefined;
  try {
    for (const { component: c, parameters } of selected) {
      if (c.contribution === null) { error("UNPRICED_COMPONENT", "GM ещё не задал расчёт компонента.", c.id); continue; }
      const contribution = zero();
      for (const metric of CREATION_METRICS) {
        const sum = c.parameters.reduce((n, p) => n + BigInt((parameters[p.key]! - p.min) / p.step) *
          BigInt(p.perStep[metric]), BigInt(c.contribution[metric]));
        contribution[metric] = safeNumber(sum);
        sums[metric] += sum;
        numerators[metric] *= BigInt(c.factorsBasisPoints[metric]);
      }
      denominator *= 10000n;
      result.breakdown.push({ componentId: c.id, name: c.name, contribution,
        factorsBasisPoints: c.factorsBasisPoints, parameters });
      result.card.components.push(c.name);
      for (const r of c.requirements) requirements.set(r.statKey, Math.max(requirements.get(r.statKey) ?? -Infinity, r.minimum));
      for (const m of c.materials) materials.set(m.worldContentId, (materials.get(m.worldContentId) ?? 0) + m.quantity);
      if (c.artifact) {
        if (result.card.artifact) error("MULTIPLE_BASES", "У артефакта должна быть одна основа.");
        result.card.artifact = c.artifact;
      }
      for (const e of c.effects) {
        if (e.kind === "CONSUME_ITEM") consumptionCount++;
        else if (e.kind === "MANUAL") result.card.manualEffects.push(e.text);
        else if (e.kind === "MANUAL_TEMPLATE") {
          if (conditionMatches(e.when, ids, tags, selectedParameters)) {
            const text = e.text.replace(/\{([a-z][a-z0-9_-]{0,39})\}/g, (_, key: string) => String(numberFrom(e.values[key]!, parameters)));
            if (text.length > 2000) error("MANUAL_TEXT_LIMIT", "Итоговое ручное описание слишком длинное.", c.id);
            else result.card.manualEffects.push(text);
          }
        }
        else if (e.kind === "ACTIVATION") activation = true;
        else if (e.kind === "USES") {
          const maximum = numberFrom(e.maximum, parameters);
          if (uses || maximum < 1 || maximum > 1000) error("USES_CONFLICT", "Нужно одно допустимое правило использований.", c.id);
          else uses = { current: maximum, max: maximum, recharge: e.recharge };
        }
        else if (e.kind === "SKILL_VALUE") {
          const value = numberFrom(e.value, parameters);
          if (skillValue !== undefined || !within(value, { min: -1000, max: 1000 }))
            error("SKILL_VALUE_CONFLICT", "Нужно одно допустимое числовое значение навыка.", c.id);
          else skillValue = value;
        } else if (e.kind === "RESTORE_MANA_AREA") {
          const radius = numberFrom(e.radiusMillimeters, parameters) / 1000;
          if (areaEffect || radius <= 0 || radius > 1_000_000) error("AREA_CONFLICT", "Недопустимая или повторная область.", c.id);
          else areaEffect = { kind: "RESTORE_MANA", radiusMeters: radius, origin: "CASTER",
            targets: "PLAYER_CHARACTERS", dice: "1d6", includeCaster: true };
        } else if (e.kind === "ROLL_ADJUST") {
          rollAdjustments.push({ targets: [`${e.targetComponentId}:${e.targetRollId}`, ...(e.alternatives ?? []).map(t => `${t.componentId}:${t.rollId}`)],
            count: numberFrom(e.countDelta, parameters), modifier: numberFrom(e.modifierDelta, parameters), componentId: c.id });
        } else if (e.kind === "ROLL") {
          const count = numberFrom(e.count, parameters), modifier = numberFrom(e.modifier, parameters);
          if (count < 1 || count > 99 || modifier < -1000 || modifier > 1000 || rolls.length >= 20)
            error("ROLL_LIMIT", "Бросок превышает границы существующего игрового действия.", c.id);
          else {
            rollTargets.set(`${c.id}:${e.id}`, { index: rolls.length, count, sides: e.sides, modifier, characteristic: e.characteristic });
            rolls.push({ id: `created-roll-${rolls.length}`, label: e.label, kind: e.rollKind,
            dice: `${count}d${e.sides}`, modifiers: [
              ...(modifier ? [{ type: "CONSTANT", value: modifier }] : []),
              ...(e.characteristic ? [{ type: "CHARACTERISTIC", key: e.characteristic }] : []),
            ], order: rolls.length, advantage: false, consumeUse: false });
          }
        }
      }
    }
    // Resolve after all selected components: input order cannot hide a target.
    // Keep untouched legacy rolls byte-identical; only explicitly addressed rolls change.
    const deltas = new Map<string, { count: bigint; modifier: bigint }>();
    for (const adjustment of rollAdjustments) {
      const selectedTargets = adjustment.targets.filter(target => rollTargets.has(target));
      if (selectedTargets.length !== 1) {
        error("ROLL_ADJUST_TARGET", "Для усиления должен быть выбран ровно один из разрешённых бросков.", adjustment.componentId); continue;
      }
      const targetKey = selectedTargets[0]!;
      const delta = deltas.get(targetKey) ?? { count: 0n, modifier: 0n };
      delta.count += BigInt(adjustment.count); delta.modifier += BigInt(adjustment.modifier);
      deltas.set(targetKey, delta);
    }
    for (const [key, delta] of deltas) {
      const target = rollTargets.get(key)!;
      const count = safeNumber(BigInt(target.count) + delta.count), modifier = safeNumber(BigInt(target.modifier) + delta.modifier);
      if (count < 1 || count > 99 || modifier < -1000 || modifier > 1000) {
        error("ROLL_ADJUST_LIMIT", "Итог усиления выходит за границы игрового броска."); continue;
      }
      rolls[target.index] = { ...rolls[target.index], dice: `${count}d${target.sides}`, modifiers: [
        ...(modifier ? [{ type: "CONSTANT", value: modifier }] : []),
        ...(target.characteristic ? [{ type: "CHARACTERISTIC", key: target.characteristic }] : []),
      ] };
    }
    for (const metric of CREATION_METRICS) {
      const adjustment = design.adjustments[metric];
      if (!within(adjustment, rules.manualAdjustment[metric])) error("ADJUSTMENT_RANGE", `Поправка ${metric} выходит за пределы GM.`);
      const numerator = (sums[metric] + BigInt(adjustment)) * numerators[metric];
      if (numerator < 0n) { error("NEGATIVE_RESULT", `Итог ${metric} не может быть отрицательным.`); continue; }
      totals[metric] = safeNumber((numerator + denominator - 1n) / denominator, CREATION_METRIC_LIMITS[metric]);
      if (!within(totals[metric], rules.limits[metric])) error("RULE_LIMIT", `Итог ${metric} выходит за пределы набора правил.`);
    }
  } catch { error("CALCULATION_LIMIT", "Числа превышают безопасный диапазон. Уточните параметры или правила."); }
  if (rules.kind === "ARTIFACT" && !result.card.artifact) error("MISSING_BASE", "Не выбрана типизированная основа артефакта.");
  if (totals.usageCost > 0 && !rules.usageResource) error("USAGE_RESOURCE_MISSING", "GM не задал ресурс стоимости применения.");
  if (!rolls.length && !activation && !areaEffect && skillValue === undefined && !result.card.manualEffects.length)
    error("MISSING_EFFECT", "У объекта нет игрового или явно ручного эффекта.");
  if (totals.usageCost > 0 && !rolls.length && !activation && !areaEffect)
    error("USAGE_ACTION_MISSING", "Для стоимости применения нужен бросок или активация.");
  if (uses && !rolls.length && !activation && !areaEffect)
    error("USES_ACTION_MISSING", "Лимит использований требует явного броска, области или активации.");
  if (consumptionCount && (consumptionCount !== 1 || rules.kind !== "ARTIFACT" || result.card.artifact?.category !== "CONSUMABLE" ||
      rolls.length + Number(activation) + Number(Boolean(areaEffect)) !== 1 || skillValue !== undefined))
    error("CONSUMPTION_ACTION", "Одноразовому ITEM нужна расходуемая основа и ровно одно применение без пассивного числового навыка.");
  if (consumptionCount) result.warnings.push({ code: "CONSUMES_ITEM", message: "При применении предмет расходуется целиком; повторное применение или разбор невозможны." });
  result.card.requirements = [...requirements].map(([statKey, minimum]) => ({ statKey, minimum }));
  result.card.materials = [...materials].map(([worldContentId, quantity]) => ({ worldContentId, quantity }));
  if (result.card.manualEffects.length) result.warnings.push({ code: "MANUAL_EFFECTS", message: "Ручные эффекты исполняет мастер; сервис не применяет их автоматически." });
  if (!result.errors.length) {
    result.valid = true;
    result.totals = totals;
    result.entryData = { ...(rolls.length ? { rollActions: rolls.map(r => ({ ...r, consumeUse: Boolean(uses) })) } : {}),
      ...(activation ? { activation: { consumeUse: Boolean(uses) } } : {}), ...(uses ? { uses } : {}),
      ...(consumptionCount ? { creationConsumption: "BOUND_ITEM_ON_APPLICATION" } : {}),
      ...(areaEffect ? { areaEffect } : {}), ...(skillValue !== undefined ? { skillValue } : {}),
      usageCost: totals.usageCost ? { type: rules.usageResource!, amount: totals.usageCost } : null,
      notes: result.card.manualEffects.length ? "Вручную мастером:\n" + result.card.manualEffects.join("\n") : "" };
  }
  return result;
}
