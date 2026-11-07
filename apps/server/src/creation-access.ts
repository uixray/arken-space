import { and, eq, inArray } from "drizzle-orm";
import { characters, characterControllers, creationLicences } from "@arken/db";
import type { AuthContext } from "./auth.js";
import type { CreationTransaction } from "./creation-state.js";

/** Entitlements are immutable and campaign-scoped. Caller verifies character
 * access/ownership separately; a controller never becomes author or licence owner. */
export async function licensedCreationVersions(tx: CreationTransaction, campaignId: string, memberIds: readonly string[],
  versionIds?: readonly string[]) {
  const ids = [...new Set(memberIds)];
  if (!ids.length || versionIds?.length === 0) return new Set<string>();
  const rows = await tx.select({ id: creationLicences.versionId }).from(creationLicences)
    .where(and(eq(creationLicences.campaignId, campaignId), inArray(creationLicences.ownerMembershipId, ids),
      versionIds ? inArray(creationLicences.versionId, [...versionIds]) : undefined));
  return new Set(rows.map(r => r.id));
}
/** Read access may include an archived character. It grants neither a transfer
 * nor ownership of the owner's licences. Call under the campaign graph lock. */
export async function creationAccessMembers(tx: CreationTransaction, auth: AuthContext, characterId?: string) {
  if (!characterId) return [auth.membershipId];
  const [character] = await tx.select().from(characters).where(and(eq(characters.campaignId, auth.campaignId),
    eq(characters.id, characterId))).limit(1).for("share");
  if (!character) throw new Error("CREATION_UNAVAILABLE");
  if (auth.role !== "GM" && character.ownerMembershipId !== auth.membershipId) {
    const [controller] = await tx.select({ id: characterControllers.membershipId }).from(characterControllers).where(and(
      eq(characterControllers.characterId, character.id), eq(characterControllers.membershipId, auth.membershipId))).limit(1).for("share");
    if (!controller) throw new Error("CREATION_FORBIDDEN");
  }
  return [...new Set([auth.membershipId, ...(character.ownerMembershipId ? [character.ownerMembershipId] : [])])];
}
