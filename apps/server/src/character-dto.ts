import type { CharacterDto } from "@arken/contracts";
import { arkenSystem } from "@arken/system";
import { characterCatalogEntries, characters } from "@arken/db";
import {
  normalizeLegacyEntryData,
  normalizeLegacyStats,
} from "./entry-data.js";

type CharacterRow = typeof characters.$inferSelect;
type CharacterEntryRow = typeof characterCatalogEntries.$inferSelect;

function normalizeWalletValue(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value)));
}

export function normalizeCharacterWallet(
  wallet: Partial<CharacterDto["wallet"]> | null | undefined,
): CharacterDto["wallet"] {
  return {
    gold: normalizeWalletValue(wallet?.gold),
    silver: normalizeWalletValue(wallet?.silver),
    copper: normalizeWalletValue(wallet?.copper),
    sp: normalizeWalletValue(wallet?.sp),
  };
}

export function characterDto(
  character: CharacterRow,
  entries: CharacterEntryRow[],
  controllerMembershipIds: string[] = [],
): CharacterDto {
  const wallet =
    character.wallet && typeof character.wallet === "object"
      ? character.wallet
      : undefined;
  return {
    id: character.id,
    name: character.name,
    ownerMembershipId: character.ownerMembershipId,
    controllerMembershipIds,
    portraitAssetId: character.portraitAssetId,
    stats: normalizeLegacyStats(character.stats),
    skills: (() => {
      const existing = Array.isArray(character.skills) ? character.skills : [];
      const keys = new Set(existing.map((skill) => skill.key));
      return [
        ...existing,
        ...arkenSystem.starterSkills.filter((skill) => !keys.has(skill.key)),
      ];
    })(),
    spells: Array.isArray(character.spells) ? character.spells : [],
    notes: character.notes,
    backstory: character.backstory,
    inventory: Array.isArray(character.inventory) ? character.inventory : [],
    resources:
      character.resources && typeof character.resources === "object"
        ? character.resources
        : {},
    wallet: normalizeCharacterWallet(wallet),
    entries: entries.map((entry) => ({
      id: entry.id,
      sourceCatalogEntryId: entry.sourceCatalogEntryId,
      kind: entry.kind,
      name: entry.name,
      description: entry.description,
      data: normalizeLegacyEntryData(
        entry.data,
      ) as CharacterDto["entries"][number]["data"],
      revision: entry.revision,
    })),
    revision: character.revision,
  };
}
