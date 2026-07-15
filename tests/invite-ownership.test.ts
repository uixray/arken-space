import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { claimInviteOwnership } from "../apps/server/src/routes.js";

let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = (
      await readFile(new URL(file, migrationsUrl), "utf8")
    ).replaceAll("--> statement-breakpoint", "");
    await database.exec(sql);
  }
});

afterEach(async () => database.close());

describe("invite ownership lifecycle", () => {
  it("seeds controllers for unassigned linked definitions without rewriting placements", async () => {
    const db = drizzle(database, { schema });
    const [campaign] = await db
      .insert(schema.campaigns)
      .values({ name: "Invite ownership" })
      .returning();
    if (!campaign) throw new Error("CAMPAIGN_CREATE_FAILED");
    const [gm] = await db
      .insert(schema.memberships)
      .values({ campaignId: campaign.id, role: "GM", displayName: "GM" })
      .returning();
    if (!gm) throw new Error("GM_CREATE_FAILED");
    const [character, otherCharacter] = await db
      .insert(schema.characters)
      .values([
        { campaignId: campaign.id, name: "Claimed" },
        { campaignId: campaign.id, name: "Other" },
      ])
      .returning();
    if (!character || !otherCharacter)
      throw new Error("CHARACTER_CREATE_FAILED");
    const [scene] = await db
      .insert(schema.scenes)
      .values({
        campaignId: campaign.id,
        name: "Scene",
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
    if (!scene) throw new Error("SCENE_CREATE_FAILED");
    const [claimedToken, otherToken] = await db
      .insert(schema.tokens)
      .values([
        {
          sceneId: scene.id,
          characterId: character.id,
          name: "Claimed token",
          x: 0,
          y: 0,
        },
        {
          sceneId: scene.id,
          characterId: otherCharacter.id,
          name: "Other token",
          x: 64,
          y: 64,
        },
      ])
      .returning();
    const [invite] = await db
      .insert(schema.invites)
      .values({
        campaignId: campaign.id,
        characterId: character.id,
        label: "Player",
        tokenHash: "test-token-hash",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    if (!claimedToken || !otherToken || !invite)
      throw new Error("FIXTURE_CREATE_FAILED");

    const member = await claimInviteOwnership(db as never, invite, "Player");
    const characters = await db.select().from(schema.characters);
    const tokens = await db.select().from(schema.tokens);
    const controllers = await db.select().from(schema.tokenControllers);

    expect(
      characters.find((item) => item.id === character.id)?.ownerMembershipId,
    ).toBe(member.id);
    expect(
      tokens.find((item) => item.id === claimedToken.id)?.ownerMembershipId,
    ).toBeNull();
    expect(controllers).toContainEqual(
      expect.objectContaining({
        tokenDefinitionId: claimedToken.definitionId,
        membershipId: member.id,
      }),
    );
    expect(
      tokens.find((item) => item.id === otherToken.id)?.ownerMembershipId,
    ).toBeNull();
  });
});
