import type { ActivityFilter } from "./activity-roll-controls";

/**
 * UIX-467: три галочки «Показывать» занимали строку в панели постоянно, хотя
 * трогают их редко. Они уезжают под кнопку с троеточием — но выключенный
 * фильтр обязан быть виден снаружи, иначе человек не поймёт, почему лента
 * пустеет, и будет искать пропажу в другом месте.
 */
export const ACTIVITY_FILTERS = ["ROLLS", "STORY", "REFERENCE"] as const;

export const ACTIVITY_FILTER_LABEL: Record<ActivityFilter, string> = {
  ROLLS: "Броски",
  STORY: "Сюжет",
  REFERENCE: "Справочные события",
};

export function hiddenActivityStreamCount(
  filters: ReadonlySet<ActivityFilter>,
): number {
  return ACTIVITY_FILTERS.filter((filter) => !filters.has(filter)).length;
}

/**
 * Полная подсказка: перечисляет, что именно выключено. Число рядом с
 * троеточием говорит «сколько», подсказка — «что»; дублировать счётчик ещё и
 * словами в подписи незачем.
 */
export function activityFilterSummaryTitle(
  filters: ReadonlySet<ActivityFilter>,
): string {
  const hidden = ACTIVITY_FILTERS.filter((filter) => !filters.has(filter));
  if (hidden.length === 0) return "Показывать: включены все потоки";
  return `Показывать. Скрыто: ${hidden
    .map((filter) => ACTIVITY_FILTER_LABEL[filter])
    .join(", ")}`;
}
