import type { Role } from "@arken/contracts";

/** UIX-392: a single member's ephemeral cursor position on one scene. */
export interface CursorPresence {
  membershipId: string;
  displayName: string;
  role: Role;
  sceneId: string;
  x: number;
  y: number;
}

/**
 * Applies one `cursor:moved` event to the known set.
 *
 * UIX-403: the server broadcasts to the whole room, sender included, so a
 * viewer used to get a second cursor chasing their real one. Dropping the
 * echo here rather than server-side keeps one wire format for everyone and
 * costs a single comparison.
 *
 * A position always replaces that member's previous one, so the set holds at
 * most one cursor per member and never accumulates a trail.
 */
export function applyCursorMoved(
  current: readonly CursorPresence[],
  cursor: CursorPresence,
  ownMembershipId: string | undefined,
): CursorPresence[] {
  if (cursor.membershipId === ownMembershipId)
    return current as CursorPresence[];
  return [
    ...current.filter((item) => item.membershipId !== cursor.membershipId),
    cursor,
  ];
}
