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
const ca = "91000000-0000-4000-8000-000000000001",
  cb = "92000000-0000-4000-8000-000000000001";
const ma = "91000000-0000-4000-8000-000000000002",
  mb = "92000000-0000-4000-8000-000000000002";
const media = "91000000-0000-4000-8000-000000000003",
  wrongMedia = "92000000-0000-4000-8000-000000000004",
  pack = "91000000-0000-4000-8000-000000000005",
  sticker = "91000000-0000-4000-8000-000000000006",
  playerPack = "91000000-0000-4000-8000-000000000007";

describe("0019 sticker packs migration", () => {
  it("enforces tenant, asset-kind, lifecycle, consent and immutable-message boundaries", async () => {
    const db = await migratedDatabase();
    await db.exec(
      `insert into campaigns(id,name) values ('${ca}','A'),('${cb}','B'); insert into memberships(id,campaign_id,role,display_name) values ('${ma}','${ca}','PLAYER','A'),('${mb}','${cb}','PLAYER','B'); insert into sticker_media(id,campaign_id,uploaded_by_membership_id,storage_key,mime_type,size_bytes,width,height,sha256) values ('${media}','${ca}','${ma}','s.webp','image/webp',100,128,128,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),('${wrongMedia}','${cb}','${mb}','f.webp','image/webp',100,128,128,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); insert into sticker_packs(id,campaign_id,name,subject,subject_label,audience,send_policy,lifecycle) values ('${pack}','${ca}','Creatures','CREATURE','Creatures','ENTITLED','ENTITLED_ONLY','ACTIVE'); insert into sticker_packs(id,campaign_id,name,subject,subject_membership_id,audience,send_policy,lifecycle) values ('${playerPack}','${ca}','Player A','PLAYER','${ma}','CAMPAIGN','ALL_MEMBERS','ACTIVE');`,
    );
    await expect(
      db.exec(
        `insert into sticker_pack_entitlements(campaign_id,pack_id,membership_id) values ('${ca}','${pack}','${mb}')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into stickers(campaign_id,pack_id,media_id,name,alt_text,provenance_type) values ('${ca}','${pack}','${wrongMedia}','bad','bad','ORIGINAL')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into sticker_packs(campaign_id,name,subject,subject_label,lifecycle) values ('${ca}','bad','NPC','n','DEPRECATED')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into player_likeness_consents(campaign_id,pack_id,membership_id,status,granted_at) values ('${ca}','${pack}','${ma}','GRANTED',now())`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into sticker_packs(campaign_id,name,subject,lifecycle) values ('${ca}','null pass','NPC','ACTIVE')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into sticker_packs(campaign_id,name,subject,lifecycle) values ('${ca}','player','PLAYER','ACTIVE')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.exec(
        `insert into stickers(campaign_id,pack_id,media_id,name,alt_text,provenance_type,source_reference) values ('${ca}','${pack}','${media}','bad import','bad','IMPORTED','source')`,
      ),
    ).rejects.toThrow();
    await db.exec(
      `insert into sticker_pack_entitlements(campaign_id,pack_id,membership_id) values ('${ca}','${pack}','${ma}'); insert into player_likeness_consents(campaign_id,pack_id,membership_id,status,granted_at) values ('${ca}','${playerPack}','${ma}','GRANTED',now()); insert into stickers(id,campaign_id,pack_id,media_id,name,alt_text,provenance_type,author_credit) values ('${sticker}','${ca}','${pack}','${media}','Wave','Character waves','ORIGINAL','Artist');`,
    );
    const thread = (
      await db.query<{ id: string }>(
        `select id from chat_threads where campaign_id='${ca}' and stream='TABLE'`,
      )
    ).rows[0]!.id;
    await expect(
      db.exec(
        `insert into chat_messages(campaign_id,membership_id,thread_id,kind,body) values ('${ca}','${ma}','${thread}','TEXT','', '${sticker}')`,
      ),
    ).rejects.toThrow();
    const msg = "91000000-0000-4000-8000-000000000009";
    await db.exec(
      `insert into chat_messages(id,campaign_id,membership_id,thread_id,kind,body,sticker_id,sticker_presentation) values ('${msg}','${ca}','${ma}','${thread}','TEXT','','${sticker}','{"name":"Wave","altText":"Character waves","assetUrl":"/safe","width":128,"height":128}')`,
    );
    await expect(
      db.exec(`update chat_messages set body='changed' where id='${msg}'`),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.exec(
        `update chat_messages set sticker_presentation='{"name":"changed"}' where id='${msg}'`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.exec(
        `insert into chat_messages(campaign_id,membership_id,thread_id,kind,body,sticker_id,sticker_presentation) values ('${ca}','${ma}','${thread}','TEXT','bad','${sticker}','{}')`,
      ),
    ).rejects.toThrow();
    await db.close();
  });
});
