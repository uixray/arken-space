import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { executeGameplayReset } from "../scripts/gameplay-reset-core.mjs";

describe("initial PostgreSQL migration", () => {
  it("creates the complete MVP schema", async () => {
    const database = new PGlite();
    const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
    const files = (await readdir(migrationsUrl))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const migration = (
        await readFile(new URL(file, migrationsUrl), "utf8")
      ).replaceAll("--> statement-breakpoint", "");
      await database.exec(migration);
    }

    const result = await database.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "assets",
        "action_journal",
        "audio_states",
        "campaigns",
        "characters",
        "chat_messages",
        "drawings",
        "fog_reveals",
        "feedback_attachments",
        "feedback_reports",
        "game_events",
        "invites",
        "memberships",
        "player_access_grants",
        "scenes",
        "sessions",
        "tokens",
      ]),
    );
    await database.close();
  });

  it("upgrades the previous schema to 0008 without losing memberships", async () => {
    const database = new PGlite();
    const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
    const files = (await readdir(migrationsUrl))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const target = files.findIndex((file) => file.startsWith("0008_"));
    for (const file of files.slice(0, target))
      await database.exec(
        (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    const campaignId = "20000000-0000-0000-0000-000000000001";
    const memberId = "20000000-0000-0000-0000-000000000002";
    await database.exec(
      `insert into campaigns (id,name) values ('${campaignId}','Upgrade fixture');
       insert into memberships (id,campaign_id,role,display_name) values ('${memberId}','${campaignId}','PLAYER','Retained player');`,
    );
    await database.exec(
      (
        await readFile(new URL(files[target]!, migrationsUrl), "utf8")
      ).replaceAll("--> statement-breakpoint", ""),
    );
    const retained = await database.query(
      `select id,campaign_id,display_name,revision from memberships where id='${memberId}'`,
    );
    expect(retained.rows).toEqual([
      {
        id: memberId,
        campaign_id: campaignId,
        display_name: "Retained player",
        revision: 0,
      },
    ]);
    await expect(
      database.exec(
        `insert into memberships (campaign_id,role,display_name,revision) values ('${campaignId}','PLAYER','Invalid',null)`,
      ),
    ).rejects.toThrow();
    await database.close();
  });

  it("backfills a deterministic unique chat sequence and continues monotonically", async () => {
    const database = new PGlite();
    const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
    const files = (await readdir(migrationsUrl))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const target = files.findIndex((file) => file.startsWith("0009_"));
    for (const file of files.slice(0, target))
      await database.exec(
        (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    const campaign = "30000000-0000-0000-0000-000000000001";
    const member = "30000000-0000-0000-0000-000000000002";
    await database.exec(`
      insert into campaigns (id,name) values ('${campaign}','Chat order');
      insert into memberships (id,campaign_id,role,display_name) values ('${member}','${campaign}','GM','GM');
      insert into chat_messages (id,campaign_id,membership_id,body,created_at) values
        ('30000000-0000-0000-0000-000000000005','${campaign}','${member}','later id, same time','2026-01-01T00:00:00Z'),
        ('30000000-0000-0000-0000-000000000004','${campaign}','${member}','earlier id, same time','2026-01-01T00:00:00Z'),
        ('30000000-0000-0000-0000-000000000003','${campaign}','${member}','earlier time','2025-01-01T00:00:00Z');
    `);
    await database.exec(
      (
        await readFile(new URL(files[target]!, migrationsUrl), "utf8")
      ).replaceAll("--> statement-breakpoint", ""),
    );
    const backfilled = await database.query<{ id: string; sequence: number }>(
      `select id,sequence from chat_messages order by sequence`,
    );
    expect(backfilled.rows).toEqual([
      { id: "30000000-0000-0000-0000-000000000003", sequence: 1 },
      { id: "30000000-0000-0000-0000-000000000004", sequence: 2 },
      { id: "30000000-0000-0000-0000-000000000005", sequence: 3 },
    ]);
    const inserted = await database.query<{ sequence: number }>(
      `insert into chat_messages (campaign_id,membership_id,body) values ('${campaign}','${member}','new') returning sequence`,
    );
    expect(inserted.rows[0]?.sequence).toBe(4);
    await database.close();
  });

  it("backfills the scene background frame from the existing world size", async () => {
    const database = new PGlite();
    const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
    const files = (await readdir(migrationsUrl))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const target = files.findIndex((file) => file.startsWith("0010_"));
    for (const file of files.slice(0, target))
      await database.exec(
        (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
    const campaign = "40000000-0000-0000-0000-000000000001";
    await database.exec(`
      insert into campaigns (id,name) values ('${campaign}','Geometry');
      insert into scenes (campaign_id,name,width,height,grid)
      values ('${campaign}','Wide map',4096,2048,'{"enabled":true,"size":64,"offsetX":0,"offsetY":0,"color":"#ffffff","opacity":0.2}');
    `);
    await database.exec(
      (
        await readFile(new URL(files[target]!, migrationsUrl), "utf8")
      ).replaceAll("--> statement-breakpoint", ""),
    );
    const frame = await database.query(
      `select background_x,background_y,background_width,background_height from scenes`,
    );
    expect(frame.rows).toEqual([
      {
        background_x: 0,
        background_y: 0,
        background_width: 4096,
        background_height: 2048,
      },
    ]);
    await database.close();
  });
});
it("preserves GM and assets in a disposable reset rehearsal", async () => {
  const database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  const c = "00000000-0000-0000-0000-000000000001",
    gm = "00000000-0000-0000-0000-000000000002",
    p = "00000000-0000-0000-0000-000000000003",
    foreign = "00000000-0000-0000-0000-000000000010",
    foreignGm = "00000000-0000-0000-0000-000000000011",
    scene = "00000000-0000-0000-0000-000000000005";
  await database.exec(
    `insert into campaigns (id,name) values ('${c}','C'),('${foreign}','Foreign');
     insert into memberships (id,campaign_id,role,display_name) values ('${gm}','${c}','GM','GM'),('${p}','${c}','PLAYER','P'),('${foreignGm}','${foreign}','GM','Foreign GM');
     insert into assets (id,campaign_id,uploaded_by_membership_id,kind,name,storage_key,mime_type,size_bytes) values ('00000000-0000-0000-0000-000000000004','${c}','${p}','IMAGE','A','a','image/png',1),('00000000-0000-0000-0000-000000000012','${foreign}','${foreignGm}','IMAGE','F','f','image/png',1);
     insert into scenes (id,campaign_id,name,grid) values ('${scene}','${c}','S','{}'),('00000000-0000-0000-0000-000000000013','${foreign}','Foreign S','{}');
     update campaigns set active_scene_id='${scene}',day=9,battle_active=true,battle_counter=4,revision=12 where id='${c}';
     insert into characters (id,campaign_id,owner_membership_id,name) values ('00000000-0000-0000-0000-000000000006','${c}','${p}','P');
     insert into tokens (scene_id,owner_membership_id,name,x,y) values ('${scene}','${p}','T',0,0);
     insert into fog_reveals (scene_id,x,y,width,height) values ('${scene}',0,0,1,1);
     insert into chat_messages (campaign_id,membership_id,body) values ('${c}','${p}','hi');
     insert into player_access_grants (campaign_id,membership_id,label,token_hash) values ('${c}','${p}','P','hash');`,
  );
  await database.exec("begin");
  await executeGameplayReset({ query: database.query.bind(database) }, c, gm);
  await database.exec("commit");
  const counts = await database.query(
    `select (select count(*) from memberships where campaign_id='${c}') members, (select count(*) from assets where campaign_id='${c}') assets, (select count(*) from player_access_grants where campaign_id='${c}') grants`,
  );
  expect(counts.rows[0]).toMatchObject({
    members: 1,
    assets: 1,
    grants: 0,
  });
  expect(
    (
      await database.query(
        `select uploaded_by_membership_id from assets where campaign_id='${c}'`,
      )
    ).rows[0],
  ).toMatchObject({ uploaded_by_membership_id: gm });
  expect(
    (
      await database.query(
        `select active_scene_id,day,battle_active,battle_counter,revision from campaigns where id='${c}'`,
      )
    ).rows[0],
  ).toMatchObject({
    active_scene_id: null,
    day: 1,
    battle_active: false,
    battle_counter: 0,
    revision: 0,
  });
  const cleared = await database.query(
    `select (select count(*) from scenes where campaign_id='${c}') scenes, (select count(*) from characters where campaign_id='${c}') characters, (select count(*) from chat_messages where campaign_id='${c}') chat`,
  );
  expect(cleared.rows[0]).toMatchObject({ scenes: 0, characters: 0, chat: 0 });
  const foreignCounts = await database.query(
    `select (select count(*) from memberships where campaign_id='${foreign}') members, (select count(*) from scenes where campaign_id='${foreign}') scenes, (select count(*) from assets where campaign_id='${foreign}') assets`,
  );
  expect(foreignCounts.rows[0]).toMatchObject({
    members: 1,
    scenes: 1,
    assets: 1,
  });
  await database.close();
});

it("rejects a retained membership that is not the campaign GM", async () => {
  const database = new PGlite();
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrationsUrl))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  const c = "10000000-0000-0000-0000-000000000001";
  const player = "10000000-0000-0000-0000-000000000002";
  await database.exec(
    `insert into campaigns (id,name) values ('${c}','C'); insert into memberships (id,campaign_id,role,display_name) values ('${player}','${c}','PLAYER','P');`,
  );
  await expect(
    executeGameplayReset({ query: database.query.bind(database) }, c, player),
  ).rejects.toThrow("RETAINED_GM_INVALID");
  await database.close();
});
