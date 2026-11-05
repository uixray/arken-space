import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { buildSnapshot } from "../apps/server/src/snapshot.js";
import { env } from "../apps/server/src/env.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";

it("UIX-768: account grants follow only the intended account across campaigns", async () => {
  const database: PGlite = await createMigratedPglite();
  const oldUsers = env.GEOMETRIC_DICE_USER_IDS;
  const oldMembers = env.GEOMETRIC_DICE_MEMBERSHIP_IDS;
  try {
    const db = drizzle(database, { schema });
    const [
      campaignA,
      campaignB,
      user,
      otherUser,
      memberA,
      memberB,
      other,
      guest,
    ] = Array.from({ length: 8 }, () => crypto.randomUUID());
    await db.insert(schema.users).values([
      {
        id: user,
        emailNormalized: "dice-a@example.test",
        emailDisplay: "dice-a@example.test",
        passwordHash: "synthetic",
      },
      {
        id: otherUser,
        emailNormalized: "dice-b@example.test",
        emailDisplay: "dice-b@example.test",
        passwordHash: "synthetic",
      },
    ]);
    await db.insert(schema.campaigns).values([
      { id: campaignA, name: "A" },
      { id: campaignB, name: "B" },
    ]);
    await db.insert(schema.memberships).values([
      {
        id: memberA,
        campaignId: campaignA!,
        userId: user,
        role: "PLAYER",
        displayName: "A",
      },
      {
        id: memberB,
        campaignId: campaignB!,
        userId: user,
        role: "PLAYER",
        displayName: "B",
      },
      {
        id: other,
        campaignId: campaignA!,
        userId: otherUser,
        role: "PLAYER",
        displayName: "Other",
      },
      {
        id: guest,
        campaignId: campaignB!,
        role: "PLAYER",
        displayName: "Guest",
      },
    ]);
    env.GEOMETRIC_DICE_USER_IDS = user!;
    env.GEOMETRIC_DICE_MEMBERSHIP_IDS = "";
    const snapshot = (campaignId: string, membershipId: string) =>
      buildSnapshot(db as never, {
        campaignId,
        membershipId,
        role: "PLAYER",
        displayName: "Test",
      });
    expect((await snapshot(campaignA!, memberA!)).personalDiceNames).toBe(
      "GEOMETRIC",
    );
    expect((await snapshot(campaignB!, memberB!)).personalDiceNames).toBe(
      "GEOMETRIC",
    );
    expect(
      (await snapshot(campaignA!, other!)).personalDiceNames,
    ).toBeUndefined();
    expect(
      (await snapshot(campaignB!, guest!)).personalDiceNames,
    ).toBeUndefined();
    await db
      .update(schema.memberships)
      .set({ userId: otherUser })
      .where(eq(schema.memberships.id, memberB!));
    expect(
      (await snapshot(campaignB!, memberB!)).personalDiceNames,
    ).toBeUndefined();
    env.GEOMETRIC_DICE_MEMBERSHIP_IDS = memberB!;
    expect((await snapshot(campaignB!, memberB!)).personalDiceNames).toBe(
      "GEOMETRIC",
    );
  } finally {
    env.GEOMETRIC_DICE_USER_IDS = oldUsers;
    env.GEOMETRIC_DICE_MEMBERSHIP_IDS = oldMembers;
    await database.close();
  }
}, 120_000);
