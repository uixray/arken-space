import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { characterMedia, characters } from "@arken/db";
import type { CharacterMediaVisibility } from "@arken/contracts";

/**
 * Server-side ACL core for character-media galleries (UIX-292 Stage 1).
 *
 * This module intentionally has no HTTP routes: Stage 2/3/4 route handlers
 * are expected to call `characterMediaVisibility` for list/query filtering
 * (mirrors `visibility()` in ./player-requests.ts) and `canView*` /
 * `canMutate*` / `canDetach*` for single-row authorization once a row has
 * already been loaded.
 */

export interface CharacterMediaAuthContext {
  role: "GM" | "PLAYER";
  membershipId: string;
}

/** The minimal shape needed to decide access to one attachment. */
export interface CharacterMediaSubject {
  visibility: CharacterMediaVisibility;
  /** `characters.ownerMembershipId` for the attachment's character; can be null (unassigned character). */
  characterOwnerMembershipId: string | null;
}

function isOwner(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  return (
    subject.characterOwnerMembershipId !== null &&
    auth.membershipId === subject.characterOwnerMembershipId
  );
}

/**
 * AC3 + AC8 decision matrix:
 *  - GM: sees everything, including GM_ONLY (AC8).
 *  - Owner: sees OWNER_GM (default) and PARTY, never GM_ONLY (AC8 — hidden
 *    from the owner too).
 *  - Any other player: sees PARTY only.
 */
export function canViewCharacterMedia(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  if (auth.role === "GM") return true;
  if (subject.visibility === "GM_ONLY") return false;
  if (subject.visibility === "PARTY") return true;
  return isOwner(auth, subject);
}

/**
 * Mutation (caption, ordering, visibility) is restricted to the GM and the
 * character's owner — never other players, even for PARTY-shared media.
 * GM_ONLY entries stay invisible (and thus immutable) to the owner.
 */
export function canMutateCharacterMedia(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  if (auth.role === "GM") return true;
  if (subject.visibility === "GM_ONLY") return false;
  return isOwner(auth, subject);
}

/**
 * Detach (soft-remove from the gallery) uses the same authority as mutate.
 * It never hard-deletes the underlying asset — that stays a separate,
 * GM-only flow (see UIX-293 asset lifecycle) that this stage does not wire.
 */
export function canDetachCharacterMedia(
  auth: CharacterMediaAuthContext,
  subject: CharacterMediaSubject,
): boolean {
  return canMutateCharacterMedia(auth, subject);
}

/**
 * SQL predicate for listing/filtering character_media rows, analogous to
 * `visibility()` in ./player-requests.ts. Requires the query to join
 * `characters` on `characterMedia.characterId = characters.id` so
 * `characters.ownerMembershipId` is available. Does not filter on
 * `detachedAt` — callers decide whether detached rows are included.
 */
export function characterMediaVisibility(
  auth: CharacterMediaAuthContext,
): SQL {
  if (auth.role === "GM") return sql`true`;
  return or(
    eq(characterMedia.visibility, "PARTY"),
    and(
      eq(characterMedia.visibility, "OWNER_GM"),
      eq(characters.ownerMembershipId, auth.membershipId),
    ),
  )!;
}
