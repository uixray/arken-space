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
              return modifier.type === "CHARACTERISTIC" &&
                modifier.key === "spirit"
                ? { ...modifier, key: "willpower" }
                : modifier;
            })
          : action.modifiers;
        return { ...action, modifiers };
      })
    : data.rollActions;
  return { ...data, rollActions };
}
