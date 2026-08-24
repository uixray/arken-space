import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./index.js";

/*
 * UIX-519 follow-up: раньше здесь стоял молчаливый fallback на
 * `postgres://arken:arken@localhost:5432/arken`. Проект не использует dotenv и
 * не передаёт `--env-file`, поэтому забытый экспорт означал не ошибку, а
 * миграции, ушедшие в другую базу: на машине владельца порт 5432 занят
 * нативным PostgreSQL, а контейнер проекта проброшен на 5433. На хосте с
 * production это применило бы миграции к боевой базе.
 *
 * Угадывать базу для DDL нельзя. Отсутствие переменной — это ошибка запуска.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL обязателен: миграции не угадывают базу. " +
      "Экспортируйте переменную (`set -a; . ./.env; set +a`) или задайте её явно.",
  );
  process.exit(1);
}
const { client, db } = createDatabase(connectionString);

await migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
});
await client.end();
