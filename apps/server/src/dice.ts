import type { DiceResult, DiceTerm } from "@arken/contracts";

const termPattern =
  /^(?:(\d{0,3})d(\d{1,4})(kh1|kl1)?|([a-zA-Z_][a-zA-Z0-9_]*)|(\d+))$/;

export class DiceFormulaError extends Error {}

export type RollMode = "NORMAL" | "ADVANTAGE" | "DISADVANTAGE";

function decorateSemanticOutcome(result: DiceResult): DiceResult {
  const d20Terms = result.terms.filter((term) =>
    ["1d20", "2d20kh1", "2d20kl1"].includes(term.notation),
  );
  let keptNaturalD20: number | null = null;
  if (d20Terms.length === 1) {
    const term = d20Terms[0]!;
    keptNaturalD20 =
      term.notation === "2d20kh1"
        ? Math.max(...term.rolls)
        : term.notation === "2d20kl1"
          ? Math.min(...term.rolls)
          : term.rolls.length === 1
            ? (term.rolls[0] ?? null)
            : null;
  }
  const kind =
    keptNaturalD20 === 1
      ? "CRITICAL_FAILURE"
      : keptNaturalD20 === 20
        ? "CRITICAL_SUCCESS"
        : "NORMAL";
  return {
    ...result,
    semanticOutcome: { kind, keptNaturalD20 },
    frame:
      kind === "CRITICAL_FAILURE"
        ? { setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-failure" }
        : kind === "CRITICAL_SUCCESS"
          ? { setKey: "ARKEN_CRITICAL_V1", frameKey: "critical-success" }
          : null,
  };
}

export function rollFormula(
  formula: string,
  stats: Record<string, number>,
  randomInt: (maxExclusive: number) => number = (max) =>
    Math.floor(Math.random() * max),
  label?: string,
): DiceResult {
  const compact = formula.replace(/\s+/g, "");
  if (!compact || compact.length > 160)
    throw new DiceFormulaError("Некорректная формула");

  const tokens = compact.match(/[+-]?[^+-]+/g);
  if (!tokens?.length) throw new DiceFormulaError("Формула пуста");

  const terms: DiceTerm[] = [];
  const modifiers: Array<{ source: string; value: number }> = [];
  const resolved: string[] = [];
  let total = 0;

  for (const signed of tokens) {
    const sign = signed.startsWith("-") ? -1 : 1;
    const raw = signed.replace(/^[+-]/, "");
    const match = termPattern.exec(raw);
    if (!match) throw new DiceFormulaError(`Неизвестный элемент: ${raw}`);

    if (match[2]) {
      const count = Number(match[1] || 1);
      const sides = Number(match[2]);
      if (count < 1 || count > 100)
        throw new DiceFormulaError("Можно бросить от 1 до 100 костей");
      if (sides < 2 || sides > 1000)
        throw new DiceFormulaError("У кости должно быть от 2 до 1000 граней");
      const rolls = Array.from({ length: count }, () => randomInt(sides) + 1);
      const kept =
        match[3] === "kh1"
          ? Math.max(...rolls)
          : match[3] === "kl1"
            ? Math.min(...rolls)
            : rolls.reduce((sum, value) => sum + value, 0);
      const subtotal = kept * sign;
      terms.push({
        notation: `${sign < 0 ? "-" : ""}${count}d${sides}${match[3] ?? ""}`,
        rolls,
        subtotal,
      });
      total += subtotal;
      resolved.push(
        `${sign < 0 ? "-" : resolved.length ? "+" : ""}${count}d${sides}${match[3] ?? ""}`,
      );
      continue;
    }

    const source = match[4] ?? raw;
    const value = match[4] ? stats[source] : Number(match[5]);
    if (value === undefined || !Number.isFinite(value))
      throw new DiceFormulaError(`Стат «${source}» не найден`);
    const signedValue = value * sign;
    modifiers.push({ source, value: signedValue });
    total += signedValue;
    resolved.push(
      `${sign < 0 ? "-" : resolved.length ? "+" : ""}${Math.abs(value)}`,
    );
  }

  return {
    formula,
    resolvedFormula: resolved.join(" "),
    terms,
    modifiers,
    total,
    ...(label ? { label } : {}),
  };
}

/**
 * Applies one semantic to every supported formula: normal rolls one complete
 * pool; advantage/disadvantage roll the complete pool twice and keep the
 * higher/lower total. Ties deterministically keep the first pool.
 */
export function rollFormulaWithMode(
  formula: string,
  stats: Record<string, number>,
  rollMode: RollMode,
  randomInt: (maxExclusive: number) => number = (max) =>
    Math.floor(Math.random() * max),
  label?: string,
): DiceResult {
  const first = rollFormula(formula, stats, randomInt, label);
  if (rollMode === "NORMAL")
    return decorateSemanticOutcome({ ...first, rollMode });
  const second = rollFormula(formula, stats, randomInt, label);
  const selectedPool =
    rollMode === "ADVANTAGE"
      ? second.total > first.total
        ? 1
        : 0
      : second.total < first.total
        ? 1
        : 0;
  const selected = selectedPool === 0 ? first : second;
  return decorateSemanticOutcome({
    ...selected,
    rollMode,
    poolTotals: [first.total, second.total],
    selectedPool,
  });
}
