import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 10, prepare: false });
  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export * from "./schema.js";
