import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { expect, it } from "vitest";
import * as schema from "@arken/db";
import { createMigratedPglite } from "./helpers/pglite-template.js";
import {
  persistTelegramBugUpdate,
  processTelegramBugUpdate,
} from "../apps/server/src/bug-intake-inbox.js";
import { resolveBugQuarantine } from "../apps/server/src/bug-intake-resolution.js";

it("keeps an adjudicated collision closed on replay but not on new evidence", async () => {
  const pg = await createMigratedPglite();
  try {
    const db = drizzle(pg, { schema });
    const receiver = randomUUID(),
      operator = randomUUID(),
      campaign = randomUUID();
    const chat = "-100123",
      updateId = 41;
    await db
      .insert(schema.campaigns)
      .values({ id: campaign, name: "Synthetic" });
    await db
      .insert(schema.memberships)
      .values({
        id: operator,
        campaignId: campaign,
        role: "GM",
        displayName: "Synthetic",
      });
    const persist = (text: string) =>
      persistTelegramBugUpdate(
        db as never,
        receiver,
        chat,
        JSON.stringify({
          update_id: updateId,
          message: {
            chat: { type: "supergroup", id: Number(chat) },
            date: 1790000000,
            message_id: 3,
            text,
          },
        }),
      );
    const initial = await persist("original");
    if (initial.status !== "PERSISTED")
      throw new Error("missing initial inbox receipt");
    const id = initial.id;
    const row = async () => {
      const [value] = await db
        .select()
        .from(schema.bugIntakeUpdates)
        .where(eq(schema.bugIntakeUpdates.id, id));
      if (!value) throw new Error("inbox row missing");
      return value;
    };
    expect(
      await processTelegramBugUpdate(db as never, receiver, id, chat),
    ).toMatchObject({ status: "PROCESSED" });
    const processed = await row();
    expect(processed.messageId).not.toBeNull();

    expect(await persist("variant B")).toMatchObject({
      status: "PERSISTED",
      id,
      quarantined: true,
      duplicate: false,
    });
    const conflict = await row();
    expect(conflict.state).toBe("QUARANTINED");
    expect(conflict.conflictingPayloads).toHaveLength(1);
    expect(await persist("variant B")).toMatchObject({
      id,
      quarantined: true,
      duplicate: true,
    });
    expect((await row()).conflictingPayloads).toEqual(
      conflict.conflictingPayloads,
    );
    const evidence = [
      conflict.payloadHash,
      conflict.conflictingPayloads[0]!.hash,
    ];
    const command = {
      actionId: randomUUID(),
      action: "KEEP_CURRENT",
      expectedHashes: evidence,
      reason: "Synthetic operator compared both payloads",
      reviewed: true,
    };
    const resolve = (input: typeof command) =>
      resolveBugQuarantine(db as never, id, operator, input);
    expect(await resolve(command)).toMatchObject({
      ok: true,
      duplicate: false,
      receipt: { state: "PROCESSED" },
    });
    const kept = await row();
    expect(kept).toMatchObject({
      state: "PROCESSED",
      reason: "OPERATOR_KEPT_CURRENT",
      messageId: processed.messageId,
    });
    const replay = await persist("variant B");
    // Assert durable disposition first, not just a change in the returned flag.
    expect(await row()).toMatchObject({
      state: "PROCESSED",
      reason: "OPERATOR_KEPT_CURRENT",
    });
    expect(replay).toMatchObject({
      status: "PERSISTED",
      id,
      duplicate: true,
      quarantined: false,
    });
    expect(await persist("original")).toMatchObject({
      status: "PERSISTED",
      id,
      duplicate: true,
    });
    expect(await row()).toEqual(kept); // also preserves journal hash set and updatedAt
    expect(await resolve(command)).toMatchObject({
      ok: true,
      duplicate: true,
      receipt: { state: "PROCESSED" },
    });
    expect(
      await processTelegramBugUpdate(db as never, receiver, id, chat),
    ).toMatchObject({ status: "NOT_PENDING" });

    expect(await persist("variant C")).toMatchObject({
      status: "PERSISTED",
      id,
      quarantined: true,
      duplicate: false,
    });
    const reopened = await row();
    expect(reopened).toMatchObject({
      state: "QUARANTINED",
      reason: "UPDATE_ID_COLLISION",
      payloadHash: processed.payloadHash,
      messageId: processed.messageId,
    });
    expect(reopened.conflictingPayloads).toHaveLength(2);
    expect(reopened.conflictingPayloads[0]).toEqual(
      conflict.conflictingPayloads[0],
    );
    expect(await resolve({ ...command, actionId: randomUUID() })).toMatchObject(
      { ok: false, error: "EVIDENCE_CHANGED" },
    );

    for (let i = 0; i < 6; i++)
      expect(await persist("extra " + i)).toMatchObject({
        id,
        duplicate: false,
        quarantined: true,
      });
    const full = await row();
    expect(full.conflictingPayloads).toHaveLength(8);
    expect(await persist("extra unseen")).toMatchObject({
      status: "COLLISION_CAPACITY_EXCEEDED",
      id,
    });
    expect(await persist("variant B")).toMatchObject({
      id,
      duplicate: true,
      quarantined: true,
    });
    expect(await row()).toEqual(full);
    expect(await db.select().from(schema.bugIntakeUpdateActions)).toHaveLength(
      1,
    );
    expect(await db.select().from(schema.bugIntakeMessages)).toHaveLength(1);
    expect(await db.select().from(schema.bugIntakeVersions)).toHaveLength(1);
  } finally {
    await pg.close();
  }
});
