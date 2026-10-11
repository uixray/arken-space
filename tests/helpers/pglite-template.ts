import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/*
 * Applying all drizzle migrations to a fresh PGlite costs ~2.5–4 s per test
 * under `maxWorkers: 2`, and dozens of suites did it in `beforeEach`. Migrate
 * once per worker, dump the data dir, and give every test its own clone of
 * that template. Each test still gets an isolated database.
 */
const migrationsDir = new URL("../../packages/db/drizzle/", import.meta.url);

let template: Promise<File | Blob> | undefined;

async function buildTemplate() {
  const database = new PGlite();
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files)
    await database.exec(
      (await readFile(new URL(file, migrationsDir), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  const dump = await database.dumpDataDir("none");
  await database.close();
  return dump;
}

/** A fresh, fully migrated PGlite database cloned from a per-worker template. */
export async function createMigratedPglite() {
  template ??= buildTemplate();
  const database = new PGlite({ loadDataDir: await template });
  await database.waitReady;
  return database;
}
