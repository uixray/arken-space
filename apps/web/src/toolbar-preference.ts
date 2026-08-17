/**
 * UIX-475 — свёрнута ли панель инструментов до одних значков.
 *
 * Подписи (UIX-470) сделали панель понятной, но и втрое шире: она висит поверх
 * карты и на узком экране отнимает у неё заметную полосу. Свёрнутое состояние
 * возвращает прежний вид — значки без подписей, — не отбирая подписи у тех, кому
 * они нужны.
 *
 * Хранится по участнику, как и прочие настройки панели: это привычка человека,
 * а не свойство кампании.
 */
const key = (membershipId: string) =>
  `arken.toolbarCollapsed:${encodeURIComponent(membershipId)}`;

export function readToolbarCollapsed(
  storage: Pick<Storage, "getItem">,
  membershipId: string,
): boolean {
  try {
    return storage.getItem(key(membershipId)) === "true";
  } catch {
    return false;
  }
}

export function writeToolbarCollapsed(
  storage: Pick<Storage, "setItem">,
  membershipId: string,
  collapsed: boolean,
): void {
  try {
    storage.setItem(key(membershipId), String(collapsed));
  } catch {
    // Заблокированное хранилище не должно мешать игре.
  }
}
