export type MapSelection = {
  tokenIds: string[];
  drawingIds: string[];
};

export function toggleSelectionId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function pruneSelectionIds(
  ids: string[],
  allowedIds: ReadonlySet<string>,
): string[] {
  const next = ids.filter((id) => allowedIds.has(id));
  return next.length === ids.length &&
    next.every((id, index) => id === ids[index])
    ? ids
    : next;
}

export function rectanglesIntersect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function selectionSummary(selection: MapSelection): string {
  return `Выбрано объектов: ${selection.tokenIds.length + selection.drawingIds.length}. Токенов: ${selection.tokenIds.length}. Рисунков: ${selection.drawingIds.length}.`;
}
