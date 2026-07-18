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
  return stats;
}

export function normalizeLegacyEntryData(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const data = value as Record<string, unknown>;
  const rollActions = Array.isArray(data.rollActions)
    ? data.rollActions.map((candidate) => {
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
        return { ...action, modifiers };
      })
    : data.rollActions;
  return { ...data, rollActions };
}
