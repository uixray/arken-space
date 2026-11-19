import { expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../packages/db/src/schema.js";
import { createMigratedPglite } from "./helpers/pglite-template.js";
import { createOwnedCampaignHistory } from "./e2e/owned-campaign-history.js";
import {
  historyMessageBody,
  insertOwnedChatHistory,
} from "./e2e/chat-history-fixture.js";
it("bulk history preserves exact bodies, order and campaign isolation; rejects foreign owner", async () => {
  const client = await createMigratedPglite();
  try {
    const db = drizzle(client, { schema });
    // Adapter only for the test driver; both drivers run the same real SQL transaction.
    const fixtureDb = db as unknown as Parameters<
      typeof insertOwnedChatHistory
    >[0];
    const [a, b] = await db
      .insert(schema.campaigns)
      .values([{ name: "owned" }, { name: "foreign" }])
      .returning();
    const [gm, other] = await db
      .insert(schema.memberships)
      .values([
        { campaignId: a.id, role: "GM", displayName: "GM" },
        { campaignId: b.id, role: "GM", displayName: "Other" },
      ])
      .returning();
    const owner = { campaignId: a.id, membershipId: gm.id };
    let rows: Awaited<ReturnType<typeof insertOwnedChatHistory>> = [];
    const history = createOwnedCampaignHistory({
      databaseUrl: "postgres://localhost/disposable_pglite_adapter",
      createCampaign: async () => owner,
      insertHistory: async (owned, count) => {
        rows = await insertOwnedChatHistory(fixtureDb, owned, count);
      },
    });
    const token = await history.create("owned");
    await expect(history.seed("foreign-worker-token", 40)).rejects.toThrow(
      "owned campaigns",
    );
    await history.seed(token, 40);
    expect(rows).toHaveLength(40);
    expect(rows.map((r) => r.sequence)).toEqual(
      [...rows.map((r) => r.sequence)].sort((a, b) => a - b),
    );
    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.campaignId, a.id))
      .orderBy(schema.chatMessages.sequence);
    expect(messages.map((m) => m.body)).toEqual(
      Array.from({ length: 40 }, (_, i) => historyMessageBody(i)),
    );
    expect(
      messages.every(
        (m) =>
          m.membershipId === gm.id &&
          m.kind === "TEXT" &&
          m.visibility === "PUBLIC",
      ),
    ).toBe(true);
    await expect(
      insertOwnedChatHistory(
        fixtureDb,
        { campaignId: a.id, membershipId: other.id },
        40,
      ),
    ).rejects.toThrow("campaign GM");
    expect(
      await db
        .select()
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.campaignId, b.id)),
    ).toEqual([]);
    await expect(insertOwnedChatHistory(fixtureDb, owner, 101)).rejects.toThrow(
      "Invalid history count",
    );
    expect(await db.select().from(schema.chatMessages)).toHaveLength(40);
  } finally {
    await client.close();
  }
}, 60_000);
