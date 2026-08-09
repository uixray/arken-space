// UIX-387: the sidebar dice-tray block's drag-resized height, persisted per
// campaign + membership the same way `sidebar-width-preference.ts` persists
// the sidebar's drag-resized width.
export const DICE_TRAY_HEIGHT_MIN = 72;
export const DICE_TRAY_HEIGHT_MAX = 280;
export const DICE_TRAY_HEIGHT_DEFAULT = 110;

export function clampDiceTrayHeight(height: number): number {
  if (!Number.isFinite(height)) return DICE_TRAY_HEIGHT_DEFAULT;
  return Math.min(DICE_TRAY_HEIGHT_MAX, Math.max(DICE_TRAY_HEIGHT_MIN, height));
}

export function diceTrayHeightStorageKey(
  campaignId: string,
  membershipId: string,
) {
  return `arken.diceTrayHeight:${encodeURIComponent(campaignId)}:${encodeURIComponent(membershipId)}`;
}

export function readDiceTrayHeight(
  storage: Pick<Storage, "getItem">,
  campaignId: string,
  membershipId: string,
): number | null {
  try {
    const raw = storage.getItem(
      diceTrayHeightStorageKey(campaignId, membershipId),
    );
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampDiceTrayHeight(parsed) : null;
  } catch {
    return null;
  }
}

export function writeDiceTrayHeight(
  storage: Pick<Storage, "setItem">,
  campaignId: string,
  membershipId: string,
  height: number,
) {
  try {
    storage.setItem(
      diceTrayHeightStorageKey(campaignId, membershipId),
      String(clampDiceTrayHeight(height)),
    );
  } catch {
    // A blocked or full localStorage must not make the game unusable.
  }
}
