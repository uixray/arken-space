// UIX-372: the sidebar's drag-resized width, persisted per campaign +
// membership the same way `sidebar-preference.ts` persists the binary
// collapse state.
export const SIDEBAR_WIDTH_MIN = 280;
export const SIDEBAR_WIDTH_MAX = 600;
export const SIDEBAR_WIDTH_DEFAULT = 360;

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}

export function sidebarWidthStorageKey(
  campaignId: string,
  membershipId: string,
) {
  return `arken.sidebarWidth:${encodeURIComponent(campaignId)}:${encodeURIComponent(membershipId)}`;
}

export function readSidebarWidth(
  storage: Pick<Storage, "getItem">,
  campaignId: string,
  membershipId: string,
): number | null {
  try {
    const raw = storage.getItem(
      sidebarWidthStorageKey(campaignId, membershipId),
    );
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : null;
  } catch {
    return null;
  }
}

export function writeSidebarWidth(
  storage: Pick<Storage, "setItem">,
  campaignId: string,
  membershipId: string,
  width: number,
) {
  try {
    storage.setItem(
      sidebarWidthStorageKey(campaignId, membershipId),
      String(clampSidebarWidth(width)),
    );
  } catch {
    // A blocked or full localStorage must not make the game unusable.
  }
}
