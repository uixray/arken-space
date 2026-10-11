import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

describe("explicit audio purpose migration", () => {
  let database: PGlite | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it("backfills by existing associations, leaves other kinds null, and is skipped on runner replay", async () => {
    database = new PGlite();
    await database.exec(`
      CREATE TYPE asset_kind AS ENUM ('AUDIO', 'IMAGE');
      CREATE TABLE assets (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, kind asset_kind NOT NULL);
      CREATE TABLE campaign_sounds (campaign_id uuid NOT NULL, asset_id uuid NOT NULL);
      CREATE TABLE campaign_audio_tracks (campaign_id uuid NOT NULL, asset_id uuid NOT NULL);
      CREATE TABLE applied_migrations (name text PRIMARY KEY);
    `);
    const campaignId = "10000000-0000-4000-8000-000000000001";
    const ids = {
      unknown: "20000000-0000-4000-8000-000000000001",
      sound: "20000000-0000-4000-8000-000000000002",
      track: "20000000-0000-4000-8000-000000000003",
      both: "20000000-0000-4000-8000-000000000004",
      image: "20000000-0000-4000-8000-000000000005",
    };
    await database.query(
      `INSERT INTO assets (id, campaign_id, kind) VALUES
       ($1, $6, 'AUDIO'), ($2, $6, 'AUDIO'), ($3, $6, 'AUDIO'),
       ($4, $6, 'AUDIO'), ($5, $6, 'IMAGE')`,
      [ids.unknown, ids.sound, ids.track, ids.both, ids.image, campaignId],
    );
    await database.query(
      `INSERT INTO campaign_sounds VALUES ($1, $2), ($1, $3)`,
      [campaignId, ids.sound, ids.both],
    );
    await database.query(
      `INSERT INTO campaign_audio_tracks VALUES ($1, $2), ($1, $3)`,
      [campaignId, ids.track, ids.both],
    );

    const migration = await readFile(
      new URL("../../../packages/db/drizzle/0056_explicit_audio_purpose.sql", import.meta.url),
      "utf8",
    );
    const applyPending = async () => {
      const applied = await database!.query<{ name: string }>(
        "SELECT name FROM applied_migrations WHERE name = $1",
        ["0056_explicit_audio_purpose.sql"],
      );
      if (applied.rows.length > 0) return;
      await database!.exec(migration.replaceAll("--> statement-breakpoint", ""));
      await database!.query("INSERT INTO applied_migrations (name) VALUES ($1)", ["0056_explicit_audio_purpose.sql"]);
    };

    await applyPending();
    const first = await database.query<{ id: string; audio_purpose: string | null }>(
      "SELECT id, audio_purpose FROM assets ORDER BY id",
    );
    await applyPending();
    const second = await database.query<{ id: string; audio_purpose: string | null }>(
      "SELECT id, audio_purpose FROM assets ORDER BY id",
    );
    expect(Object.fromEntries(first.rows.map((row) => [row.id, row.audio_purpose]))).toEqual({
      [ids.unknown]: "MUSIC",
      [ids.sound]: "SOUND_EFFECT",
      [ids.track]: "MUSIC",
      [ids.both]: "BOTH",
      [ids.image]: null,
    });
    expect(second.rows).toEqual(first.rows);
  });

  it("applies the real 0056 migration to a schema-56 baseline through Drizzle's migrator and safely replays", async () => {
    database = new PGlite();
    const db = drizzle(database);
    const migrationsFolder = await mkdtemp(join(tmpdir(), "arken-audio-purpose-migration-"));
    try {
      // Schema-56 baseline: tables that 0056 reads, plus representative pre-existing usages.
      await database.exec(`
        CREATE TYPE asset_kind AS ENUM ('AUDIO', 'IMAGE');
        CREATE TABLE assets (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, kind asset_kind NOT NULL);
        CREATE TABLE campaign_sounds (campaign_id uuid NOT NULL, asset_id uuid NOT NULL);
        CREATE TABLE campaign_audio_tracks (campaign_id uuid NOT NULL, asset_id uuid NOT NULL);
      `);
      const campaignId = "10000000-0000-4000-8000-000000000001";
      const ids = {
        unknown: "20000000-0000-4000-8000-000000000001",
        sound: "20000000-0000-4000-8000-000000000002",
        track: "20000000-0000-4000-8000-000000000003",
        both: "20000000-0000-4000-8000-000000000004",
        image: "20000000-0000-4000-8000-000000000005",
      };
      await database.query(
        `INSERT INTO assets (id, campaign_id, kind) VALUES
         ($1, $6, 'AUDIO'), ($2, $6, 'AUDIO'), ($3, $6, 'AUDIO'),
         ($4, $6, 'AUDIO'), ($5, $6, 'IMAGE')`,
        [ids.unknown, ids.sound, ids.track, ids.both, ids.image, campaignId],
      );
      await database.query("INSERT INTO campaign_sounds VALUES ($1, $2), ($1, $3)", [campaignId, ids.sound, ids.both]);
      await database.query("INSERT INTO campaign_audio_tracks VALUES ($1, $2), ($1, $3)", [campaignId, ids.track, ids.both]);

      const sql = await readFile(
        new URL("../../../packages/db/drizzle/0056_explicit_audio_purpose.sql", import.meta.url),
        "utf8",
      );
      const journal = {
        version: "7",
        dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1791599496876, tag: "0056_explicit_audio_purpose", breakpoints: true }],
      };
      await writeFile(join(migrationsFolder, "0056_explicit_audio_purpose.sql"), sql);
      await mkdir(join(migrationsFolder, "meta"));
      await writeFile(join(migrationsFolder, "meta", "_journal.json"), JSON.stringify(journal));

      await migrate(db, { migrationsFolder });
      const purposes = await database.query<{ id: string; audio_purpose: string | null }>(
        "SELECT id, audio_purpose FROM assets ORDER BY id",
      );
      expect(Object.fromEntries(purposes.rows.map((row) => [row.id, row.audio_purpose]))).toEqual({
        [ids.unknown]: "MUSIC",
        [ids.sound]: "SOUND_EFFECT",
        [ids.track]: "MUSIC",
        [ids.both]: "BOTH",
        [ids.image]: null,
      });
      await migrate(db, { migrationsFolder });
      const applied = await database.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations"',
      );
      expect(applied.rows[0]?.count).toBe(1);
    } finally {
      await rm(migrationsFolder, { recursive: true, force: true });
    }
  });
});
