import { and, eq } from "drizzle-orm";
import { characterControllers, characters } from "@arken/db";

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
