import { copyFile, mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { createDatabase } from "@arken/db";

async function assertLedger(database: ReturnType<typeof createDatabase>, folder: string) {
  const expected = readMigrationFiles({ migrationsFolder: folder });
  const actual = await database.client<{hash:string; created_at:string}[]>`
    select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at,id`;
  if (actual.length !== expected.length || actual.some((row, index) =>
    row.hash !== expected[index]?.hash || row.created_at !== String(expected[index]?.folderMillis)))
    throw new Error("Synthetic migration ledger mismatch");
}

/** Only called with a new isolated test DB. Rehearse a real ledger transition
 * using immutable copies of 0000–0087, then the complete candidate history. */
export async function rehearseCreationMigration(database: ReturnType<typeof createDatabase>) {
  const source = fileURLToPath(new URL("../../packages/db/drizzle/", import.meta.url));
  const folder = await mkdtemp(join(tmpdir(), "arken-uix461-migrations-"));
  const meta = join(folder, "meta");
  const copied: string[] = [];
  try {
    await mkdir(meta);
    const journal = JSON.parse(await readFile(join(source, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    } & Record<string, unknown>;
    if (journal.entries.at(-1)?.tag !== "0088_creation_consumption_undo")
      throw new Error("Unexpected candidate migration history");
    const before = journal.entries.slice(0, -1);
    for (const entry of before) {
      const name = `${entry.tag}.sql`;
      await copyFile(join(source, name), join(folder, name));
      copied.push(name);
    }
    await writeFile(join(meta, "_journal.json"), JSON.stringify({ ...journal, entries: before }));
    await migrate(database.db, { migrationsFolder: folder });
    await assertLedger(database, folder);
    const [prior] = await database.client`select count(*)::int as count from drizzle.__drizzle_migrations`;
    if (prior?.count !== before.length) throw new Error("Prior ledger mismatch");
    const sentinel = crypto.randomUUID();
    await database.client`insert into campaigns (id, name) values (${sentinel}, 'Synthetic pre-migration campaign')`;
    const member=crypto.randomUUID(), character=crypto.randomUUID(), entry=crypto.randomUUID(), pack=crypto.randomUUID();
    const rules=crypto.randomUUID(), template=crypto.randomUUID(), version=crypto.randomUUID(), object=crypto.randomUUID();
    const hash="a".repeat(64), mechanics={activation:{type:"ACTION"}};
    const snapshot={versionHash:hash,name:"Existing synthetic object",description:"unchanged",appearance:"",entryKind:"ABILITY",entryData:mechanics,baseItemId:null};
    const evaluation={card:{name:snapshot.name,description:snapshot.description,appearance:"",artifact:null},entryData:mechanics};
    await database.client`insert into memberships (id,campaign_id,role,display_name) values (${member},${sentinel},'PLAYER','Synthetic owner')`;
    await database.client`insert into characters (id,campaign_id,owner_membership_id,name) values (${character},${sentinel},${member},'Synthetic holder')`;
    await database.client`insert into character_catalog_entries (id,character_id,kind,name,description,data) values (${entry},${character},'ABILITY',${snapshot.name},${snapshot.description},${JSON.stringify(mechanics)}::jsonb)`;
    await database.client`insert into creation_rule_packs (id,campaign_id,kind,name,created_by_membership_id) values (${pack},${sentinel},'SKILL','Synthetic rules',${member})`;
    await database.client`insert into creation_rule_versions (id,campaign_id,pack_id,number,published,source,source_hash,created_by_membership_id) values (${rules},${sentinel},${pack},1,true,'{}'::jsonb,${hash},${member})`;
    await database.client`insert into creation_templates (id,campaign_id,author_membership_id,kind) values (${template},${sentinel},${member},'SKILL')`;
    await database.client`insert into creation_template_versions (id,campaign_id,template_id,number,rule_version_id,design,evaluation,version_hash,created_by_membership_id) values (${version},${sentinel},${template},1,${rules},'{}'::jsonb,${JSON.stringify(evaluation)}::jsonb,${hash},${member})`;
    await database.client`insert into creation_objects (id,campaign_id,version_id,kind,character_id,entry_id,status,level,stage,snapshot,snapshot_hash,paid_basis,created_action_id,created_by_membership_id) values (${object},${sentinel},${version},'SKILL',${character},${entry},'ACTIVE',1,'CRAFTED',${JSON.stringify(snapshot)}::jsonb,${hash},'{}'::jsonb,${crypto.randomUUID()},${member})`;
    const [objectBefore] = await database.client`select to_jsonb(o) as value from creation_objects o where id=${object}`;
    const [entryBefore] = await database.client`select to_jsonb(e) as value from character_catalog_entries e where id=${entry}`;
    await migrate(database.db, { migrationsFolder: source });
    await assertLedger(database, source);
    const [after] = await database.client`select count(*)::int as count from drizzle.__drizzle_migrations`;
    const [preserved] = await database.client`select name from campaigns where id=${sentinel}`;
    const [objectAfter] = await database.client`select to_jsonb(o) as value from creation_objects o where id=${object}`;
    const [entryAfter] = await database.client`select to_jsonb(e) as value from character_catalog_entries e where id=${entry}`;
    if (after?.count !== journal.entries.length || preserved?.name !== "Synthetic pre-migration campaign")
      throw new Error("Migration ledger or existing campaign changed unexpectedly");
    if (JSON.stringify(objectBefore?.value) !== JSON.stringify(objectAfter?.value) ||
        JSON.stringify(entryBefore?.value) !== JSON.stringify(entryAfter?.value))
      throw new Error("Existing issued object changed during migration");
    let protectedEntry = false;
    try { await database.client`update character_catalog_entries set name='unauthorized' where id=${entry}`; }
    catch (error) { protectedEntry = error instanceof Error && error.message.includes("CREATION_BOUND_ENTRY"); }
    if (!protectedEntry) throw new Error("Existing issued entry is no longer protected");
    await migrate(database.db, { migrationsFolder: source });
    const [repeat] = await database.client`select count(*)::int as count from drizzle.__drizzle_migrations`;
    if (repeat?.count !== after.count) throw new Error("Migration replay added a ledger entry");
  } finally {
    // Only files created in this fresh, non-recursively removed directory.
    for (const name of copied) await unlink(join(folder, name));
    if ((await readdir(meta)).includes("_journal.json")) await unlink(join(meta, "_journal.json"));
    await rmdir(meta);
    await rmdir(folder);
  }
}
