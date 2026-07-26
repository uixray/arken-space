import type { CharacterDto, GameSnapshot } from "@arken/contracts";
import { normalizeWallet } from "./wallet";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Counter endpoints used to return a raw database row without `entries`.
 * Preserve canonical client-only/joined fields while accepting that response,
 * and reject idempotency placeholders such as `{ duplicate: true }`.
 */
export function mergeCharacterMutationResponse(
  base: CharacterDto,
  response: unknown,
): CharacterDto | null {
  const next = object(response);
  if (
    next?.id !== base.id ||
    typeof next.revision !== "number" ||
    !Number.isInteger(next.revision) ||
    next.revision < base.revision
  )
    return null;

  return {
    ...base,
    ...(next as Partial<CharacterDto>),
    stats:
      next.stats && typeof next.stats === "object"
        ? { ...base.stats, ...(next.stats as Record<string, number>) }
        : base.stats,
    skills: Array.isArray(next.skills) ? next.skills : base.skills,
    spells: Array.isArray(next.spells) ? next.spells : base.spells,
    inventory: Array.isArray(next.inventory) ? next.inventory : base.inventory,
    resources:
      next.resources && typeof next.resources === "object"
        ? (next.resources as CharacterDto["resources"])
        : base.resources,
    wallet: normalizeWallet(
      next.wallet && typeof next.wallet === "object"
        ? (next.wallet as Partial<CharacterDto["wallet"]>)
        : base.wallet,
    ),
    entries: Array.isArray(next.entries) ? next.entries : base.entries,
  };
}

/**
 * An HTTP PATCH response can settle after realtime already delivered a newer
 * character. Prefer the state with the highest entity revision; on an equal
 * revision, realtime/current state is already canonical and wins as well.
 */
export function applyCharacterMutationToSnapshot(
  current: GameSnapshot | null,
  updated: CharacterDto,
): GameSnapshot | null {
  if (!current) return current;
  const existing = current.characters.find(
    (character) => character.id === updated.id,
  );
  if (!existing || existing.revision >= updated.revision) return current;
  return {
    ...current,
    characters: current.characters.map((character) =>
      character.id === updated.id ? updated : character,
    ),
  };
}

/**
 * Full snapshots can overtake an HTTP counter response on reconnect. Never
 * regress a character revision, and discard globally older snapshots.
 */
export function reconcileGameSnapshot(
  current: GameSnapshot | null,
  incoming: GameSnapshot,
): GameSnapshot {
  if (
    !current ||
    current.campaign.id !== incoming.campaign.id ||
    current.me.id !== incoming.me.id
  )
    return incoming;
  if (incoming.snapshotVersion < current.snapshotVersion) return current;

  const currentCharacters = new Map(
    current.characters.map((character) => [character.id, character]),
  );
  return {
    ...incoming,
    characters: incoming.characters.map((character) => {
      const existing = currentCharacters.get(character.id);
      return existing && existing.revision > character.revision
        ? existing
        : character;
    }),
  };
}
