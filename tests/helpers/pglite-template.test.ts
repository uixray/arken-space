import { describe, expect, it } from "vitest";
import { createMigratedPglite } from "./pglite-template.js";

describe("migrated PGlite template isolation", () => {
  it("clones all migrations without sharing test mutations", async () => {
    const first = await createMigratedPglite();
    const second = await createMigratedPglite();
    try {
      const tables = await first.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'",
      );
      expect(tables.rows.map(row => row.tablename)).toEqual(expect.arrayContaining([
        "audio_clip_candidates", "audio_clip_provenance", "campaign_media_reservations",
      ]));
      await first.exec("create table template_isolation_probe (value integer); insert into template_isolation_probe values (7)");
      const other = await second.query<{ relation: string | null }>(
        "select to_regclass('public.template_isolation_probe')::text as relation",
      );
      expect(other.rows[0]?.relation).toBeNull();
      await second.exec("create table template_isolation_probe (value integer); insert into template_isolation_probe values (11)");
      expect((await first.query<{ value: number }>("select value from template_isolation_probe")).rows).toEqual([{ value: 7 }]);
      expect((await second.query<{ value: number }>("select value from template_isolation_probe")).rows).toEqual([{ value: 11 }]);
    } finally {
      await first.close();
      await second.close();
    }
    const third = await createMigratedPglite();
    try {
      expect((await third.query<{ relation: string | null }>("select to_regclass('public.template_isolation_probe')::text as relation")).rows[0]?.relation).toBeNull();
    } finally { await third.close(); }
  });
});
