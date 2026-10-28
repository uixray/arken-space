import type { CatalogEntryDto } from "@arken/contracts";

type RollAction = NonNullable<CatalogEntryDto["data"]["rollActions"]>[number];

export type CatalogEntryPreviewContext = {
  characterStats?: Readonly<Record<string, number>>;
  statLabels?: Readonly<Record<string, string>>;
  skillModifiers?: readonly {
    scope: "CATALOG" | "CHARACTER_ENTRY" | "LEGACY";
    key: string;
    name: string;
    value?: number;
  }[];
};

function modifierName(
  modifier: RollAction["modifiers"][number],
  context: CatalogEntryPreviewContext,
): string {
  switch (modifier.type) {
    case "CHARACTERISTIC":
      return context.statLabels?.[modifier.key] ?? modifier.key;
    case "ENTRY_VALUE":
      return modifier.key;
    case "SKILL":
      return (
        context.skillModifiers?.find(
          (skill) =>
            skill.scope === modifier.scope && skill.key === modifier.key,
        )?.name ?? `навык ${modifier.key}`
      );
    case "CONSTANT":
      return String(modifier.value);
    case "FORMULA":
      return `формула ${modifier.formula}`;
  }
}

/**
 * Shared card preview contract. It only aggregates modifier values whose
 * source is already available to the viewer; unresolved sources stay named
 * rather than being guessed as zero. FORMULA sources deliberately remain
 * descriptive here—the server remains the execution resolver.
 */
export function previewRollActionFormula(
  action: RollAction,
  entryValues: Readonly<Record<string, number>> | undefined,
  context: CatalogEntryPreviewContext = {},
): string {
  // Older saved entries may predate `modifiers`; treat that shape like an
  // empty list rather than crashing card previews while preserving other data.
  const modifiers = Array.isArray(action.modifiers) ? action.modifiers : [];
  if (!modifiers.length) return action.dice;

  const resolved = modifiers.map((modifier) => {
    switch (modifier.type) {
      case "CHARACTERISTIC": {
        const value = context.characterStats?.[modifier.key];
        return typeof value === "number" && Number.isFinite(value)
          ? value
          : undefined;
      }
      case "ENTRY_VALUE": {
        const value = entryValues?.[modifier.key];
        return typeof value === "number" && Number.isFinite(value)
          ? value
          : undefined;
      }
      case "SKILL": {
        const value = context.skillModifiers?.find(
          (skill) =>
            skill.scope === modifier.scope && skill.key === modifier.key,
        )?.value;
        return typeof value === "number" && Number.isFinite(value)
          ? value
          : undefined;
      }
      case "CONSTANT":
        return Number.isFinite(modifier.value) ? modifier.value : undefined;
      case "FORMULA":
        return undefined;
    }
  });

  if (resolved.every((value): value is number => value !== undefined)) {
    const total = resolved.reduce((sum, value) => sum + value, 0);
    return `${action.dice} ${total < 0 ? "-" : "+"} ${Math.abs(total)}`;
  }

  return `${action.dice} + ${modifiers
    .map((modifier) => modifierName(modifier, context))
    .join(" + ")}`;
}

/**
 * UIX-391: preview the first roll action in the catalog picker. The character
 * sheet can pass its existing stat values; without that context the shared
 * preview leaves source names visible instead of guessing a numeric bonus.
 */
export function previewFormula(
  entry: CatalogEntryDto,
  context: CatalogEntryPreviewContext = {},
): string {
  if (
    entry.kind === "SKILL" &&
    typeof entry.data.skillValue === "number" &&
    Number.isFinite(entry.data.skillValue)
  ) {
    const value = entry.data.skillValue;
    return `1d20 ${value < 0 ? "-" : "+"} ${Math.abs(value)}`;
  }
  const actions = entry.data.rollActions;
  if (!actions || actions.length === 0) return "Без броска";
  const [first] = [...actions].sort((a, b) => a.order - b.order);
  if (!first) return "Без броска";
  return previewRollActionFormula(first, entry.data.values, context);
}
