import { eq, inArray } from "drizzle-orm";
import { catalogEntries, characterCatalogEntries, characters } from "@arken/db";
import { RESOURCE_REGEN_STAT } from "@arken/system";
import { resolveStatLayout } from "./snapshot.js";
import type { StatReferenceSources } from "./stat-layout.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/**
 * Character play rules shared by the campaign and counter routes: wallet and
 * resource change lines, rests, and the stat references a layout edit must
 * keep valid. Moved out of routes.ts unchanged.
 */
const walletLabels = {
  gold: "золото",
  silver: "серебро",
  copper: "медь",
  sp: "СП",
} as const;

export type Wallet = Record<keyof typeof walletLabels, number>;

export type WalletAuditSystemData = {
  type: "WALLET_AUDIT";
  before: Wallet;
  after: Wallet;
  lastAt: string;
  operationCount: number;
};

export const WALLET_AUDIT_BURST_MS = 5_000;

export function isWalletAuditSystemData(
  value: unknown,
): value is WalletAuditSystemData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<WalletAuditSystemData>;
  return (
    data.type === "WALLET_AUDIT" &&
    typeof data.lastAt === "string" &&
    typeof data.operationCount === "number" &&
    Boolean(data.before) &&
    Boolean(data.after)
  );
}

export function formatWalletChanges(before: Wallet, after: Wallet) {
  const changes = Object.entries(walletLabels)
    .filter(
      ([key]) => before[key as keyof Wallet] !== after[key as keyof Wallet],
    )
    .map(([key, label]) => {
      const currency = key as keyof Wallet;
      return `${label} ${before[currency]} → ${after[currency]}`;
    });
  return changes.length > 0 ? `кошелёк: ${changes.join(", ")}` : "";
}

export type Resources = Record<
  string,
  {
    current: number;
    maximum?: number;
    description?: string;
    imageAssetId?: string | null;
    recoverable?: boolean;
    restAmount?: number;
  }
>;

function formatResourceValue(value: Resources[string] | undefined) {
  if (!value) return "удалён";
  return value.maximum === undefined
    ? String(value.current)
    : `${value.current}/${value.maximum}`;
}

/**
 * UIX-476 — имя ресурса принадлежит раскладке кампании, а не ключу JSON.
 * Строка могла быть удалена уже после создания ресурса, поэтому отсутствие
 * подписи штатно: formatter ниже оставляет сам ключ вместо пустого имени.
 */
export function resourceLabelsFromLayout(
  layout: ReturnType<typeof resolveStatLayout>,
): ReadonlyMap<string, string> {
  return new Map(
    layout.flatMap((group) =>
      group.rows
        .filter((row) => row.source === "RESOURCE")
        .map((row) => [row.key, row.label] as const),
    ),
  );
}

export function formatResourceChanges(
  before: Resources,
  after: Resources,
  labels: ReadonlyMap<string, string>,
) {
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  const changes = keys
    // The counter journal describes numerical changes only. Clients may
    // normalize optional image/recovery metadata while editing another
    // counter; comparing the whole JSON object would emit a phantom 0 → 0
    // card for every unchanged custom resource.
    .filter(
      (key) =>
        before[key]?.current !== after[key]?.current ||
        before[key]?.maximum !== after[key]?.maximum,
    )
    .map((key) => {
      const label = labels.get(key) ?? key;
      if (!before[key])
        return `${label}: добавлен ${formatResourceValue(after[key])}`;
      if (!after[key]) return `${label}: удалён`;
      return `${label}: ${formatResourceValue(before[key])} → ${formatResourceValue(after[key])}`;
    });
  return changes.length > 0 ? `ресурсы: ${changes.join(", ")}` : "";
}

/**
 * UIX-425 — отдых восстанавливает ресурсы на величину регена.
 *
 * Правило системы: длинный отдых даёт реген из карточки персонажа, короткий —
 * половину с округлением **вниз**, сверх максимума не восстанавливается.
 *
 * Было три расхождения сразу, и все в сторону «слишком щедро»: длинный отдых
 * восстанавливал до максимума, короткий давал четверть максимума вместо
 * половины регена, а округление шло вверх. У персонажа с маной 20 и регеном 9
 * длинный отдых давал +20 вместо +9 — ограничение ресурса в игре фактически
 * не работало.
 *
 * Для пользовательского ресурса величина задаётся restAmount; без неё и без
 * системной строки регена отдых ничего не восстанавливает.
 */
export function applyCharacterRest(
  resources: Resources,
  rest: "SHORT" | "LONG",
  stats: Record<string, number>,
): Resources {
  return Object.fromEntries(
    Object.entries(resources).map(([key, resource]) => {
      if (resource.recoverable === false) return [key, resource];

      const regenStat = RESOURCE_REGEN_STAT[key];
      const regen =
        resource.restAmount ?? (regenStat ? (stats[regenStat] ?? 0) : 0);
      if (regen <= 0) return [key, resource];

      const maximum = resource.maximum ?? resource.current;
      // Половина регена вниз: реген 9 при коротком отдыхе даёт 4, а не 5.
      const gain = rest === "LONG" ? regen : Math.floor(regen / 2);
      return [
        key,
        {
          ...resource,
          // Temporary points above maximum are not reduced by a rest.
          current: Math.max(
            resource.current,
            Math.min(maximum, resource.current + gain),
          ),
          maximum,
        },
      ];
    }),
  );
}

/**
 * UIX-424, шаг 6 — всё в кампании, что может сослаться на характеристику.
 *
 * Архивные персонажи включены намеренно: их навыки никуда не делись, и
 * характеристика, удалённая «потому что она только у архивного», сломает бросок
 * ровно в тот момент, когда персонажа вернут.
 */
export async function collectStatReferenceSources(
  db: Database,
  campaignId: string,
): Promise<StatReferenceSources> {
  const characterRows = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaignId));
  const entryRows = characterRows.length
    ? await db
        .select()
        .from(characterCatalogEntries)
        .where(
          inArray(
            characterCatalogEntries.characterId,
            characterRows.map((character) => character.id),
          ),
        )
    : [];
  const catalogRows = await db
    .select()
    .from(catalogEntries)
    .where(eq(catalogEntries.campaignId, campaignId));

  return {
    characters: characterRows.map((character) => ({
      name: character.name,
      skills: character.skills,
      spells: character.spells,
      entries: entryRows
        .filter((entry) => entry.characterId === character.id)
        .map((entry) => ({ name: entry.name, data: entry.data })),
    })),
    catalogEntries: catalogRows.map((entry) => ({
      name: entry.name,
      data: entry.data,
    })),
  };
}

/**
 * A PLAYER-owned layout only governs one character. Removal checks therefore
 * include that character's formulas/assigned entries plus campaign catalog
 * definitions, but never sibling characters' personal skills or spells.
 */
export async function collectCharacterStatReferenceSources(
  db: Database,
  campaignId: string,
  character: typeof characters.$inferSelect,
): Promise<StatReferenceSources> {
  const [entryRows, catalogRows] = await Promise.all([
    db
      .select()
      .from(characterCatalogEntries)
      .where(eq(characterCatalogEntries.characterId, character.id)),
    db
      .select()
      .from(catalogEntries)
      .where(eq(catalogEntries.campaignId, campaignId)),
  ]);
  return {
    characters: [
      {
        name: character.name,
        skills: character.skills,
        spells: character.spells,
        entries: entryRows.map((entry) => ({
          name: entry.name,
          data: entry.data,
        })),
      },
    ],
    catalogEntries: catalogRows.map((entry) => ({
      name: entry.name,
      data: entry.data,
    })),
  };
}
