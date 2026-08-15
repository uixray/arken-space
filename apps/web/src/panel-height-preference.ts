/**
 * UIX-455 — высота растягиваемой панели боковой колонки.
 *
 * Раньше (UIX-387) это принадлежало лотку костей: `dice-tray-height-preference`
 * знал одно имя ключа и один диапазон. Ручка переехала на панель быстрых
 * бросков — у костей кнопок ровно семь и тянуть там нечего, а список бросков
 * растёт вместе с раскладкой кампании, — и вместе с ней переехало хранение.
 *
 * Панель названа явным параметром, а не выведена из места вызова: два блока с
 * одинаковым ключом делили бы одну высоту, и это выяснилось бы только у того,
 * кто пользуется обоими.
 *
 * Прежние ключи `arken.diceTrayHeight:*` остаются в localStorage мёртвым
 * грузом. Чистить их незачем: панель костей теперь тянется по содержимому, и
 * прочитать эту высоту больше некому.
 */
export const PANEL_HEIGHT_LIMITS = {
  /**
   * Минимум — чтобы в панели оставалась хотя бы строка кнопок: свернуть её в
   * полоску можно только по ошибке, а вернуть обратно потом нечем.
   */
  min: 96,
  /**
   * Максимум щедрее прежних 280: строк раскладки у кампании бывает под два
   * десятка, и упереться в потолок на середине списка — ровно та жалоба,
   * из-за которой ручка сюда и переехала.
   */
  max: 520,
  default: 180,
} as const;

export function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return PANEL_HEIGHT_LIMITS.default;
  return Math.min(
    PANEL_HEIGHT_LIMITS.max,
    Math.max(PANEL_HEIGHT_LIMITS.min, height),
  );
}

export function panelHeightStorageKey(
  panel: string,
  campaignId: string,
  membershipId: string,
) {
  return `arken.panelHeight:${encodeURIComponent(panel)}:${encodeURIComponent(campaignId)}:${encodeURIComponent(membershipId)}`;
}

export function readPanelHeight(
  storage: Pick<Storage, "getItem">,
  panel: string,
  campaignId: string,
  membershipId: string,
): number | null {
  try {
    const raw = storage.getItem(
      panelHeightStorageKey(panel, campaignId, membershipId),
    );
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampPanelHeight(parsed) : null;
  } catch {
    return null;
  }
}

export function writePanelHeight(
  storage: Pick<Storage, "setItem">,
  panel: string,
  campaignId: string,
  membershipId: string,
  height: number,
) {
  try {
    storage.setItem(
      panelHeightStorageKey(panel, campaignId, membershipId),
      String(clampPanelHeight(height)),
    );
  } catch {
    // A blocked or full localStorage must not make the game unusable.
  }
}
