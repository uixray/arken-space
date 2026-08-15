import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * UIX-408/409, этап 0: счётчик запросов за флагом окружения.
 *
 * Нужен, чтобы «сколько запросов уходит на одну рассылку» стало измеренным
 * числом, а не расчётом из одной сборки, умноженной на семь клиентов.
 * По умолчанию хука нет вовсе — выключенная оснастка не стоит ничего.
 *
 * В хук приходит текст запроса и его параметры; наружу не идёт ни то, ни
 * другое — вызывающий получает только счётчик.
 */
export function createDatabase(connectionString: string, onQuery?: () => void) {
  const client = postgres(connectionString, {
    max: 10,
    prepare: false,
    ...(onQuery ? { debug: () => onQuery() } : {}),
  });
  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export * from "./schema.js";
