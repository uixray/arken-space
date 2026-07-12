import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

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
        "scenes",
        "sessions",
        "tokens",
      ]),
    );
    await database.close();
  });
});
