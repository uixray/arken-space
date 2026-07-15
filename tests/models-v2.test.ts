import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";

let database: PGlite;
beforeEach(async () => {
  database = new PGlite();
  for (const file of (
    await readdir(new URL("../packages/db/drizzle/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (
        await readFile(
          new URL(`../packages/db/drizzle/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("--> statement-breakpoint", ""),
    );
  }
});
afterEach(async () => database.close());

describe("v2 domain models", () => {
  it("keeps definition controllers many-to-many and isolated by campaign", async () => {
    const db = drizzle(database, { schema });
    const [campaign, foreign] = await db
      .insert(schema.campaigns)
      .values([{ name: "A" }, { name: "B" }])
      .returning();
    if (!campaign || !foreign) throw new Error("fixture");
    const [gm, one, two] = await db
      .insert(schema.memberships)
      .values([
        { campaignId: campaign.id, role: "GM", displayName: "GM" },
        { campaignId: campaign.id, role: "PLAYER", displayName: "One" },
        { campaignId: campaign.id, role: "PLAYER", displayName: "Two" },
      ])
      .returning();
    if (!gm || !one || !two) throw new Error("fixture");
    const [definition] = await db
      .insert(schema.tokenDefinitions)
      .values({ campaignId: campaign.id, name: "Hero" })
      .returning();
    if (!definition) throw new Error("fixture");
    await db.insert(schema.tokenControllers).values([
      { tokenDefinitionId: definition.id, membershipId: one.id },
      { tokenDefinitionId: definition.id, membershipId: two.id },
    ]);
    const controllers = await db
      .select()
      .from(schema.tokenControllers)
      .where(eq(schema.tokenControllers.tokenDefinitionId, definition.id));
    expect(controllers.map((item) => item.membershipId).sort()).toEqual(
      [one.id, two.id].sort(),
    );
    const [scene] = await db
      .insert(schema.scenes)
      .values({
        campaignId: campaign.id,
        name: "Map",
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#ffffff",
          opacity: 0.2,
        },
      })
      .returning();
    if (!scene) throw new Error("fixture");
    const placements = await db
      .insert(schema.tokens)
      .values([
        {
          definitionId: definition.id,
          sceneId: scene.id,
          name: definition.name,
          x: 0,
          y: 0,
        },
        {
          definitionId: definition.id,
          sceneId: scene.id,
          name: definition.name,
          x: 64,
          y: 64,
        },
      ])
      .returning();
    expect(new Set(placements.map((item) => item.definitionId))).toEqual(
      new Set([definition.id]),
    );
  });

  it("copies catalog assignments so later template edits cannot mutate characters", async () => {
    const db = drizzle(database, { schema });
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({ name: "A" })
      .returning();
    if (!campaign) throw new Error("fixture");
    const [character] = await db
      .insert(schema.characters)
      .values({
        campaignId: campaign.id,
        name: "Hero",
        stats: {},
        skills: [],
        spells: [],
      })
      .returning();
    const [template] = await db
      .insert(schema.catalogEntries)
      .values({
        campaignId: campaign.id,
        kind: "ABILITY",
        name: "Wave",
        description: "old",
        data: { hit: "agility" },
      })
      .returning();
    if (!character || !template) throw new Error("fixture");
    const [assigned] = await db
      .insert(schema.characterCatalogEntries)
      .values({
        characterId: character.id,
        sourceCatalogEntryId: template.id,
        kind: template.kind,
        name: template.name,
        description: template.description,
        data: template.data,
      })
      .returning();
    await db
      .update(schema.catalogEntries)
      .set({ description: "new", data: { hit: "magic" } })
      .where(eq(schema.catalogEntries.id, template.id));
    const [snapshot] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, assigned!.id));
    expect(snapshot).toMatchObject({
      sourceCatalogEntryId: template.id,
      description: "old",
      data: { hit: "agility" },
    });
  });
});
