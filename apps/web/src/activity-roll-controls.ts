import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import type { ActivityEvent } from "./activity-feed";

export type ActivityFilter = "ROLLS" | "STORY" | "REFERENCE";

export function charactersAvailableForActivityRolls(
  snapshot: GameSnapshot,
): CharacterDto[] {
  if (snapshot.me.role === "GM") return snapshot.characters;
  return snapshot.characters.filter(
    (character) =>
      character.id === snapshot.me.characterId ||
      character.ownerMembershipId === snapshot.me.id,
  );
}

export function filterActivityEvents(
  events: readonly ActivityEvent[],
  enabled: ReadonlySet<ActivityFilter>,
): ActivityEvent[] {
  return events.filter((event) => {
    if (event.type === "STORY_POST") return enabled.has("STORY");
    if (event.message.kind === "DICE" || event.stream === "ROLLS")
      return enabled.has("ROLLS");
    if (event.stream === "STORY") return enabled.has("STORY");
    return enabled.has("REFERENCE");
  });
}

export function physicalRollMessage(label: string, bonus: number): string {
  const signed = bonus >= 0 ? `+${bonus}` : String(bonus);
  return `Физический бросок · ${label} · бонус ${signed}. Бросьте d20 и прибавьте ${signed} к значению куба.`;
}

export function physicalRollBonus(message: string): string | null {
  if (!message.startsWith("Физический бросок")) return null;
  return message.match(/·\s*бонус\s+([+-]\d+)\./u)?.[1] ?? null;
}

export function physicalDiceStorageKey(membershipId: string): string {
  return `arken:physical-dice:${membershipId}`;
}

export function formulaBonus(
  formula: string,
  stats: Readonly<Record<string, number>>,
): number {
  const withoutDice = formula.replace(/\b\d*d\d+\b/gi, "0");
  return withoutDice
    .split(/(?=[+-])/)
    .map((term) => term.trim())
    .reduce((total, term) => {
      if (!term) return total;
      const sign = term.startsWith("-") ? -1 : 1;
      const key = term.replace(/^[+-]/, "").trim();
      const value = Number(key);
      if (Number.isFinite(value)) return total + sign * value;
      return total + sign * (stats[key] ?? 0);
    }, 0);
}

export function physicalRollChatRequest(
  label: string,
  bonus: number,
  characterId: string,
) {
  return {
    body: physicalRollMessage(label, bonus),
    characterId,
  };
}
