import { and, eq, isNull, sql } from "drizzle-orm";
import {
  characterControllers,
  characters,
  gameEvents,
  invites,
  tokenDefinitions,
  tokens,
} from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type CharacterRow = typeof characters.$inferSelect;

export type CharacterArchiveCommand = {
  campaignId: string;
  membershipId: string;
  characterId: string;
  revision: number;
  actionId: string;
};

export type CharacterArchiveOutcome =
  | { kind: "duplicate" }
  | { kind: "not-found" }
  | { kind: "conflict" }
  | { kind: "updated"; character: CharacterRow };

async function hasAction(db: Database, campaignId: string, actionId: string) {
  const [event] = await db
    .select()
    .from(gameEvents)
    .where(
      and(
        eq(gameEvents.campaignId, campaignId),
        eq(gameEvents.actionId, actionId),
      ),
    )
    .limit(1);
  return Boolean(event);
}

export async function archiveCharacter(
  db: Database,
  command: CharacterArchiveCommand,
): Promise<CharacterArchiveOutcome> {
  const { campaignId, membershipId, characterId, revision, actionId } = command;
  // Keep replay lookup before current-row/revision lookup, matching the route's
  // existing idempotency and concurrency behavior.
  if (await hasAction(db, campaignId, actionId)) return { kind: "duplicate" };
  const [current] = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.campaignId, campaignId),
        eq(characters.lifecycle, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!current) return { kind: "not-found" };
  if (current.revision !== revision) return { kind: "conflict" };

  const now = new Date();
  const archived = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(characters)
      .set({
        lifecycle: "ARCHIVED",
        archivedAt: now,
        archivedByMembershipId: membershipId,
        revision: current.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
          eq(characters.lifecycle, "ACTIVE"),
          eq(characters.revision, current.revision),
        ),
      )
      .returning();
    if (!updated) return null;
    await tx
      .delete(characterControllers)
      .where(eq(characterControllers.characterId, characterId));
    // Materialize the display name before detaching definitions so unnamed
    // character-linked tokens keep the same visible label as before archive.
    await tx
      .update(tokenDefinitions)
      .set({ name: sql`coalesce(${tokenDefinitions.name}, ${updated.name})` })
      .where(
        and(
          eq(tokenDefinitions.characterId, characterId),
          eq(tokenDefinitions.campaignId, campaignId),
        ),
      );
    await tx
      .update(tokenDefinitions)
      .set({ characterId: null })
      .where(
        and(
          eq(tokenDefinitions.characterId, characterId),
          eq(tokenDefinitions.campaignId, campaignId),
        ),
      );
    await tx
      .update(tokens)
      .set({ characterId: null })
      .where(eq(tokens.characterId, characterId));
    await tx
      .update(invites)
      .set({ expiresAt: now })
      .where(
        and(
          eq(invites.characterId, characterId),
          eq(invites.campaignId, campaignId),
          isNull(invites.claimedAt),
        ),
      );
    await tx.insert(gameEvents).values({
      campaignId,
      actionId,
      membershipId,
      type: "character.archived",
      entityType: "character",
      entityId: characterId,
      entityRevision: updated.revision,
      payload: { characterId, from: "ACTIVE", to: "ARCHIVED" },
    });
    return updated;
  });
  return archived
    ? { kind: "updated", character: archived }
    : { kind: "conflict" };
}

export async function restoreCharacter(
  db: Database,
  command: CharacterArchiveCommand,
): Promise<CharacterArchiveOutcome> {
  const { campaignId, membershipId, characterId, revision, actionId } = command;
  if (await hasAction(db, campaignId, actionId)) return { kind: "duplicate" };
  const [current] = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        eq(characters.campaignId, campaignId),
        eq(characters.lifecycle, "ARCHIVED"),
      ),
    )
    .limit(1);
  if (!current) return { kind: "not-found" };
  if (current.revision !== revision) return { kind: "conflict" };

  const now = new Date();
  const restored = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(characters)
      .set({
        lifecycle: "ACTIVE",
        archivedAt: null,
        archivedByMembershipId: null,
        revision: current.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(characters.id, characterId),
          eq(characters.campaignId, campaignId),
          eq(characters.lifecycle, "ARCHIVED"),
          eq(characters.revision, current.revision),
        ),
      )
      .returning();
    if (!updated) return null;
    await tx.insert(gameEvents).values({
      campaignId,
      actionId,
      membershipId,
      type: "character.restored",
      entityType: "character",
      entityId: characterId,
      entityRevision: updated.revision,
      payload: { characterId, from: "ARCHIVED", to: "ACTIVE" },
    });
    return updated;
  });
  return restored
    ? { kind: "updated", character: restored }
    : { kind: "conflict" };
}
