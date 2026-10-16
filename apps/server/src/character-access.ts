import { and, eq } from "drizzle-orm";
import { campaigns, characterControllers, characters } from "@arken/db";
import { resolveStatLayout } from "./snapshot.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

/** The GM, the owner or a controller may act on this character. */
export async function canAccessCharacter(
  db: Database,
  auth: { role: "GM" | "PLAYER"; membershipId: string },
  character: typeof characters.$inferSelect | undefined,
): Promise<boolean> {
  if (!character) return false;
  if (auth.role === "GM" || character.ownerMembershipId === auth.membershipId)
    return true;
  const [controller] = await db
    .select({ membershipId: characterControllers.membershipId })
    .from(characterControllers)
    .where(
      and(
        eq(characterControllers.characterId, character.id),
        eq(characterControllers.membershipId, auth.membershipId),
      ),
    )
    .limit(1);
  return Boolean(controller);
}

export async function characterControllerIds(
  db: Database,
  characterId: string,
): Promise<string[]> {
  const rows = await db
    .select({ membershipId: characterControllers.membershipId })
    .from(characterControllers)
    .where(eq(characterControllers.characterId, characterId));
  return rows.map((row) => row.membershipId);
}

export async function campaignDefaultStatLayout(
  db: Database,
  campaignId: string,
) {
  const [campaign] = await db
    .select({ statLayout: campaigns.statLayout })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  return resolveStatLayout(campaign?.statLayout);
}

/** The resource images of a character, as a set of asset ids. */
export function resourceImageIds(resources: unknown) {
  const ids = new Set<string>();
  if (resources && typeof resources === "object")
    for (const resource of Object.values(resources))
      if (
        resource &&
        typeof resource === "object" &&
        typeof (resource as { imageAssetId?: unknown }).imageAssetId ===
          "string"
      )
        ids.add((resource as { imageAssetId: string }).imageAssetId);
  return ids;
}

export function sameResourceImages(before: unknown, after: unknown) {
  const a = resourceImageIds(before);
  const b = resourceImageIds(after);
  return a.size === b.size && [...a].every((id) => b.has(id));
}
