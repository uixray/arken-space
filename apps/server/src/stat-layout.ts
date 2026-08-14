import type { StatLayout } from "@arken/contracts";

/**
 * UIX-424, шаг 5 — что мастеру можно менять в раскладке, пока проверки ссылок
 * из формул нет.
 *
 * Раскладка присылается целиком, значит удалить строку можно, просто не
 * прислав её. Это тихая операция: ни клиент, ни сервер не отличают «мастер
 * удалил строку» от «клиент отстал и прислал старую раскладку». А удаление
 * характеристики, на которую ссылается формула навыка, ломает бросок **в
 * момент броска на игре**, а не при удалении.
 *
 * Поэтому здесь набор ключей может только расти. Проверка ссылок появится на
 * шаге 6 и снимет это ограничение осознанно — вместе со списком того, что
 * сломается.
 *
 * Смена источника у существующего ключа запрещена по той же причине: строка
 * `STAT` берёт число из `characters.stats`, `RESOURCE` — пул из
 * `characters.resources`. Переключение меняет, откуда берётся значение, и
 * прежнее просто перестаёт показываться, никуда не делось и никем не
 * замечено.
 */
export type StatLayoutRejection =
  | { reason: "STAT_ROW_REMOVED"; key: string }
  | { reason: "STAT_SOURCE_CHANGED"; key: string };

export function rejectDestructiveLayoutChange(
  current: StatLayout,
  next: StatLayout,
): StatLayoutRejection | null {
  const nextRows = new Map(
    next.flatMap((group) => group.rows.map((row) => [row.key, row] as const)),
  );
  for (const group of current)
    for (const row of group.rows) {
      const replacement = nextRows.get(row.key);
      if (!replacement) return { reason: "STAT_ROW_REMOVED", key: row.key };
      if (replacement.source !== row.source)
        return { reason: "STAT_SOURCE_CHANGED", key: row.key };
    }
  return null;
}
