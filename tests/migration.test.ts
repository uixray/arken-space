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
        "audio_states",
        "campaigns",
        "characters",
        "chat_messages",
        "fog_reveals",
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
    p = "00000000-0000-0000-0000-000000000003";
  await database.exec(
    `insert into campaigns (id,name) values ('${c}','C'); insert into memberships (id,campaign_id,role,display_name) values ('${gm}','${c}','GM','GM'),('${p}','${c}','PLAYER','P'); insert into assets (id,campaign_id,uploaded_by_membership_id,kind,name,storage_key,mime_type,size_bytes) values ('00000000-0000-0000-0000-000000000004','${c}','${p}','IMAGE','A','a','image/png',1); insert into player_access_grants (campaign_id,membership_id,label,token_hash) values ('${c}','${p}','P','hash');`,
  );
  await executeGameplayReset({ query: database.query.bind(database) }, c, gm);
  const counts = await database.query(
    "select (select count(*) from memberships) members, (select count(*) from assets) assets, (select count(*) from player_access_grants) grants",
  );
  expect(counts.rows[0]).toMatchObject({
    members: 1,
    assets: 1,
    grants: 0,
  });
  expect(
    (await database.query("select uploaded_by_membership_id from assets"))
      .rows[0],
  ).toMatchObject({ uploaded_by_membership_id: gm });
  await database.close();
});
