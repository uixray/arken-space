import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../packages/db/src/schema.js";
import {
  runCampaignCanvasMutation,
  runCampaignCanvasRelay,
} from "./campaign-pause-guard.js";

const campaignId = "10000000-0000-4000-8000-000000000583";
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function migrate() {
  const migrationsUrl = new URL(
    "../../../packages/db/drizzle/",
    import.meta.url,
  );
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = (
      await readFile(new URL(file, migrationsUrl), "utf8")
    ).replaceAll("--> statement-breakpoint", "");
    await database.exec(sql);
  }
}

beforeEach(async () => {
  database = new PGlite();
  await migrate();
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values({
    id: campaignId,
    name: "UIX-583",
  });
});

afterEach(async () => {
  await database.close();
});

describe("UIX-583 campaign Canvas guard", () => {
  it("runs an allowed durable mutation inside the guarded transaction", async () => {
    await runCampaignCanvasMutation(db as never, campaignId, async (tx) => {
      await tx
        .update(schema.campaigns)
        .set({ name: "updated" })
        .where(eq(schema.campaigns.id, campaignId));
    });

    const [campaign] = await db
      .select({ name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId));
    expect(campaign?.name).toBe("updated");
  });

  it("rejects a paused durable mutation before invoking its callback", async () => {
    await db
      .update(schema.campaigns)
      .set({ paused: true })
      .where(eq(schema.campaigns.id, campaignId));
    const mutate = vi.fn(async () => undefined);

    await expect(
      runCampaignCanvasMutation(db as never, campaignId, mutate),
    ).rejects.toMatchObject({
      code: "CAMPAIGN_PAUSED",
      statusCode: 409,
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("holds the same fail-closed boundary for ephemeral relays", async () => {
    const relay = vi.fn(async () => "sent" as const);
    const allowed = await runCampaignCanvasRelay(
      db as never,
      campaignId,
      relay,
    );
    expect(allowed).toEqual({ kind: "RELAYED", value: "sent" });
    expect(relay).toHaveBeenCalledOnce();

    await db
      .update(schema.campaigns)
      .set({ paused: true })
      .where(eq(schema.campaigns.id, campaignId));
    relay.mockClear();
    const blocked = await runCampaignCanvasRelay(
      db as never,
      campaignId,
      relay,
    );
    expect(blocked).toEqual({
      kind: "BLOCKED",
      reason: "CAMPAIGN_PAUSED",
    });
    expect(relay).not.toHaveBeenCalled();
  });

  it("does not project a paused campaign into a foreign campaign", async () => {
    const foreignCampaignId = crypto.randomUUID();
    await db.insert(schema.campaigns).values({
      id: foreignCampaignId,
      name: "Foreign",
    });
    await db
      .update(schema.campaigns)
      .set({ paused: true })
      .where(eq(schema.campaigns.id, campaignId));

    await runCampaignCanvasMutation(
      db as never,
      foreignCampaignId,
      async (tx) => {
        await tx
          .update(schema.campaigns)
          .set({ name: "Foreign updated" })
          .where(eq(schema.campaigns.id, foreignCampaignId));
      },
    );
    await expect(
      runCampaignCanvasRelay(
        db as never,
        foreignCampaignId,
        async () => "foreign relay",
      ),
    ).resolves.toEqual({ kind: "RELAYED", value: "foreign relay" });

    const campaigns = await db
      .select({
        id: schema.campaigns.id,
        name: schema.campaigns.name,
        paused: schema.campaigns.paused,
      })
      .from(schema.campaigns);
    expect(campaigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: campaignId, paused: true }),
        expect.objectContaining({
          id: foreignCampaignId,
          name: "Foreign updated",
          paused: false,
        }),
      ]),
    );
  });

  it("fails closed when the campaign row is absent", async () => {
    const missing = crypto.randomUUID();
    await expect(
      runCampaignCanvasMutation(db as never, missing, async () => undefined),
    ).rejects.toMatchObject({
      code: "CAMPAIGN_NOT_FOUND",
      statusCode: 404,
    });
    await expect(
      runCampaignCanvasRelay(db as never, missing, async () => undefined),
    ).resolves.toEqual({
      kind: "BLOCKED",
      reason: "CAMPAIGN_NOT_FOUND",
    });
  });
});
