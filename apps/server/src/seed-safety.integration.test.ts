import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { ensureSeed } from "./seed.js";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
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
});
