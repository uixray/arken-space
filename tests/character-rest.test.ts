import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { env } from "../apps/server/src/env.js";

/**
 * UIX-425 — отдых восстанавливает на величину регена, а не до максимума.
 *
 * Было три расхождения с правилом сразу, и все в сторону «слишком щедро»:
 * длинный отдых восстанавливал до максимума, короткий давал четверть максимума
 * вместо половины регена, а округление шло вверх. У персонажа с маной 20 и
 * регеном 9 длинный отдых давал +20 вместо +9 — ограничение ресурса в игре
 * фактически не работало.
 */
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;

const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  character: crypto.randomUUID(),
};
const secret = "g".repeat(40);

const restTo = async (rest: "SHORT" | "LONG") => {
  const [before] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, ids.character));
  const response = await app.inject({
    method: "PATCH",
    url: `/api/characters/${ids.character}/counters`,
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${secret}` },
    payload: {
      actionId: crypto.randomUUID(),
      revision: before!.revision,
      rest,
    },
  });
  const [after] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, ids.character));
  return {
    status: response.statusCode,
    resources: after!.resources as Record<string, { current: number }>,
  };
};

const setUp = async (
  resources: Record<string, unknown>,
  stats: Record<string, number>,
) => {
  await db
    .update(schema.characters)
    .set({ resources: resources as never, stats })
    .where(eq(schema.characters.id, ids.character));
};

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  db = drizzle(database, { schema });
  await db
    .insert(schema.campaigns)
    .values({ id: ids.campaign, name: "Кампания" });
  await db.insert(schema.memberships).values({
    id: ids.gm,
    campaignId: ids.campaign,
    role: "GM",
    displayName: "Мастер",
  });
  await db.insert(schema.sessions).values({
    membershipId: ids.gm,
    tokenHash: hashToken(secret),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    name: "Ллойд",
  });
  app = Fastify();
  await app.register(cookie);
  registerRoutes(
    app,
    db as never,
    {
      in: () => ({ fetchSockets: async () => [] }),
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

describe("отдых по регену", () => {
  it("длинный отдых добавляет реген, а не восполняет всё", async () => {
    // Цифры со скриншота мастера: мана 20, реген маны 9.
    await setUp(
      {
        physicalPower: { current: 2, maximum: 20 },
        magicPower: { current: 3, maximum: 20 },
      },
      { enduranceRegen: 5, manaRegen: 9 },
    );
    const { status, resources } = await restTo("LONG");
    expect(status).toBe(200);
    expect(resources.physicalPower!.current).toBe(7);
    expect(resources.magicPower!.current).toBe(12);
  });

  it("короткий отдых даёт половину регена с округлением вниз", async () => {
    // Реген 9 даёт 4, а не 5: округление вверх было третьим расхождением.
    await setUp({ magicPower: { current: 0, maximum: 20 } }, { manaRegen: 9 });
    expect((await restTo("SHORT")).resources.magicPower!.current).toBe(4);
  });

  it("не восстанавливает сверх максимума", async () => {
    await setUp({ magicPower: { current: 18, maximum: 20 } }, { manaRegen: 9 });
    expect((await restTo("LONG")).resources.magicPower!.current).toBe(20);
  });

  it("отказывает в отдыхе, которому нечего восстанавливать", async () => {
    // Реген ноль — восстанавливать не на что, и маршрут отвечает отказом,
    // а не поднимает ревизию персонажа и не пишет в журнал строку «отдохнул
    // на ноль». Прежний код в этом случае доводил ресурс до максимума.
    await setUp({ magicPower: { current: 1, maximum: 20 } }, { manaRegen: 0 });
    const { status, resources } = await restTo("LONG");
    expect(status).toBe(400);
    expect(resources.magicPower!.current).toBe(1);
  });

  it("не трогает ресурс, заведённый мастером самостоятельно", async () => {
    // У него нет строки регена, а правило говорит «на величину регена».
    // Такие ресурсы правятся вручную счётчиками рядом с бросками.
    await setUp(
      {
        magicPower: { current: 0, maximum: 10 },
        blessing: { current: 0, maximum: 3 },
      },
      { manaRegen: 4 },
    );
    const { resources } = await restTo("LONG");
    expect(resources.magicPower!.current).toBe(4);
    expect(resources.blessing!.current).toBe(0);
  });

  it("короткий отдых восстанавливает оба ресурса", async () => {
    // «Перевести дух» убрано: это был тот же короткий отдых, применённый к
    // одной выносливости. Два названия для одного правила заставляли мастера
    // выбирать там, где выбора нет.
    await setUp(
      {
        physicalPower: { current: 0, maximum: 20 },
        magicPower: { current: 0, maximum: 20 },
      },
      { enduranceRegen: 6, manaRegen: 6 },
    );
    const { resources } = await restTo("SHORT");
    expect(resources.physicalPower!.current).toBe(3);
    expect(resources.magicPower!.current).toBe(3);
  });
});
