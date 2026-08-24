import { defineConfig } from "drizzle-kit";

/*
 * UIX-519 follow-up: тот же молчаливый fallback, что был в `migrate.ts`.
 * `drizzle-kit studio` открывает базу на запись, а `generate` сверяется с её
 * состоянием — обе команды не должны угадывать, какую именно базу открыть.
 */
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL обязателен для drizzle-kit: команда не угадывает базу.",
  );

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
