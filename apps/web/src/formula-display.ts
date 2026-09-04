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
const escapePattern = (key: string) =>
  key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
export function humanizeFormula(
  formula: string,
  statLabels: Readonly<Record<string, string>>,
): string {
  if (!formula) return formula;
  const keys = Object.keys(statLabels);
  if (keys.length === 0) return formula;
  // Longest key first so a prefix never shadows a longer identifier.
  const pattern = new RegExp(
    `\\b(${keys
      .sort((a, b) => b.length - a.length)
      .map(escapePattern)
      .join("|")})\\b`,
    "g",
  );
  return formula.replace(pattern, (token) => statLabels[token] ?? token);
}
