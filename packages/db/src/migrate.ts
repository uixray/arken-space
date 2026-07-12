import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./index.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://arken:arken@localhost:5432/arken";
const { client, db } = createDatabase(connectionString);

await migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
await client.end();
