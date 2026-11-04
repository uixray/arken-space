import { and, asc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { memberships, users } from "@arken/db";
import { localLoginNameSchema } from "@arken/contracts";
import { hashPassword } from "./password-security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];
const membershipSpec = z
  .object({
    membershipId: z.string().uuid(),
    campaignId: z.string().uuid(),
    role: z.enum(["GM", "PLAYER"]),
    displayName: z.string().min(1).max(300),
  })
  .strict();
const accountSpec = z
  .object({
    login: localLoginNameSchema,
    password: z.string().min(12).max(128),
    memberships: z.array(membershipSpec).min(1).max(32),
  })
  .strict();
const batchSchema = z.array(accountSpec).min(1).max(32);

/** Owner-invoked service, not an HTTP endpoint. Secrets are caller-owned and
 * must never be logged, returned, persisted in command history, or put in Git.
 * The caller must establish explicit owner authority and a confidential channel.
 * Fail the entire batch if any reviewed membership no longer matches. */
export async function provisionHostedAccounts(db: Database, input: unknown) {
  const batch = batchSchema.parse(input);
  const logins = batch.map((account) => account.login);
  const allMemberships = batch.flatMap((account) => account.memberships);
  const ids = allMemberships.map((member) => member.membershipId);
  if (
    new Set(logins).size !== logins.length ||
    new Set(ids).size !== ids.length
  )
    throw new Error("HOSTED_PROVISION_DUPLICATE_INPUT");
  // Each person must receive a distinct temporary secret, even if the
  // operator accidentally supplies the same one for two different logins.
  if (new Set(batch.map((account) => account.password)).size !== batch.length)
    throw new Error("HOSTED_PROVISION_DUPLICATE_PASSWORD");
  for (const account of batch) {
    if (
      new Set(account.memberships.map((member) => member.campaignId)).size !==
      account.memberships.length
    )
      throw new Error("HOSTED_PROVISION_DUPLICATE_CAMPAIGN");
  }
  // Hash before locks, and never retain plaintext in the receipt or DB.
  const passwordHashes: string[] = [];
  for (const account of batch)
    passwordHashes.push(await hashPassword(account.password));
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: memberships.id,
        campaignId: memberships.campaignId,
        role: memberships.role,
        displayName: memberships.displayName,
        userId: memberships.userId,
        revokedAt: memberships.accessRevokedAt,
      })
      .from(memberships)
      .where(inArray(memberships.id, ids))
      .orderBy(asc(memberships.id))
      .for("update");
    if (locked.length !== ids.length)
      throw new Error("HOSTED_PROVISION_MEMBERSHIP_CHANGED");
    const byId = new Map(locked.map((row) => [row.id, row]));
    for (const expected of allMemberships) {
      const actual = byId.get(expected.membershipId);
      if (
        !actual ||
        actual.userId ||
        actual.revokedAt ||
        actual.campaignId !== expected.campaignId ||
        actual.role !== expected.role ||
        actual.displayName !== expected.displayName
      )
        throw new Error("HOSTED_PROVISION_MEMBERSHIP_CHANGED");
    }
    const created: Array<{
      userId: string;
      login: string;
      membershipCount: number;
    }> = [];
    for (const [index, account] of batch.entries()) {
      const [user] = await tx
        .insert(users)
        .values({
          identityKind: "HOSTED",
          hostedLogin: account.login,
          hostedApprovedAt: new Date(),
          passwordChangeRequired: true,
          passwordHash: passwordHashes[index]!,
          emailNormalized: null,
          emailDisplay: null,
          verifiedAt: null,
          localInstanceId: null,
          localLogin: null,
          localApprovedAt: null,
        })
        .returning({ id: users.id });
      if (!user) throw new Error("HOSTED_PROVISION_FAILED");
      const targetIds = account.memberships.map(
        (member) => member.membershipId,
      );
      const assigned = await tx
        .update(memberships)
        .set({ userId: user.id })
        .where(
          and(inArray(memberships.id, targetIds), isNull(memberships.userId)),
        )
        .returning({ id: memberships.id });
      if (assigned.length !== targetIds.length)
        throw new Error("HOSTED_PROVISION_MEMBERSHIP_CHANGED");
      created.push({
        userId: user.id,
        login: account.login,
        membershipCount: assigned.length,
      });
    }
    return { accounts: created };
  });
}
