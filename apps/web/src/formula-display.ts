import { arkenSystem } from "@arken/system";

/**
 * UIX-389: dice formulas are stored/executed with raw stat keys (e.g.
 * "1d20 + agility") so the server never has to localize anything. Players
 * should never see the technical key, though — this maps every known stat
 * key inside a formula to its localized label ("1d20 + Ловкость") while
 * leaving dice notation, operators, numbers, and any unrecognized token
 * untouched.
 *
 * Only ever change what is DISPLAYED. The raw formula string must still be
 * the one sent to onRoll/submitCharacterRoll/onAction — humanizing is purely
 * a presentation step.
 */
const STAT_LABEL_BY_KEY: ReadonlyMap<string, string> = new Map(
  arkenSystem.stats.map((stat) => [stat.key, stat.label]),
);

// Longest key first so a key that is a prefix/substring of another
// (there are none today, but this keeps the function safe if one is added)
// never partially shadows the longer match.
const STAT_KEY_PATTERN = new RegExp(
  `\\b(${[...STAT_LABEL_BY_KEY.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\b`,
  "g",
);

/**
 * Replace every recognized stat-key token in a dice formula with its
 * localized label. Word-boundary matching (`\b`) ensures a key is never
 * humanized when it merely appears as a substring of an unrelated
 * identifier (e.g. a hypothetical "strengthened" token stays untouched).
 *
 * - Formulas with no stat tokens are returned unchanged.
 * - Unknown/unrecognized tokens (flat modifiers, future non-stat
 *   variables, typos) are left as-is rather than crashing or being
 *   silently dropped.
 */
export function humanizeFormula(formula: string): string {
  if (!formula) return formula;
  if (STAT_LABEL_BY_KEY.size === 0) return formula;
  return formula.replace(
    STAT_KEY_PATTERN,
    (token) => STAT_LABEL_BY_KEY.get(token) ?? token,
  );
}
