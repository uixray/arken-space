import { arkenSystem } from "@arken/system";

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
