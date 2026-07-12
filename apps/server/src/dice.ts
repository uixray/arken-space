import type { DiceResult, DiceTerm } from "@arken/contracts";

const termPattern = /^(?:(\d{0,3})d(\d{1,4})|([a-zA-Z_][a-zA-Z0-9_]*)|(\d+))$/;

export class DiceFormulaError extends Error {}

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
      const subtotal = rolls.reduce((sum, value) => sum + value, 0) * sign;
      terms.push({
        notation: `${sign < 0 ? "-" : ""}${count}d${sides}`,
        rolls,
        subtotal,
      });
      total += subtotal;
      resolved.push(
        `${sign < 0 ? "-" : resolved.length ? "+" : ""}${count}d${sides}`,
      );
      continue;
    }

    const source = match[3] ?? raw;
    const value = match[3] ? stats[source] : Number(match[4]);
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
