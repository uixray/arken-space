import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdir, readFile, mkdir } from "node:fs/promises";
import * as schema from "./schema.js";
import type { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";

/**
 * Локальная легковесная PostgreSQL-база данных (PGlite WebAssembly / Node) для dev-режима
 * и тестов. Позволяет поднимать сервер без зависимости от внешнего демона Docker или
 * системного PostgreSQL. Сохраняет данные в директорию `dataDir`.
 */
export async function createPgliteDatabase(dataDir = "./.data/pglite") {
  await mkdir(dataDir, { recursive: true });
  const database = new PGlite(dataDir);
  await database.exec(`
    CREATE TABLE IF NOT EXISTS _arken_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    );
  `);
  const migrationsUrl = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const res = await database.query(
      `SELECT 1 FROM _arken_migrations WHERE name = $1`,
      [file],
    );
    if (res.rows.length === 0) {
      const raw = await readFile(new URL(file, migrationsUrl), "utf8");
      await database.exec(raw.replaceAll("--> statement-breakpoint", ""));
      await database.query(
        `INSERT INTO _arken_migrations (name) VALUES ($1)`,
        [file],
      );
    }
  }
  const db = drizzle(database, { schema });
  return {
    client: {
      end: async () => {
        await database.close();
      },
    },
    db: db as unknown as ReturnType<typeof postgresDrizzle<typeof schema>>,
  };
}
