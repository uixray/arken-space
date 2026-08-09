import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * UIX-393 added `characters.archived_by_membership_id` with an ON DELETE
 * RESTRICT foreign key, so "who archived this character" stays answerable.
 * RESTRICT interacts with deletion in ways that are easy to get wrong and
 * would surface as a confusing FK error rather than a clear failure, so the
 * three cases that actually matter are pinned here against the real
 * migration files.
 */
const CAMPAIGN = "11111111-1111-1111-1111-111111111111";
const GM = "22222222-2222-2222-2222-222222222222";
const PLAYER = "44444444-4444-4444-4444-444444444444";
const CHARACTER = "33333333-3333-3333-3333-333333333333";

let migrations: string[];

beforeAll(async () => {
  const migrationsUrl = new URL("../packages/db/drizzle/", import.meta.url);
  const files = (await readdir(migrationsUrl))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  migrations = await Promise.all(
    files.map(async (file) =>
      (await readFile(new URL(file, migrationsUrl), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    ),
  );
});

async function campaignWithArchivedCharacter() {
  const database = new PGlite();
  for (const migration of migrations) await database.exec(migration);
  await database.exec(`
    insert into campaigns (id, name) values ('${CAMPAIGN}', 'Campaign');
    insert into memberships (id, campaign_id, display_name, role) values
      ('${GM}', '${CAMPAIGN}', 'GM', 'GM'),
      ('${PLAYER}', '${CAMPAIGN}', 'Player', 'PLAYER');
    insert into characters
      (id, campaign_id, name, lifecycle, archived_at, archived_by_membership_id)
    values
      ('${CHARACTER}', '${CAMPAIGN}', 'Hero', 'ARCHIVED', now(), '${GM}');
  `);
  return database;
}

describe("archived-character archiver foreign key", () => {
  it("does not block deleting the whole campaign", async () => {
    const database = await campaignWithArchivedCharacter();
    await database.exec(`delete from campaigns where id = '${CAMPAIGN}';`);
    const remaining = await database.query<{ count: number }>(
      "select count(*)::int as count from characters",
    );
    expect(remaining.rows[0]?.count).toBe(0);
  });

  it("does not block the gameplay reset, which only removes PLAYER memberships", async () => {
    // Archiving is GM-only, so the archiver is always a GM membership and
    // the reset's PLAYER-scoped delete can never collide with it.
    const database = await campaignWithArchivedCharacter();
    await database.exec(
      `delete from memberships where campaign_id = '${CAMPAIGN}' and role = 'PLAYER';`,
    );
    const survivors = await database.query<{ id: string }>(
      "select id from memberships order by id",
    );
    expect(survivors.rows.map((row) => row.id)).toEqual([GM]);
  });

  it("blocks deleting the archiver's own membership, and the shape check forbids nulling the column instead", async () => {
    // Documents the real constraint a future "remove a GM" / "leave
    // campaign" flow has to deal with: it must transfer or clear the
    // archive attribution first, because neither deleting the membership
    // nor blanking the reference is permitted while the row is ARCHIVED.
    const database = await campaignWithArchivedCharacter();
    await expect(
      database.exec(`delete from memberships where id = '${GM}';`),
    ).rejects.toThrow();
    await expect(
      database.exec(
        `update characters set archived_by_membership_id = null where id = '${CHARACTER}';`,
      ),
    ).rejects.toThrow();
  });
});
