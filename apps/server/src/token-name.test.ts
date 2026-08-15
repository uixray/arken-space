import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../packages/db/src/schema.js";
import { buildSnapshot } from "./snapshot.js";
import { followsCharacterName, resolveTokenName } from "./token-name.js";

/**
 * UIX-400, шаг 1. Функция пока никуда не подключена — она проверяется до того,
 * как от неё начнёт зависеть проекция снапшота.
 */
describe("имя токена", () => {
  it("берёт собственное имя, когда оно есть", () => {
    // «Тейн верхом» — намеренное имя, и переименование персонажа его не
    // касается. Ради этого сценария поле и сделано самостоятельным.
    expect(
      resolveTokenName({ name: "Тейн верхом", characterName: "Тейн" }),
    ).toBe("Тейн верхом");
  });

  it("наследует имя персонажа, когда своего нет", () => {
    expect(
      resolveTokenName({ name: null, characterName: "Могучий Тэйн" }),
    ).toBe("Могучий Тэйн");
  });

  it("считает пробельное имя отсутствующим", () => {
    // Форма отдаёт пустую строку, а `trim` в схеме до базы может не дойти:
    // строка из пробелов — это не имя, а подпись, которой не видно.
    expect(resolveTokenName({ name: "   ", characterName: "Тейн" })).toBe(
      "Тейн",
    );
    expect(followsCharacterName({ name: "  " })).toBe(true);
  });

  it("не оставляет токен вовсе без подписи", () => {
    // Персонажа отвязали (`onDelete: "set null"`), своего имени нет. Пустая
    // строка дала бы кружок без имени на карте и пустую строку в списке
    // объектов — то есть токен, о котором нечего сказать.
    expect(resolveTokenName({ name: null, characterName: null })).toBe(
      "Без имени",
    );
    expect(resolveTokenName({ name: null })).toBe("Без имени");
  });

  it("отличает следование за персонажем от совпадения имён", () => {
    // Ключевое различие всего решения: «зовусь как персонаж» — это состояние
    // данных, а не совпадение строк. Токен, названный ровно как персонаж,
    // за ним НЕ следует и при переименовании останется прежним.
    expect(followsCharacterName({ name: null })).toBe(true);
    expect(followsCharacterName({ name: "Тейн" })).toBe(false);
  });
});

/**
 * Проверка сквозного правила на живой базе: переименование персонажа меняет
 * подпись наследующего токена и не трогает токен с собственным именем. Это и
 * есть задача целиком — «Хорист» остался у «Могучего Тэйна» именно потому, что
 * имя копировалось в момент создания.
 */
describe("переименование персонажа и подпись токена", () => {
  const ids = {
    campaign: crypto.randomUUID(),
    gm: crypto.randomUUID(),
    character: crypto.randomUUID(),
    scene: crypto.randomUUID(),
    inherits: crypto.randomUUID(),
    ownNamed: crypto.randomUUID(),
  };

  let database: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    database = new PGlite();
    const migrations = new URL(
      "../../../packages/db/drizzle/",
      import.meta.url,
    );
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
      .values({ id: ids.campaign, name: "Кампания", activeSceneId: ids.scene });
    await db.insert(schema.scenes).values({
      id: ids.scene,
      campaignId: ids.campaign,
      name: "Карта",
      grid: {
        enabled: true,
        size: 64,
        offsetX: 0,
        offsetY: 0,
        color: "#fff",
        opacity: 0.2,
      },
    });
    await db.insert(schema.memberships).values({
      id: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "Мастер",
    });
    await db.insert(schema.characters).values({
      id: ids.character,
      campaignId: ids.campaign,
      name: "Хорист",
    });
    await db.insert(schema.tokenDefinitions).values([
      {
        id: ids.inherits,
        campaignId: ids.campaign,
        characterId: ids.character,
        name: null,
      },
      {
        id: ids.ownNamed,
        campaignId: ids.campaign,
        characterId: ids.character,
        name: "Хорист верхом",
      },
    ]);
  });

  afterEach(async () => {
    await database.close();
  });

  const namesInSnapshot = async () => {
    const snapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.gm,
        campaignId: ids.campaign,
        role: "GM",
        displayName: "Мастер",
      } as never,
    );
    return Object.fromEntries(
      (snapshot.tokenDefinitions ?? []).map((item) => [item.id, item.name]),
    );
  };

  it("подпись идёт за именем персонажа, но не затирает собственное", async () => {
    expect(await namesInSnapshot()).toMatchObject({
      [ids.inherits]: "Хорист",
      [ids.ownNamed]: "Хорист верхом",
    });

    await db
      .update(schema.characters)
      .set({ name: "Могучий Тэйн" })
      .where(eq(schema.characters.id, ids.character));

    expect(await namesInSnapshot()).toMatchObject({
      // Ради этого всё и делалось.
      [ids.inherits]: "Могучий Тэйн",
      // А ради этого выбран вариант с хранимым намерением: намеренное имя
      // переименование персонажа не касается.
      [ids.ownNamed]: "Хорист верхом",
    });
  });

  it("отдаёт собственное имя отдельным полем", async () => {
    // Редактору нужно отличать «зовусь как персонаж» от намеренной копии:
    // по одному лишь видимому имени он бы их спутал и превратил первое во
    // второе при первом же сохранении.
    const snapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.gm,
        campaignId: ids.campaign,
        role: "GM",
        displayName: "Мастер",
      } as never,
    );
    const byId = new Map(
      (snapshot.tokenDefinitions ?? []).map((item) => [item.id, item]),
    );
    expect(byId.get(ids.inherits)?.ownName).toBeNull();
    expect(byId.get(ids.ownNamed)?.ownName).toBe("Хорист верхом");
  });
});
