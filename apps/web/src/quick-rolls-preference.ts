/**
 * UIX-475 — свёрнут ли блок бросков характеристик.
 *
 * Хранится по участнику, а не по кампании: сворачивают его под свой стиль игры,
 * и мастеру с игроком нужны разные вещи на экране. Ключ повторяет форму
 * `sidebar-preference.ts`, чтобы настройки панели читались одинаково.
 */
const key = (membershipId: string) =>
  `arken.quickRollsCollapsed:${encodeURIComponent(membershipId)}`;

export function readQuickRollsCollapsed(
  storage: Pick<Storage, "getItem">,
  membershipId: string,
): boolean {
  try {
    return storage.getItem(key(membershipId)) === "true";
  } catch {
    // Заблокированное хранилище не должно мешать игре: блок просто развёрнут.
    return false;
  }
}

export function writeQuickRollsCollapsed(
  storage: Pick<Storage, "setItem">,
  membershipId: string,
  collapsed: boolean,
): void {
  try {
    storage.setItem(key(membershipId), String(collapsed));
  } catch {
    // То же самое: настройка не сохранится, но работать ничего не перестанет.
  }
}
