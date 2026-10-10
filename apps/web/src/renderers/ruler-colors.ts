import { cursorColorForMembership } from "./cursor-color";

/**
 * UIX-509's safe fallback until a private, stable membership→named-palette
 * mapping is supplied. Both local drafts and received ruler events call this
 * with the same membershipId; displayName is deliberately not consulted.
 */
export function rulerColorForMembership(membershipId: string): string {
  return cursorColorForMembership(membershipId);
}
