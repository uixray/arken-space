// UIX-392/UIX-403: opt-out preference for ephemeral cursor presence, persisted
// per campaign + membership the same way `sidebar-width-preference.ts` persists
// the sidebar's drag-resized width.
//
// The two flags answer genuinely different questions — "should others see me"
// and "should I see others" — and until UIX-403 a single control flipped both
// together, so neither could be answered on its own.
//
// `sendEnabled` means "my cursor is visible to the people who can see it". For
// a player that is the whole campaign, as before. For a GM it is the players,
// which is new: a GM's cursor previously went to the GM room alone, so for that
// role the flag governed nothing observable at all.
export interface CursorPreference {
  sendEnabled: boolean;
  receiveEnabled: boolean;
}

/**
 * A GM starts private. Their cursor moves over things players cannot see, so
 * showing it has to be a decision, not a default they inherit.
 */
export function cursorPreferenceDefault(
  role: "GM" | "PLAYER",
): CursorPreference {
  return { sendEnabled: role !== "GM", receiveEnabled: true };
}

export const CURSOR_PREFERENCE_DEFAULT: CursorPreference =
  cursorPreferenceDefault("PLAYER");

/**
 * The `v2` is load-bearing. Before UIX-403 every GM had `sendEnabled: true`
 * stored, and under the new meaning reading that back would start broadcasting
 * their cursor to players the moment they upgraded — a safety property
 * reversed without anyone touching a control. Ignoring the old key costs one
 * reset of two booleans and removes that possibility entirely.
 */
export function cursorPreferenceStorageKey(
  campaignId: string,
  membershipId: string,
) {
  return `arken.cursorPresence.v2:${encodeURIComponent(campaignId)}:${encodeURIComponent(membershipId)}`;
}

export function readCursorPreference(
  storage: Pick<Storage, "getItem">,
  campaignId: string,
  membershipId: string,
  role: "GM" | "PLAYER" = "PLAYER",
): CursorPreference {
  const fallback = cursorPreferenceDefault(role);
  try {
    const raw = storage.getItem(
      cursorPreferenceStorageKey(campaignId, membershipId),
    );
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const candidate = parsed as Partial<CursorPreference>;
    return {
      sendEnabled:
        typeof candidate.sendEnabled === "boolean"
          ? candidate.sendEnabled
          : fallback.sendEnabled,
      receiveEnabled:
        typeof candidate.receiveEnabled === "boolean"
          ? candidate.receiveEnabled
          : fallback.receiveEnabled,
    };
  } catch {
    return fallback;
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
