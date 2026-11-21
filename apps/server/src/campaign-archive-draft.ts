import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  campaignArchiveState,
  campaigns,
  memberships,
  sessions,
} from "@arken/db";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export { campaignArchiveState };

type Input = {
  campaignId: string;
  actorUserId: string; // From an authenticated account, never a request body.
  archived: boolean;
  expectedRevision: number;
  actionId: string;
};

export type ArchiveResult =
  | {
      kind: "updated" | "replay";
      revision: number;
      archivedAt: Date | null;
      disconnectedSessionIds: string[];
    }
  | { kind: "notFound" }
  | { kind: "conflict"; revision: number }
  | { kind: "unchanged"; revision: number };

export async function lockCampaignForArchive(tx: Tx, campaignId: string) {
  const [row] = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .for("update");
  return row ?? null;
}

export async function transitionCampaignArchive(
  db: Database,
  input: Input,
): Promise<ArchiveResult> {
  return db.transaction(async (tx) => {
    if (!(await lockCampaignForArchive(tx, input.campaignId)))
      return { kind: "notFound" };
    const [guard] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, input.campaignId),
          eq(memberships.userId, input.actorUserId),
          eq(memberships.role, "GM"),
          isNull(memberships.accessRevokedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!guard) return { kind: "notFound" };
    const [prior] = await tx
      .select()
      .from(campaignArchiveState)
      .where(eq(campaignArchiveState.campaignId, input.campaignId));
    const revision = prior?.revision ?? 0;
    const alreadyArchived = Boolean(prior?.archivedAt);
    if (prior?.lastActionId === input.actionId) {
      if (
        prior.lastActorUserId !== input.actorUserId ||
        revision !== input.expectedRevision + 1 ||
        alreadyArchived !== input.archived
      )
        return { kind: "conflict", revision };
      return {
        kind: "replay",
        revision,
        archivedAt: prior.archivedAt,
        disconnectedSessionIds: [],
      };
    }
    if (revision !== input.expectedRevision)
      return { kind: "conflict", revision };
    if (alreadyArchived === input.archived)
      return { kind: "unchanged", revision };

    const values = {
      archivedAt: input.archived ? new Date() : null,
      revision: revision + 1,
      lastActionId: input.actionId,
      lastActorUserId: input.actorUserId,
    };
    await tx
      .insert(campaignArchiveState)
      .values({ campaignId: input.campaignId, ...values })
      .onConflictDoUpdate({
        target: campaignArchiveState.campaignId,
        set: values,
      });

    // Account sessions and access grants stay intact. Only this campaign's
    // game sessions are invalidated; callers disconnect these IDs after commit.
    const invalidated = input.archived
      ? await tx
          .delete(sessions)
          .where(
            inArray(
              sessions.membershipId,
              tx
                .select({ id: memberships.id })
                .from(memberships)
                .where(eq(memberships.campaignId, input.campaignId)),
            ),
          )
          .returning({ id: sessions.id })
      : [];
    return {
      kind: "updated",
      revision: values.revision,
      archivedAt: values.archivedAt,
      disconnectedSessionIds: invalidated.map((row) => row.id),
    };
  });
}

export async function campaignArchiveAllowsGameAccess(
  db: Database | Tx,
  campaignId: string,
) {
  const [state] = await db
    .select({ archivedAt: campaignArchiveState.archivedAt })
    .from(campaignArchiveState)
    .where(eq(campaignArchiveState.campaignId, campaignId));
  return !state?.archivedAt;
}

/**
 * Acquire before account/session/member locks and keep through the insert.
 * Revalidate the membership, account or link provenance inside issue(), using tx.
 * Returning null means the caller must not set a game cookie or consume an invite.
 */
export async function withCampaignGameIssuance<T>(
  db: Database,
  campaignId: string,
  issue: (tx: Tx) => Promise<T>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    if (!(await lockCampaignForArchive(tx, campaignId))) return null;
    if (!(await campaignArchiveAllowsGameAccess(tx, campaignId))) return null;
    return issue(tx);
  });
}
