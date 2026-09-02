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
import { starterStatLayout } from "../packages/system/src/index.js";
import type {
  GameSnapshot,
  StatLayout,
} from "../packages/contracts/src/index.js";

/**
 * UIX-424, шаг 5 — маршрут правки раскладки.
 *
 * Проверяется не то, что запись прошла, а чего маршрут **не** даёт сделать.
 * Раскладка присылается целиком, поэтому удалить строку можно, просто не
 * прислав её, — а удалённая характеристика ломает бросок в момент броска на
 * игре. Пока проверки ссылок нет (шаг 6), набор ключей может только расти.
 */
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let broadcastAttempts: number;

const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

const layout = () =>
  JSON.parse(JSON.stringify(starterStatLayout)) as StatLayout;

const patch = (secret: string, body: Record<string, unknown>) =>
  app.inject({
    method: "PATCH",
    url: "/api/campaign/stat-layout",
    headers: headers(secret),
    payload: { actionId: crypto.randomUUID(), revision: 0, ...body },
  });

beforeEach(async () => {
  broadcastAttempts = 0;
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
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(secrets.gm),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: ids.player,
      tokenHash: hashToken(secrets.player),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  app = Fastify();
  await app.register(cookie);
  registerRoutes(
    app,
    db as never,
    {
      in: () => ({
        fetchSockets: async () => {
          broadcastAttempts++;
          return [];
        },
      }),
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

const storedLayout = async () => {
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, ids.campaign))
    .limit(1);
  return campaign!.statLayout as StatLayout;
};

describe("правка раскладки характеристик", () => {
  it("добавляет строку и поднимает ревизию кампании", async () => {
    const next = layout();
    next[0]!.rows.push({ key: "vnimatelnost", label: "Внимательность" });

    const response = await patch(secrets.gm, { layout: next });
    expect(response.statusCode).toBe(200);
    expect(response.json().revision).toBe(1);

    const stored = await storedLayout();
    expect(stored[0]!.rows.map((row) => row.key)).toContain("vnimatelnost");
  });

  it("переименовывает строку, не трогая ключ", async () => {
    // Ключ — то, на что ссылаются формулы навыков. Если переименование его
    // меняет, формулы поедут молча.
    const next = layout();
    next[0]!.rows[0]!.label = "Мощь";

    expect((await patch(secrets.gm, { layout: next })).statusCode).toBe(200);
    const stored = await storedLayout();
    expect(stored[0]!.rows[0]).toMatchObject({
      key: "strength",
      label: "Мощь",
    });
  });

  it("удаляет строку, на которую никто не ссылается", async () => {
    const next = layout();
    const removed = next[0]!.rows.find((row) => row.key === "luck")!;
    next[0]!.rows = next[0]!.rows.filter((row) => row.key !== removed.key);

    expect((await patch(secrets.gm, { layout: next })).statusCode).toBe(200);
    const stored = await storedLayout();
    expect(stored[0]!.rows.map((row) => row.key)).not.toContain("luck");
  });

  it("отказывается удалять системную строку регена без записи и broadcast", async () => {
    const next = layout();
    const combat = next.find((group) => group.id === "combat")!;
    combat.rows = combat.rows.filter((row) => row.key !== "enduranceRegen");

    const response = await patch(secrets.gm, { layout: next });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "SYSTEM_STAT_ROW_REQUIRED",
      key: "enduranceRegen",
    });
    expect(await storedLayout()).toEqual([]);
    expect(broadcastAttempts).toBe(0);
  });

  it("чинит legacy-раскладку в bootstrap для GM и игрока без записи в БД", async () => {
    const legacyLayout: StatLayout = [
      {
        id: "characteristics",
        label: "Свои характеристики",
        rows: [{ key: "customLuck", label: "Фарт", source: "STAT" }],
      },
    ];
    await db
      .update(schema.campaigns)
      .set({ statLayout: legacyLayout })
      .where(eq(schema.campaigns.id, ids.campaign));
    const characterId = crypto.randomUUID();
    await db.insert(schema.characters).values({
      id: characterId,
      campaignId: ids.campaign,
      ownerMembershipId: ids.player,
      name: "Ллойд",
      stats: { customLuck: 5, enduranceRegen: 7, manaRegen: 4 },
    });

    for (const secret of [secrets.gm, secrets.player]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/bootstrap",
        headers: headers(secret),
      });
      expect(response.statusCode).toBe(200);
      const snapshot = response.json() as GameSnapshot;
      const regenRows = snapshot.campaign.statLayout
        .flatMap((group) =>
          group.rows.map((row) => ({ groupId: group.id, ...row })),
        )
        .filter(
          (row) => row.key === "enduranceRegen" || row.key === "manaRegen",
        );
      expect(regenRows).toEqual([
        {
          groupId: "combat",
          key: "enduranceRegen",
          label: "Реген Выносливости",
          source: "STAT",
        },
        {
          groupId: "combat",
          key: "manaRegen",
          label: "Реген Маны",
          source: "STAT",
        },
      ]);
      expect(snapshot.campaign.statLayout[0]).toEqual(legacyLayout[0]);
      expect(
        snapshot.characters.find((character) => character.id === characterId)
          ?.stats,
      ).toMatchObject({ enduranceRegen: 7, manaRegen: 4 });
    }

    expect(await storedLayout()).toEqual(legacyLayout);
  });

  it("сохраняет repaired combat из 60 пользовательских и 2 системных строк", async () => {
    const legacyLayout: StatLayout = [
      {
        id: "combat",
        label: "Свои боевые характеристики",
        rows: Array.from({ length: 60 }, (_, index) => ({
          key: `custom${index}`,
          label: `Строка ${index}`,
          source: "STAT" as const,
        })),
      },
    ];
    await db
      .update(schema.campaigns)
      .set({ statLayout: legacyLayout })
      .where(eq(schema.campaigns.id, ids.campaign));

    const bootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(bootstrap.statusCode).toBe(200);
    const repaired = (bootstrap.json() as GameSnapshot).campaign.statLayout;
    const combat = repaired.find((group) => group.id === "combat")!;
    expect(combat.rows).toHaveLength(62);
    const manaRegen = combat.rows.find((row) => row.key === "manaRegen")!;
    manaRegen.label = "Темп маны";
    combat.rows = [
      manaRegen,
      ...combat.rows.filter((row) => row.key !== manaRegen.key),
    ];

    const response = await patch(secrets.gm, { layout: repaired });
    expect(response.statusCode).toBe(200);
    expect(response.json().revision).toBe(1);
    expect(broadcastAttempts).toBe(1);

    const storedCombat = (await storedLayout()).find(
      (group) => group.id === "combat",
    )!;
    expect(storedCombat.rows).toHaveLength(62);
    expect(storedCombat.rows[0]).toEqual({
      key: "manaRegen",
      label: "Темп маны",
      source: "STAT",
    });
    expect(
      storedCombat.rows.filter(
        (row) => row.key === "enduranceRegen" || row.key === "manaRegen",
      ),
    ).toHaveLength(2);
  });

  it("отказывается удалять строку, на которую ссылается навык", async () => {
    // Стартовый персонаж носит навык «Удар ближним оружием» с формулой
    // `1d20 + strength`. Удалить силу — значит получить «стат не найден» в
    // момент броска на игре.
    await db.insert(schema.characters).values({
      id: crypto.randomUUID(),
      campaignId: ids.campaign,
      name: "Ллойд",
      skills: [
        { key: "sword", name: "Меч", rank: 0, formula: "1d20 + strength" },
      ],
    });
    const next = layout();
    next[0]!.rows = next[0]!.rows.filter((row) => row.key !== "strength");

    const response = await patch(secrets.gm, { layout: next });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "STAT_ROW_REFERENCED",
      key: "strength",
      references: [{ kind: "SKILL", name: "Меч", owner: "Ллойд" }],
    });
    // И ничего не записалось.
    expect(await storedLayout()).toEqual([]);
  });

  it("считает ссылкой и модификатор способности, а не только формулу", async () => {
    await db.insert(schema.catalogEntries).values({
      campaignId: ids.campaign,
      kind: "ABILITY",
      name: "Лучезарный",
      data: {
        rollActions: [
          {
            id: "hit",
            kind: "HIT",
            label: "Удар",
            dice: "1d20",
            order: 0,
            modifiers: [{ type: "CHARACTERISTIC", key: "charisma" }],
          },
        ],
      },
    });
    const next = layout();
    next[0]!.rows = next[0]!.rows.filter((row) => row.key !== "charisma");

    const response = await patch(secrets.gm, { layout: next });
    expect(response.statusCode).toBe(409);
    expect(response.json().references).toEqual([
      { kind: "CATALOG_ENTRY", name: "Лучезарный" },
    ]);
  });

  it("ищет ссылки и у кампании, которая раскладку ни разу не правила", async () => {
    // Ловушка: у такой кампании в базе пусто, а видит она стартовую раскладку.
    // Сравнив присланное с пустым, сервер решил бы, что удалять нечего, и
    // пропустил бы удаление чего угодно без единой проверки.
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, ids.campaign))
      .limit(1);
    expect(campaign!.statLayout).toEqual([]);

    await db.insert(schema.characters).values({
      id: crypto.randomUUID(),
      campaignId: ids.campaign,
      name: "Ллойд",
      skills: [
        { key: "sword", name: "Меч", rank: 0, formula: "1d20 + strength" },
      ],
    });

    const next = layout();
    next[0]!.rows = next[0]!.rows.filter((row) => row.key !== "strength");
    const response = await patch(secrets.gm, { layout: next });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "STAT_ROW_REFERENCED",
      key: "strength",
    });
  });

  it("отвергает смену источника у существующей строки", async () => {
    // `STAT` берёт число из `stats`, `RESOURCE` — пул из `resources`.
    // Переключение меняет, откуда берётся значение; прежнее просто перестаёт
    // показываться.
    const next = layout();
    const mana = next[1]!.rows.find((row) => row.key === "magicPower")!;
    mana.source = "STAT";

    const response = await patch(secrets.gm, { layout: next });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "STAT_SOURCE_CHANGED",
      key: "magicPower",
    });
  });

  it("не даёт игроку править раскладку", async () => {
    // Раскладка общая на кампанию: переименование игроком поменяло бы подпись
    // всем за столом.
    expect((await patch(secrets.player, { layout: layout() })).statusCode).toBe(
      403,
    );
  });

  it("отвергает устаревшую ревизию", async () => {
    expect((await patch(secrets.gm, { layout: layout() })).statusCode).toBe(
      200,
    );
    const stale = await patch(secrets.gm, { layout: layout() });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: "CAMPAIGN_CONFLICT",
      revision: 1,
    });
  });

  it("повтор того же запроса не применяется дважды", async () => {
    // Повтор после реконнекта не должен поднимать ревизию второй раз.
    const actionId = crypto.randomUUID();
    const next = layout();
    next[0]!.rows.push({ key: "udacha2", label: "Везение" });
    const body = { actionId, revision: 0, layout: next };

    const first = await app.inject({
      method: "PATCH",
      url: "/api/campaign/stat-layout",
      headers: headers(secrets.gm),
      payload: body,
    });
    const repeat = await app.inject({
      method: "PATCH",
      url: "/api/campaign/stat-layout",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().revision).toBe(first.json().revision);
  });

  it("отвергает ключ, который не примет движок формул", async () => {
    const next = layout();
    next[0]!.rows.push({ key: "ближний бой", label: "Ближний бой" });
    expect((await patch(secrets.gm, { layout: next })).statusCode).toBe(500);
    // 500, а не 400: ZodError -> 400 отображается в бутстрапе сервера
    // (`index.ts`), которого этот стенд не поднимает. Важно, что запрос
    // отклонён, а не принят.
    expect(await storedLayout()).toEqual([]);
  });
});
