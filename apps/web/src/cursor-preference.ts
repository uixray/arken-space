// UIX-392: opt-out preference for ephemeral cursor presence, persisted per
// campaign + membership the same way `sidebar-width-preference.ts` persists
// the sidebar's drag-resized width. Two independent flags exist because a
// player may want to stop broadcasting their own position without also
// losing the ability to see others', or vice versa.
export interface CursorPreference {
  sendEnabled: boolean;
  receiveEnabled: boolean;
}

export const CURSOR_PREFERENCE_DEFAULT: CursorPreference = {
  sendEnabled: true,
  receiveEnabled: true,
};

export function cursorPreferenceStorageKey(
  campaignId: string,
  membershipId: string,
) {
  return `arken.cursorPresence:${encodeURIComponent(campaignId)}:${encodeURIComponent(membershipId)}`;
}

export function readCursorPreference(
  storage: Pick<Storage, "getItem">,
  campaignId: string,
  membershipId: string,
): CursorPreference {
  try {
    const raw = storage.getItem(
      cursorPreferenceStorageKey(campaignId, membershipId),
    );
    if (!raw) return CURSOR_PREFERENCE_DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return CURSOR_PREFERENCE_DEFAULT;
    const candidate = parsed as Partial<CursorPreference>;
    return {
      sendEnabled:
        typeof candidate.sendEnabled === "boolean"
          ? candidate.sendEnabled
          : CURSOR_PREFERENCE_DEFAULT.sendEnabled,
      receiveEnabled:
        typeof candidate.receiveEnabled === "boolean"
          ? candidate.receiveEnabled
          : CURSOR_PREFERENCE_DEFAULT.receiveEnabled,
    };
  } catch {
    return CURSOR_PREFERENCE_DEFAULT;
  }
}

export function writeCursorPreference(
  storage: Pick<Storage, "setItem">,
  campaignId: string,
  membershipId: string,
  preference: CursorPreference,
) {
  try {
    storage.setItem(
      cursorPreferenceStorageKey(campaignId, membershipId),
      JSON.stringify(preference),
    );
  } catch {
    // A blocked or full localStorage must not make the game unusable.
  }
}
