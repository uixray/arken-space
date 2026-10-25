import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import {
  ensureSeed,
  seedCampaignContent,
  seedDevelopmentDemoContent,
} from "./seed.js";
import { developmentDemoPlayers } from "./demo-players.js";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
});

afterEach(async () => {
  await database.close();
});

describe("normal server seed safety", () => {
  it("preserves an existing active scene and fog without creating demo data", async () => {
    const campaignId = crypto.randomUUID();
    const sceneId = crypto.randomUUID();
    await db.insert(schema.campaigns).values({
      id: campaignId,
      name: "Existing campaign",
      activeSceneId: sceneId,
    });
    await db.insert(schema.memberships).values({
      id: crypto.randomUUID(),
      campaignId,
      role: "GM",
      displayName: "Existing GM",
    });
    await db.insert(schema.scenes).values({
      id: sceneId,
      campaignId,
      name: "Existing scene",
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#c8b78b",
        opacity: 0.22,
      },
    });
    await db.insert(schema.fogReveals).values({
      sceneId,
      x: 16,
      y: 32,
      width: 96,
      height: 64,
      geometry: { type: "RECT", x: 16, y: 32, width: 96, height: 64 },
      bbox: { x: 16, y: 32, width: 96, height: 64 },
    });

    const fogBefore = await db.select().from(schema.fogReveals);
    const sceneBefore = await db.select().from(schema.scenes);
    const [campaignBefore] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId));

    await ensureSeed(db as never);

    const [campaignAfter] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId));
    expect(campaignAfter?.activeSceneId).toBe(campaignBefore?.activeSceneId);
    expect(await db.select().from(schema.scenes)).toEqual(sceneBefore);
    expect(await db.select().from(schema.fogReveals)).toEqual(fogBefore);
    expect(await db.select().from(schema.playerAccessGrants)).toEqual([]);
    expect(await db.select().from(schema.catalogEntries)).toEqual([]);
    expect(await db.select().from(schema.characterCatalogEntries)).toEqual([]);
    expect(await db.select().from(schema.tokenDefinitions)).toEqual([]);
    expect(await db.select().from(schema.tokens)).toEqual([]);
    expect(await db.select().from(schema.tokenControllers)).toEqual([]);
  });

  it("keeps the ordinary minimal seed free of demo PLAYER memberships and grants", async () => {
    await ensureSeed(db as never);

    const members = await db.select().from(schema.memberships);
    expect(members.map((member) => member.role)).toEqual(["GM"]);
    expect(await db.select().from(schema.playerAccessGrants)).toEqual([]);
  });

  it("rejects demo seeding unless target, development, and local opt-in are explicit", async () => {
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({ name: "Synthetic local demo" })
      .returning();
    if (!campaign) throw new Error("campaign fixture missing");
    await seedCampaignContent(db as never, campaign, "synthetic-gm-secret");
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(eq(schema.scenes.campaignId, campaign.id));
    if (!scene) throw new Error("scene fixture missing");

    const previousNodeEnv = process.env.NODE_ENV;
    const previousOptIn = process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED;
    const countsBefore = [
      (await db.select().from(schema.campaigns)).length,
      (await db.select().from(schema.scenes)).length,
      (await db.select().from(schema.memberships)).length,
      (await db.select().from(schema.playerAccessGrants)).length,
      (await db.select().from(schema.characters)).length,
      (await db.select().from(schema.catalogEntries)).length,
      (await db.select().from(schema.characterCatalogEntries)).length,
      (await db.select().from(schema.tokenDefinitions)).length,
      (await db.select().from(schema.tokens)).length,
      (await db.select().from(schema.tokenControllers)).length,
    ];
    try {
      process.env.NODE_ENV = "production";
      process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED = "1";
      await expect(
        seedDevelopmentDemoContent(db as never, campaign, scene, {
          target: "local",
        }),
      ).rejects.toThrow("Demo seed requires explicit local target");

      process.env.NODE_ENV = "development";
      process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED = "0";
      await expect(
        seedDevelopmentDemoContent(db as never, campaign, scene, {
          target: "local",
        }),
      ).rejects.toThrow("Demo seed requires explicit local target");

      process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED = "1";
      await expect(
        seedDevelopmentDemoContent(db as never, campaign, scene, {
          // @ts-expect-error Intentionally exercise the runtime boundary for unsupported targets.
          target: "remote",
        }),
      ).rejects.toThrow("Demo seed requires explicit local target");

      expect([
        (await db.select().from(schema.campaigns)).length,
        (await db.select().from(schema.scenes)).length,
        (await db.select().from(schema.memberships)).length,
        (await db.select().from(schema.playerAccessGrants)).length,
        (await db.select().from(schema.characters)).length,
        (await db.select().from(schema.catalogEntries)).length,
        (await db.select().from(schema.characterCatalogEntries)).length,
        (await db.select().from(schema.tokenDefinitions)).length,
        (await db.select().from(schema.tokens)).length,
        (await db.select().from(schema.tokenControllers)).length,
      ]).toEqual(countsBefore);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousOptIn === undefined)
        delete process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED;
      else process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED = previousOptIn;
    }
  });

  it("creates the six demo pairs only in an opted-in local fixture and remains idempotent", async () => {
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({ name: "Synthetic local demo" })
      .returning();
    if (!campaign) throw new Error("campaign fixture missing");
    const seeded = await seedCampaignContent(
      db as never,
      campaign,
      "synthetic-gm-secret",
    );
    if (!seeded.gm) throw new Error("synthetic GM membership missing");
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(eq(schema.scenes.campaignId, campaign.id));
    if (!scene) throw new Error("scene fixture missing");

    const previousNodeEnv = process.env.NODE_ENV;
    const previousOptIn = process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED;
    try {
      process.env.NODE_ENV = "development";
      process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED = "1";
      await seedDevelopmentDemoContent(db as never, campaign, scene, {
        target: "local",
      });
      const members = await db
        .select({
          role: schema.memberships.role,
          displayName: schema.memberships.displayName,
        })
        .from(schema.memberships)
        .where(eq(schema.memberships.campaignId, campaign.id));
      const players = members.filter((member) => member.role === "PLAYER");
      expect(players).toHaveLength(developmentDemoPlayers.length);
      expect(players.map((player) => player.displayName).sort()).toEqual(
        developmentDemoPlayers.map((player) => player.name).sort(),
      );
      const grants = await db
        .select()
        .from(schema.playerAccessGrants)
        .where(eq(schema.playerAccessGrants.campaignId, campaign.id));
      expect(grants).toHaveLength(developmentDemoPlayers.length);
      const demoPairs = await db
        .select({
          displayName: schema.memberships.displayName,
          label: schema.playerAccessGrants.label,
        })
        .from(schema.playerAccessGrants)
        .innerJoin(
          schema.memberships,
          eq(schema.playerAccessGrants.membershipId, schema.memberships.id),
        )
        .where(eq(schema.playerAccessGrants.campaignId, campaign.id));
      expect(
        demoPairs
          .map(({ displayName, label }) => `${displayName}|${label}`)
          .sort(),
      ).toEqual(
        developmentDemoPlayers
          .map(({ name, handle }) => `${name}|@${handle}`)
          .sort(),
      );

      await seedDevelopmentDemoContent(db as never, campaign, scene, {
        target: "local",
      });
      expect(
        await db
          .select()
          .from(schema.memberships)
          .where(eq(schema.memberships.campaignId, campaign.id)),
      ).toHaveLength(1 + developmentDemoPlayers.length);
      expect(
        await db
          .select()
          .from(schema.playerAccessGrants)
          .where(eq(schema.playerAccessGrants.campaignId, campaign.id)),
      ).toHaveLength(developmentDemoPlayers.length);
      expect(
        (
          await db
            .select({ displayName: schema.memberships.displayName })
            .from(schema.memberships)
            .where(eq(schema.memberships.campaignId, campaign.id))
        )
          .map(({ displayName }) => displayName)
          .sort(),
      ).toEqual(
        [
          seeded.gm.displayName,
          ...developmentDemoPlayers.map(({ name }) => name),
        ].sort(),
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousOptIn === undefined)
        delete process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED;
      else process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED = previousOptIn;
    }
  });
});
