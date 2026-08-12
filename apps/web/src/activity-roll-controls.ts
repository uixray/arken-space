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

/** UIX-372: how many timeline entries stay visible once the roll log is
 * collapsed to a compact height. */
export const ROLL_LOG_COLLAPSED_ENTRY_COUNT = 8;

export function rollLogCollapsedStorageKey(membershipId: string): string {
  return `arken:roll-log-collapsed:${membershipId}`;
}

export function readRollLogCollapsed(
  storage: Pick<Storage, "getItem">,
  membershipId: string,
): boolean {
  try {
    return storage.getItem(rollLogCollapsedStorageKey(membershipId)) === "true";
  } catch {
    return false;
  }
}

export function writeRollLogCollapsed(
  storage: Pick<Storage, "setItem">,
  membershipId: string,
  collapsed: boolean,
) {
  try {
    storage.setItem(
      rollLogCollapsedStorageKey(membershipId),
      String(collapsed),
    );
  } catch {
    // A blocked or full localStorage must not make the game unusable.
  }
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
