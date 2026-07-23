import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

async function migratedDatabase() {
  const database = new PGlite();
  const url = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(url))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    for (const statement of (await readFile(new URL(file, url), "utf8")).split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await database.exec(statement);
    }
  return database;
}

const campaignA = "a1000000-0000-4000-8000-000000000001";
const campaignB = "b1000000-0000-4000-8000-000000000001";
const memberA = "a1000000-0000-4000-8000-000000000002";
const memberB = "b1000000-0000-4000-8000-000000000002";
const assetA = "a1000000-0000-4000-8000-000000000003";
const assetB = "b1000000-0000-4000-8000-000000000003";
const sceneA = "a1000000-0000-4000-8000-000000000004";
const sceneB = "b1000000-0000-4000-8000-000000000004";
const mapA = "a1000000-0000-4000-8000-000000000005";
const mapB = "b1000000-0000-4000-8000-000000000005";
const locationA = "a1000000-0000-4000-8000-000000000006";
const locationB = "b1000000-0000-4000-8000-000000000006";

describe("0020 world maps migration", () => {
  it("enforces campaign-local approved backgrounds, normalized locations, scene links and location-only party position", async () => {
    const db = await migratedDatabase();
    await db.exec(`
      insert into campaigns(id,name) values ('${campaignA}','A'),('${campaignB}','B');
      insert into memberships(id,campaign_id,role,display_name) values ('${memberA}','${campaignA}','GM','GM A'),('${memberB}','${campaignB}','GM','GM B');
      insert into assets(id,campaign_id,uploaded_by_membership_id,kind,name,storage_key,mime_type,size_bytes)
        values ('${assetA}','${campaignA}','${memberA}','MAP','A map','a-map','image/jpeg',128),('${assetB}','${campaignB}','${memberB}','MAP','B map','b-map','image/jpeg',128);
      insert into scenes(id,campaign_id,name,grid) values ('${sceneA}','${campaignA}','A scene','{}'),('${sceneB}','${campaignB}','B scene','{}');
      insert into world_maps(id,campaign_id,name,scope,visibility,lifecycle,background_asset_id,background_asset_approved_by_membership_id,background_asset_approved_at,published_at)
        values ('${mapA}','${campaignA}','Arken','WORLD','CAMPAIGN','PUBLISHED','${assetA}','${memberA}',now(),now()),('${mapB}','${campaignB}','Elsewhere','REGION','CAMPAIGN','PUBLISHED','${assetB}','${memberB}',now(),now());
      insert into world_map_locations(id,campaign_id,map_id,name,summary,visibility,x,y) values ('${locationA}','${campaignA}','${mapA}','Home','Known place','PUBLIC',0.25,0.75),('${locationB}','${campaignB}','${mapB}','Elsewhere','', 'DISCOVERED',0.5,0.5);
    `);

    await expect(
      db.exec(
        `insert into world_maps(campaign_id,name,lifecycle,published_at) values ('${campaignA}','unapproved','PUBLISHED',now())`,
      ),
    ).rejects.toThrow();
    await db.exec(
      `insert into world_maps(campaign_id,name,background_asset_id) values ('${campaignA}','staged draft','${assetA}')`,
    );
    await expect(
      db.exec(
        `insert into world_maps(campaign_id,name,lifecycle,background_asset_id,published_at) values ('${campaignA}','unapproved staged asset','PUBLISHED','${assetA}',now())`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_maps(campaign_id,name,background_asset_approved_by_membership_id,background_asset_approved_at) values ('${campaignA}','approval without asset','${memberA}',now())`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_maps(campaign_id,name,background_asset_id,background_asset_approved_by_membership_id,background_asset_approved_at) values ('${campaignA}','cross asset','${assetB}','${memberA}',now())`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_map_locations(campaign_id,map_id,name,x,y) values ('${campaignA}','${mapA}','outside',1.01,0)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_map_locations(campaign_id,map_id,name,gm_notes,x,y) values ('${campaignA}','${mapA}','too much',repeat('x',10001),0,0)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_map_locations(campaign_id,map_id,name,x,y) values ('${campaignA}','${mapB}','cross map',0,0)`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_map_location_scenes(campaign_id,location_id,scene_id) values ('${campaignA}','${locationA}','${sceneB}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into world_map_party_position(campaign_id,map_id,location_id,updated_by_membership_id) values ('${campaignA}','${mapA}','${locationB}','${memberA}')`,
      ),
    ).rejects.toThrow();

    await db.exec(`
      insert into world_map_location_scenes(campaign_id,location_id,scene_id) values ('${campaignA}','${locationA}','${sceneA}');
      insert into world_map_party_position(campaign_id,map_id,location_id,updated_by_membership_id) values ('${campaignA}','${mapA}','${locationA}','${memberA}');
    `);
    await expect(
      db.exec(
        `update world_map_party_position set location_id='${locationB}' where campaign_id='${campaignA}'`,
      ),
    ).rejects.toThrow();
    await db.close();
  });
});
