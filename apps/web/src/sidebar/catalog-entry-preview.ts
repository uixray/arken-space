import type { CatalogEntryDto } from "@arken/contracts";

/**
 * UIX-391: builds a two-line RollButton-style preview formula for a catalog
 * entry's first roll action, reusing the same raw-stat-key convention
 * humanizeFormula() already understands (see formula-display.ts) — this way
 * a picker row and an assigned entry's roll button read identically.
 *
 * Kept dependency-free (no React/UI imports) so it can be unit tested
 * without pulling in @gravity-ui/uikit's CSS, which vitest's node
 * environment can't transform (see RollButton.test.tsx for the same
 * constraint on the presentational side).
 */
export function previewFormula(entry: CatalogEntryDto): string {
  const actions = entry.data.rollActions;
  if (!actions || actions.length === 0) return "Без броска";
  const [first] = [...actions].sort((a, b) => a.order - b.order);
  if (!first) return "Без броска";
  const modifier = first.modifiers[0];
  if (modifier?.type === "CHARACTERISTIC")
    return `${first.dice} + ${modifier.key}`;
  if (first.modifiers.length) return `${first.dice} + модификаторы`;
  return first.dice;
}
