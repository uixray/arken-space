import { arkenSystem } from "@arken/system";

const statKeys = new Set(arkenSystem.stats.map((stat) => stat.key));

function legacyActionFields(action: Record<string, unknown>, order: number) {
  const fields: Record<string, unknown> = {};
  const formula = typeof action.formula === "string" ? action.formula : "";
  const match = formula.match(
    /^\s*(\d{1,2}d(?:2|4|6|8|10|12|20|100)(?:kh1)?)(?:\s*([+-])\s*([a-z][a-z0-9_]*|\d+))?\s*$/i,
  );
  if (action.dice === undefined && match) fields.dice = match[1];
  if (action.modifiers === undefined && match?.[3]) {
    const sign = match[2] === "-" ? -1 : 1;
    const operand = match[3];
    if (/^\d+$/.test(operand))
      fields.modifiers = [{ type: "CONSTANT", value: sign * Number(operand) }];
    else {
      const normalized =
        operand.toLowerCase() === "mind"
          ? "intelligence"
          : operand.toLowerCase() === "spirit"
            ? "willpower"
            : operand;
      if (sign > 0 && statKeys.has(normalized))
        fields.modifiers = [{ type: "CHARACTERISTIC", key: normalized }];
    }
  } else if (action.modifiers === undefined && match && !match[3]) {
    fields.modifiers = [];
  }
  if (action.kind === undefined) fields.kind = "CUSTOM";
  if (action.order === undefined) fields.order = order;
  if (action.advantage === undefined) fields.advantage = false;
  if (action.consumeUse === undefined) fields.consumeUse = false;
  return fields;
}

function legacyUses(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const uses = value as Record<string, unknown>;
  const recharge = uses.recharge ?? uses.rechargeRate;
  const rechargeMap: Record<string, string> = {
    LONG_REST: "DAY",
    SHORT_REST: "SHORT_REST",
    DAY: "DAY",
    BATTLE: "BATTLE",
    WEEK: "WEEK",
  };
  return {
    ...uses,
    ...(uses.max === undefined && uses.maximum !== undefined
      ? { max: uses.maximum }
      : {}),
    ...(uses.recharge === undefined &&
    typeof recharge === "string" &&
    rechargeMap[recharge]
      ? { recharge: rechargeMap[recharge] }
      : {}),
  };
}

export function normalizeLegacyStats(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const stats = { ...(value as Record<string, number>) };
  const mind = stats.mind;
  const spirit = stats.spirit;
  if (stats.intelligence === undefined && Number.isFinite(mind))
    stats.intelligence = mind as number;
  if (stats.willpower === undefined && Number.isFinite(spirit))
    stats.willpower = spirit as number;
  delete stats.mind;
  delete stats.spirit;
  /**
   * UIX-424: персонаж, созданный до появления строки, её значения не имеет, а
   * `stats[key]` в движке формул — прямой поиск: отсутствующий ключ даёт
   * «Стат не найден» **в момент броска**. Раньше здесь были выписаны три ключа,
   * добавленных задним числом; теперь добираются все, какие знает система.
   *
   * Ключи, которых в системе больше нет (`endurance`, `knowledge`), не
   * стираются: раскладка их не показывает, но мастеру они нужны, когда он
   * разбирает формулу, сломавшуюся на их удалении.
   */
  for (const stat of arkenSystem.stats)
    if (!Number.isFinite(stats[stat.key])) stats[stat.key] = stat.defaultValue;
  return stats;
}

export function normalizeLegacyFormula(value: string) {
  return value
    .replace(/\bmind\b/gi, "intelligence")
    .replace(/\bspirit\b/gi, "willpower");
}

export function normalizeLegacyEntryData(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const data = value as Record<string, unknown>;
  const rollActions = Array.isArray(data.rollActions)
    ? data.rollActions.map((candidate, index) => {
        if (!candidate || typeof candidate !== "object") return candidate;
        const action = candidate as Record<string, unknown>;
        const modifiers = Array.isArray(action.modifiers)
          ? action.modifiers.map((candidateModifier) => {
              if (!candidateModifier || typeof candidateModifier !== "object")
                return candidateModifier;
              const modifier = candidateModifier as Record<string, unknown>;
              if (modifier.type !== "CHARACTERISTIC") return modifier;
              const key =
                modifier.key === "spirit"
                  ? "willpower"
                  : modifier.key === "mind"
                    ? "intelligence"
                    : modifier.key;
              return key === modifier.key ? modifier : { ...modifier, key };
            })
          : action.modifiers;
        const legacyFields = legacyActionFields(
          { ...action, modifiers },
          index,
        );
        return {
          ...action,
          ...legacyFields,
          ...(Array.isArray(action.modifiers) ? { modifiers } : {}),
        };
      })
    : data.rollActions;
  return {
    ...data,
    rollActions,
    ...(data.uses === undefined ? {} : { uses: legacyUses(data.uses) }),
  };
}
