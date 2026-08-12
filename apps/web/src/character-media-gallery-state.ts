import type {
  CharacterMediaCategory,
  CharacterMediaDto,
  CharacterMediaVisibility,
} from "@arken/contracts";

/** UI labels for `CharacterMediaCategory`; shared by the owner gallery view. */
export const CHARACTER_MEDIA_CATEGORY_LABELS: Record<
  CharacterMediaCategory,
  string
> = {
  CHARACTER_ART: "Арт персонажа",
  ARTIFACT: "Артефакт",
  ITEM: "Предмет",
  DOCUMENT_HANDOUT: "Документ / раздатка",
  MEMORY_SCENE: "Сцена памяти",
  OTHER: "Другое",
};

/** UI labels for `CharacterMediaVisibility`. */
export const CHARACTER_MEDIA_VISIBILITY_LABELS: Record<
  CharacterMediaVisibility,
  string
> = {
  OWNER_GM: "Владелец и мастер",
  PARTY: "Вся группа",
  GM_ONLY: "Только мастер",
};

/**
 * Sorts gallery entries for display: primarily by `ordering`, with a stable
 * tie-break on `id` so equal orderings (e.g. mid-reorder) don't jitter.
 */
export function sortMediaByOrdering(
  items: readonly CharacterMediaDto[],
): CharacterMediaDto[] {
  return [...items].sort((a, b) => {
    if (a.ordering !== b.ordering) return a.ordering - b.ordering;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Computes the pair of (id, new ordering) writes needed to swap a gallery
 * entry with its neighbor in the given direction. Returns null when the
 * entry is already at the boundary (nothing to swap) or isn't found.
 *
 * The caller is expected to issue two sequential, revision-gated reorder
 * requests (one per returned entry) and refetch on a 409 conflict.
 */
export function computeAdjacentSwap(
  items: readonly CharacterMediaDto[],
  id: string,
  direction: "up" | "down",
):
  | [
      { id: string; revision: number; ordering: number },
      { id: string; revision: number; ordering: number },
    ]
  | null {
  const sorted = sortMediaByOrdering(items);
  const index = sorted.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sorted.length) return null;
  const current = sorted[index]!;
  const neighbor = sorted[neighborIndex]!;
  return [
    { id: current.id, revision: current.revision, ordering: neighbor.ordering },
    {
      id: neighbor.id,
      revision: neighbor.revision,
      ordering: current.ordering,
    },
  ];
}

/**
 * Given the currently open viewer item and a step (+1/-1, wrapping), returns
 * the id of the item to show next, or null when the gallery is empty.
 */
export function stepViewerItem(
  items: readonly CharacterMediaDto[],
  activeId: string,
  delta: 1 | -1,
): string | null {
  const sorted = sortMediaByOrdering(items);
  if (sorted.length === 0) return null;
  const index = sorted.findIndex((item) => item.id === activeId);
  if (index === -1) return sorted[0]!.id;
  const nextIndex = (index + delta + sorted.length) % sorted.length;
  return sorted[nextIndex]!.id;
}
