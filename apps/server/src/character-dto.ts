import {
  statLayoutSchema,
  type CharacterDto,
  type StatLayout,
} from "@arken/contracts";
import { starterStatLayout } from "@arken/system";
import { normalizeSystemRegenStatRows } from "./stat-layout.js";
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

/**
 * Ресурсы персонажа как запись пулов.
 *
 * Колонка — `jsonb`, то есть может оказаться чем угодно: null у старой записи,
 * не объектом после правки руками. Списание ресурса читает её дважды — при
 * проверке остатка и при вычитании, — и две разные защиты «на всякий случай»
 * рано или поздно разошлись бы.
 */
export function normalizeCharacterResources(
  resources: unknown,
): Record<string, { current: number; maximum?: number }> {
  return resources && typeof resources === "object"
    ? (resources as Record<string, { current: number; maximum?: number }>)
    : {};
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

export function resolveCharacterStatLayout(
  override: unknown,
  campaignDefault: unknown,
): StatLayout {
  const campaignParsed = statLayoutSchema.safeParse(campaignDefault);
  const campaignLayout =
    campaignParsed.success && campaignParsed.data.length > 0
      ? campaignParsed.data
      : statLayoutSchema.parse(starterStatLayout);
  const ownParsed = statLayoutSchema.safeParse(override);
  const effective =
    ownParsed.success && ownParsed.data.length > 0
      ? ownParsed.data
      : campaignLayout;
  return normalizeSystemRegenStatRows(effective);
}

/**
 * Значения характеристик, по которым считаются броски.
 *
 * Строку раскладки (кампании или своего персонажа) добавляют без значения —
 * лист показывает её как 0, а движок формул ищет `stats[key]` напрямую и
 * отвечал «Стат не найден». Отсутствующее значение STAT-строки эффективной
 * раскладки — 0, как на экране; сохранённые значения не трогаются.
 */
export function characterRollStats(
  character: Pick<CharacterRow, "stats" | "statLayout">,
  campaignDefaultLayout: unknown,
): Record<string, number> {
  const stats = normalizeLegacyStats(character.stats);
  for (const group of resolveCharacterStatLayout(
    character.statLayout,
    campaignDefaultLayout,
  ))
    for (const row of group.rows)
      if (row.source === "STAT" && !Number.isFinite(stats[row.key]))
        stats[row.key] = 0;
  return stats;
}

export function characterDto(
  character: CharacterRow,
  entries: CharacterEntryRow[],
  controllerMembershipIds: string[] = [],
  campaignDefaultLayout: unknown,
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
    stats: characterRollStats(character, campaignDefaultLayout),
    statLayout: resolveCharacterStatLayout(
      character.statLayout,
      campaignDefaultLayout,
    ),
    // UIX-706: стандартные навыки больше не подставляются при каждом чтении —
    // иначе удалённый навык возвращался. Навыки теперь строки раскладки.
    skills: Array.isArray(character.skills) ? character.skills : [],
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
    lifecycle: character.lifecycle,
    archivedAt: character.archivedAt
      ? character.archivedAt.toISOString()
      : null,
    archivedByMembershipId: character.archivedByMembershipId,
  };
}
