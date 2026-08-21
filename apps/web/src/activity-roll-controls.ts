import { rollModeLabel } from "./roll-modifier-keys";
import type { RollMode } from "./roll-mode";
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

export function physicalRollMessage(
  label: string,
  bonus: number,
  mode: RollMode = "NORMAL",
): string {
  const signed = bonus >= 0 ? `+${bonus}` : String(bonus);
  /**
   * UIX-456: зажатая клавиша обязана дойти и до настоящего кубика. Система
   * результата физического броска не считает, но сказать «киньте два и
   * возьмите больший» она может — иначе Ctrl над физическим броском тихо
   * ничего не делает, и человек узнаёт об этом посреди игры.
   */
  const instruction =
    mode === "ADVANTAGE"
      ? "Бросьте два d20, возьмите больший"
      : mode === "DISADVANTAGE"
        ? "Бросьте два d20, возьмите меньший"
        : "Бросьте d20";
  const suffix = rollModeLabel(mode) ? ` · ${rollModeLabel(mode)}` : "";
  return `Физический бросок · ${label}${suffix} · бонус ${signed}. ${instruction} и прибавьте ${signed} к значению куба.`;
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

export function rollLogHistoryActionLabel(collapsed: boolean): string {
  return collapsed ? "Показать больше" : "Показать меньше";
}

export interface RollLogHistoryPresentation {
  actionLabel: string;
  showControl: boolean;
  truncatedLabel: string | null;
  visibleEntryCount: number;
}

/**
 * UIX-467: one pure description of the history disclosure state keeps the
 * rendered count, explanatory copy and button label in sync. The timeline
 * contains date dividers as well as events, so this deliberately operates on
 * its final entry count rather than on raw chat-message totals.
 */
export function rollLogHistoryPresentation(
  totalEntryCount: number,
  collapsed: boolean,
): RollLogHistoryPresentation {
  const visibleEntryCount = collapsed
    ? Math.min(totalEntryCount, ROLL_LOG_COLLAPSED_ENTRY_COUNT)
    : totalEntryCount;
  const isTruncated = visibleEntryCount < totalEntryCount;

  return {
    actionLabel: rollLogHistoryActionLabel(collapsed),
    showControl: totalEntryCount > ROLL_LOG_COLLAPSED_ENTRY_COUNT,
    truncatedLabel: isTruncated
      ? `Показаны последние ${visibleEntryCount} из ${totalEntryCount}.`
      : null,
    visibleEntryCount,
  };
}

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
  mode: RollMode = "NORMAL",
) {
  return {
    body: physicalRollMessage(label, bonus, mode),
    characterId,
  };
}
