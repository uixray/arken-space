import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { buildSnapshot } from "../apps/server/src/snapshot.js";

/**
 * UIX-449: туман обязан скрывать токен **в рассылке**, а не только на экране.
 *
 * Проверка идёт по снапшоту, а не по рендеру, именно потому, что дефект был
 * незаметен глазами: на экране игрока токена не было, а координаты приходили.
 * Тест на отрисовке такое пропустил бы — он и пропускал.
 */
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const ids = {
  campaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  ownDefinition: crypto.randomUUID(),
  ownToken: crypto.randomUUID(),
};

/** Токены 96x96; открытая область — прямоугольник 240..800 по x, 220..480 по y. */
const REVEAL = { x: 240, y: 220, width: 560, height: 260 };

const placeToken = async (name: string, x: number, y: number) => {
  const definitionId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  await db.insert(schema.tokenDefinitions).values({
    id: definitionId,
    campaignId: ids.campaign,
    name,
    defaultWidth: 96,
    defaultHeight: 96,
  });
  await db.insert(schema.tokens).values({
    id: tokenId,
    sceneId: ids.scene,
    definitionId,
    name,
    x,
    y,
    width: 96,
    height: 96,
  });
  return { definitionId, tokenId };
};

const snapshotFor = (role: "GM" | "PLAYER") =>
  buildSnapshot(
    db as never,
    {
      campaignId: ids.campaign,
      membershipId: role === "GM" ? ids.gm : ids.player,
      role,
      displayName: role === "GM" ? "Мастер" : "Игрок",
    } as never,
  );

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
  await db.insert(schema.campaigns).values({
    id: ids.campaign,
    name: "Кампания",
    activeSceneId: ids.scene,
  });
  await db.insert(schema.scenes).values({
    id: ids.scene,
    campaignId: ids.campaign,
    name: "Карта",
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.2,
    },
  });
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "Мастер" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    },
  ]);
  await db.insert(schema.fogReveals).values({
    sceneId: ids.scene,
    ...REVEAL,
    operation: "REVEAL",
    shape: "RECT",
    geometry: { type: "RECT", ...REVEAL },
    bbox: REVEAL,
    sequence: 1,
  });
});

afterEach(async () => {
  await database.close();
});

const tokenNames = (snapshot: { tokens: { name: string }[] }) =>
  snapshot.tokens.map((token) => token.name).sort();

describe("туман и рассылка токенов", () => {
  it("не отправляет игроку токен, целиком стоящий под туманом", async () => {
    // Тот самый случай: на экране его нет, но координаты приходили, и
    // открывший devtools видел, где засада.
    await placeToken("Открытый", 320, 300);
    await placeToken("Часовой", 1300, 640);

    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual(["Открытый"]);
  });

  it("отправляет токен, вышедший из тумана хотя бы частью", async () => {
    // Правило UIX-426 остаётся: частично освещённый токен видно частично,
    // значит прислать его обязаны. Открытая область кончается на x=800, токен
    // занимает 760..856 — левая половина в свету.
    await placeToken("На краю", 760, 300);

    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual(["На краю"]);
  });

  it("мастеру отправляет всё, включая скрытое от игроков", async () => {
    await placeToken("Часовой", 1300, 640);

    expect(tokenNames(await snapshotFor("GM"))).toEqual(["Часовой"]);
    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual([]);
  });

  it("не прячет от игрока его собственный токен", async () => {
    // Свой токен игрок видит всегда, куда бы тот ни забрёл, — иначе он потеряет
    // управление фигурой, зайдя в неразведанное.
    const own = await placeToken("Мой", 1300, 640);
    await db.insert(schema.tokenControllers).values({
      tokenDefinitionId: own.definitionId,
      membershipId: ids.player,
    });

    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual(["Мой"]);
  });

  it("возвращает токен, когда мастер открывает туман над ним", async () => {
    // Без этого правка выглядела бы работающей и ломалась бы на игре: токен
    // не появился бы, пока игрок не перезагрузит страницу.
    await placeToken("Часовой", 1300, 640);
    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual([]);

    const opened = { x: 1260, y: 600, width: 200, height: 200 };
    await db.insert(schema.fogReveals).values({
      sceneId: ids.scene,
      ...opened,
      operation: "REVEAL",
      shape: "RECT",
      geometry: { type: "RECT", ...opened },
      bbox: opened,
      sequence: 2,
    });

    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual(["Часовой"]);
  });

  it("снова прячет токен, когда мастер закрывает туман обратно", async () => {
    // Порядок операций значим: COVER поверх REVEAL обязан победить, иначе
    // закрытая область осталась бы «открытой» для рассылки.
    await placeToken("Открытый", 320, 300);
    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual(["Открытый"]);

    const covered = { x: 240, y: 220, width: 560, height: 260 };
    await db.insert(schema.fogReveals).values({
      sceneId: ids.scene,
      ...covered,
      operation: "COVER",
      shape: "RECT",
      geometry: { type: "RECT", ...covered },
      bbox: covered,
      sequence: 2,
    });

    expect(tokenNames(await snapshotFor("PLAYER"))).toEqual([]);
  });
});
