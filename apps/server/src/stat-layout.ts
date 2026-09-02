import { formulaReferencesStatKey, type StatLayout } from "@arken/contracts";
import {
  isSystemRegenStatKey,
  starterStatLayout,
  SYSTEM_REGEN_STAT_KEYS,
} from "@arken/system";

const SYSTEM_STAT_GROUP_ID = "combat";
const starterCombatGroup = starterStatLayout.find(
  (group) => group.id === SYSTEM_STAT_GROUP_ID,
);
const starterRowsByKey = new Map(
  starterStatLayout.flatMap((group) =>
    group.rows.map((row) => [row.key, row] as const),
  ),
);
const canonicalSystemRegenRows = [...SYSTEM_REGEN_STAT_KEYS].map((key) => {
  const row = starterRowsByKey.get(key);
  if (!row || row.source !== "STAT")
    throw new Error(
      `Системная строка регена ${key} отсутствует в стартовой STAT-раскладке`,
    );
  return row;
});

/**
 * UIX-424, шаги 5-6 — что мастеру можно менять в раскладке.
 *
 * Раскладка присылается целиком, значит удалить строку можно, просто не
 * прислав её. Это тихая операция: ни клиент, ни сервер не отличают «мастер
 * удалил строку» от «клиент отстал и прислал старую раскладку». А удаление
 * характеристики, на которую ссылается формула навыка, ломает бросок **в
 * момент броска на игре**, а не при удалении.
 *
 * Поэтому удаление проходит только тогда, когда на строку никто не ссылается,
 * и отказ несёт список того, что сломалось бы (`findStatKeyReferences`).
 *
 * Смена источника у существующего ключа запрещена всегда: строка `STAT` берёт
 * число из `characters.stats`, `RESOURCE` — пул из `characters.resources`.
 * Переключение меняет, откуда берётся значение, и прежнее просто перестаёт
 * показываться, никуда не делось и никем не замечено.
 */
export interface StatKeyReference {
  kind: "SKILL" | "SPELL" | "CATALOG_ENTRY" | "CHARACTER_ENTRY";
  /** Имя навыка или записи — то, что мастеру предстоит поправить. */
  name: string;
  /** Чей это навык. У записи общего каталога владельца нет. */
  owner?: string;
}

/**
 * Повод отказа лежит в поле `error`, как у остальных маршрутов
 * (`CAMPAIGN_CONFLICT`, `GM_REQUIRED`): клиент разбирает отказы одним способом,
 * и своё имя поля здесь означало бы, что этот отказ мимо общего разбора.
 */
export type StatLayoutRejection =
  | { error: "SYSTEM_STAT_ROW_REQUIRED"; key: string }
  | { error: "STAT_SOURCE_CHANGED"; key: string }
  | {
      error: "STAT_ROW_REFERENCED";
      key: string;
      references: StatKeyReference[];
    };

/**
 * Всё, что может сослаться на характеристику. Собирается вызывающим из базы —
 * функция остаётся чистой и проверяемой без стенда.
 */
export interface StatReferenceSources {
  characters: readonly {
    name: string;
    skills: readonly { name: string; formula?: string }[];
    spells: readonly { name: string; formula?: string }[];
    entries: readonly { name: string; data: unknown }[];
  }[];
  catalogEntries: readonly { name: string; data: unknown }[];
}

/**
 * Возвращает системные строки регена в видимую боевую группу.
 *
 * Старые кампании могли сохранить валидную partial-layout без этих строк или
 * с ними в другой группе/source. Такие данные нельзя целиком заменять
 * стартовой раскладкой: пользовательские строки, подписи и порядок — данные
 * мастера. Поэтому нормализация меняет только строки с точными системными
 * ключами, сохраняет их подписи и добавляет отсутствующие со стартовыми.
 */
export function normalizeSystemRegenStatRows(layout: StatLayout): StatLayout {
  const existingSystemRows = new Map(
    layout.flatMap((group) =>
      group.rows
        .filter((row) => isSystemRegenStatKey(row.key))
        .map((row) => [row.key, row] as const),
    ),
  );
  const systemKeysAlreadyInCombat = new Set<string>();

  const normalized = layout.map((group) => {
    if (group.id !== SYSTEM_STAT_GROUP_ID)
      return {
        ...group,
        rows: group.rows.filter((row) => !isSystemRegenStatKey(row.key)),
      };

    return {
      ...group,
      rows: group.rows.map((row) => {
        if (!isSystemRegenStatKey(row.key)) return row;
        systemKeysAlreadyInCombat.add(row.key);
        return { ...row, source: "STAT" as const };
      }),
    };
  });

  const rowsToAppend = canonicalSystemRegenRows
    .filter((row) => !systemKeysAlreadyInCombat.has(row.key))
    .map((row) => ({
      ...(existingSystemRows.get(row.key) ?? row),
      source: "STAT" as const,
    }));
  const combat = normalized.find((group) => group.id === SYSTEM_STAT_GROUP_ID);
  if (combat) {
    combat.rows.push(...rowsToAppend);
    return normalized;
  }

  return [
    ...normalized,
    {
      id: SYSTEM_STAT_GROUP_ID,
      label: starterCombatGroup?.label ?? "Боевые характеристики",
      rows: rowsToAppend,
    },
  ];
}

