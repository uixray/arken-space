export function sidebarCollapsedStorageKey(
  campaignId: string,
  membershipId: string,
) {
  return `arken.sidebarCollapsed:${encodeURIComponent(campaignId)}:${encodeURIComponent(membershipId)}`;
}

export function readSidebarCollapsed(
  storage: Pick<Storage, "getItem">,
  campaignId: string,
  membershipId: string,
) {
  try {
    return (
      storage.getItem(sidebarCollapsedStorageKey(campaignId, membershipId)) ===
      "true"
    );
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(
  storage: Pick<Storage, "setItem">,
  campaignId: string,
  membershipId: string,
  collapsed: boolean,
) {
  try {
    storage.setItem(
      sidebarCollapsedStorageKey(campaignId, membershipId),
      String(collapsed),
    );
  } catch {
    // A blocked or full localStorage must not make the game unusable.
  }
}
