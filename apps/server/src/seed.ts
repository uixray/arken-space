import { eq, sql } from "drizzle-orm";
import {
  audioStates,
  campaigns,
  characters,
  gmAccessCredentials,
  memberships,
  scenes,
} from "@arken/db";
import { createStarterCharacter } from "@arken/system";
import { env } from "./env.js";
import { hashToken } from "./security.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export async function reconcileTokenOwnership(db: Database) {
  await db.execute(sql`
    update tokens as token
    set owner_membership_id = character.owner_membership_id,
        updated_at = now()
    from characters as character
    where token.character_id = character.id
      and token.owner_membership_id is distinct from character.owner_membership_id
  `);
}

export async function ensureSeed(db: Database) {
  let [campaign] = await db.select().from(campaigns).limit(1);
  if (!campaign) {
    [campaign] = await db
      .insert(campaigns)
      .values({ name: "Arken — первая кампания" })
      .returning();
  }
  if (!campaign) throw new Error("Could not create campaign");

  await db
    .insert(gmAccessCredentials)
    .values({
      campaignId: campaign.id,
      tokenHash: hashToken(env.GM_ACCESS_TOKEN),
    })
    .onConflictDoNothing();

  let [gm] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.campaignId, campaign.id))
    .limit(1);
  if (!gm) {
    [gm] = await db
      .insert(memberships)
      .values({ campaignId: campaign.id, role: "GM", displayName: "Мастер" })
      .returning();
  }

  let [scene] = await db
    .select()
    .from(scenes)
    .where(eq(scenes.campaignId, campaign.id))
    .limit(1);
  if (!scene) {
    [scene] = await db
      .insert(scenes)
      .values({
        campaignId: campaign.id,
        name: "Первая сцена",
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#c8b78b",
          opacity: 0.22,
        },
      })
      .returning();
    if (scene)
      await db
        .update(campaigns)
        .set({ activeSceneId: scene.id })
        .where(eq(campaigns.id, campaign.id));
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaign.id))
    .limit(1);
  if (!character) {
    const starter = createStarterCharacter();
    await db
      .insert(characters)
      .values({ campaignId: campaign.id, name: "Путник", ...starter });
  }

  await db
    .insert(audioStates)
    .values({ campaignId: campaign.id })
    .onConflictDoNothing();
  await reconcileTokenOwnership(db);
  return { campaign, gm };
}