/**
 * Ссылки на характеристику бывают двух видов, и оба надо найти.
 *
 * Формула навыка ссылается **текстом**: `1d20 + sila`. Модификатор способности
 * ссылается **полем**: `{ type: "CHARACTERISTIC", key: "sila" }`. Проверить
 * только формулы значило бы разрешить удаление характеристики, на которой
 * держится половина способностей каталога.
 */
export function findStatKeyReferences(
  key: string,
  sources: StatReferenceSources,
): StatKeyReference[] {
  if (!key) return [];
  const found: StatKeyReference[] = [];

  for (const character of sources.characters) {
    for (const skill of character.skills)
      if (formulaReferencesStatKey(skill.formula, key))
        found.push({ kind: "SKILL", name: skill.name, owner: character.name });
    for (const spell of character.spells)
      if (formulaReferencesStatKey(spell.formula, key))
        found.push({ kind: "SPELL", name: spell.name, owner: character.name });
    for (const entry of character.entries)
      if (entryDataReferencesStatKey(entry.data, key))
        found.push({
          kind: "CHARACTER_ENTRY",
          name: entry.name,
          owner: character.name,
        });
  }

  for (const entry of sources.catalogEntries)
    if (entryDataReferencesStatKey(entry.data, key))
      found.push({ kind: "CATALOG_ENTRY", name: entry.name });

  return found;
}

/**
 * Данные записи каталога читаются как неизвестное значение, а не через схему:
 * запись могла быть сохранена более старой версией, и `entryDataSchema.parse`
 * здесь означал бы «не смогли разобрать — значит ссылок нет». Для проверки,
 * защищающей от поломки на игре, это худший из возможных ответов.
 */
function entryDataReferencesStatKey(data: unknown, key: string): boolean {
  if (!data || typeof data !== "object") return false;
  const actions = (data as { rollActions?: unknown }).rollActions;
  if (!Array.isArray(actions)) return false;
  return actions.some((action) => {
    const modifiers = (action as { modifiers?: unknown } | null)?.modifiers;
    return (
      Array.isArray(modifiers) &&
      modifiers.some(
        (modifier) =>
          (modifier as { type?: unknown } | null)?.type === "CHARACTERISTIC" &&
          (modifier as { key?: unknown }).key === key,
      )
    );
  });
}

/**
 * Строки, которых в новой раскладке не стало. Порядок и группы не важны:
 * перенос строки между группами — не удаление.
 */
export function removedStatKeys(
  current: StatLayout,
  next: StatLayout,
): string[] {
  const kept = new Set(
    next.flatMap((group) => group.rows.map((row) => row.key)),
  );
  return current
    .flatMap((group) => group.rows.map((row) => row.key))
    .filter((key) => !kept.has(key));
}

export function rejectDestructiveLayoutChange(
  current: StatLayout,
  next: StatLayout,
  sources: StatReferenceSources,
): StatLayoutRejection | null {
  const currentKeys = new Set(
    current.flatMap((group) => group.rows.map((row) => row.key)),
  );
  const nextRows = new Map(
    next.flatMap((group) =>
      group.rows.map((row) => [row.key, { groupId: group.id, row }] as const),
    ),
  );
  for (const { key } of canonicalSystemRegenRows) {
    const replacement = nextRows.get(key);
    // Прямые вызовы функции со старой раскладкой без системных строк остаются
    // совместимыми. В маршруте current всегда проходит resolveStatLayout и
    // содержит обе строки, поэтому их удаление всё равно fail-closed.
    if (!currentKeys.has(key) && !replacement) continue;
    if (
      !replacement ||
      replacement.groupId !== SYSTEM_STAT_GROUP_ID ||
      replacement.row.source !== "STAT"
    )
      return { error: "SYSTEM_STAT_ROW_REQUIRED", key };
  }

  for (const key of removedStatKeys(current, next)) {
    const references = findStatKeyReferences(key, sources);
    if (references.length > 0)
      return { error: "STAT_ROW_REFERENCED", key, references };
  }

  const nextRowsByKey = new Map(
    next.flatMap((group) => group.rows.map((row) => [row.key, row] as const)),
  );
  for (const group of current)
    for (const row of group.rows) {
      const replacement = nextRowsByKey.get(row.key);
      if (replacement && replacement.source !== row.source)
        return { error: "STAT_SOURCE_CHANGED", key: row.key };
    }
  return null;
}
