import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { buildSnapshot } from "../apps/server/src/snapshot.js";
import { hashToken } from "../apps/server/src/security.js";
import { env } from "../apps/server/src/env.js";

/**
 * UIX-431 — маршрут очереди ходов.
 *
 * Проверяется то, что нельзя проверить юнит-тестом проекции: очередь переживает
 * перезагрузку, чужой токен в неё не попадает, и начало боя обнуляет броски, не
 * теряя состава.
 */
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;

const ids = {
  campaign: crypto.randomUUID(),
  otherCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  otherScene: crypto.randomUUID(),
  definition: crypto.randomUUID(),
  hiddenDefinition: crypto.randomUUID(),
  otherDefinition: crypto.randomUUID(),
  token: crypto.randomUUID(),
  hiddenToken: crypto.randomUUID(),
  foreignToken: crypto.randomUUID(),
  playerCharacter: crypto.randomUUID(),
};
const secret = "i".repeat(40);

const grid = {
  enabled: true,
  size: 64,
  offsetX: 0,
  offsetY: 0,
  color: "#fff",
  opacity: 0.2,
};

const patchInitiative = async (
  participants: unknown[],
  revision: number,
  actionId = crypto.randomUUID(),
) =>
  app.inject({
    method: "PATCH",
    url: "/api/campaign/initiative",
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${secret}` },
    payload: { actionId, revision, participants },
  });

const campaignRevision = async () => {
  const [row] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, ids.campaign));
  return row!.revision;
};

/** Заводит игроку сессию и возвращает его секрет. */
const givePlayerSession = async () => {
  const playerSecret = "j".repeat(40);
  await db.insert(schema.sessions).values({
    membershipId: ids.player,
    tokenHash: hashToken(playerSecret),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return playerSecret;
};

const asPlayer = async (playerSecret: string, participants: unknown[]) =>
  app.inject({
    method: "PATCH",
    url: "/api/campaign/initiative",
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${playerSecret}` },
    payload: {
      actionId: crypto.randomUUID(),
      revision: await campaignRevision(),
      participants,
    },
  });

/** Узкая операция: «своей строке поставить значение». */
const setOwn = async (
  playerSecret: string,
  participantId: string,
  initiative: number | null,
) =>
  app.inject({
    method: "PATCH",
    url: "/api/campaign/initiative/self",
    headers: { cookie: `${env.SESSION_COOKIE_NAME}=${playerSecret}` },
    payload: {
      actionId: crypto.randomUUID(),
      revision: await campaignRevision(),
      participantId,
      initiative,
    },
  });

const storedInitiative = async () => {
  const [row] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, ids.campaign));
  return row!.initiative;
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
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Кампания", activeSceneId: ids.scene },
    { id: ids.otherCampaign, name: "Чужая кампания" },
  ]);
  await db.insert(schema.scenes).values([
    { id: ids.scene, campaignId: ids.campaign, name: "Карта", grid },
    {
      id: ids.otherScene,
      campaignId: ids.otherCampaign,
      name: "Чужая карта",
      grid,
    },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "Мастер",
    },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    },
  ]);
  await db.insert(schema.sessions).values({
    membershipId: ids.gm,
    tokenHash: hashToken(secret),
    expiresAt: new Date(Date.now() + 60_000),
  });
  // UIX-466: за токеном игрока обязан стоять персонаж с владельцем — именно по
  // этому признаку очередь решает, показывать ли строку игроку.
  await db.insert(schema.characters).values({
    id: ids.playerCharacter,
    campaignId: ids.campaign,
    name: "Ллойд",
    ownerMembershipId: ids.player,
    stats: { initiative: 3 },
  });
  await db.insert(schema.tokenDefinitions).values([
    {
      id: ids.definition,
      campaignId: ids.campaign,
      name: "Ллойд",
      characterId: ids.playerCharacter,
    },
    { id: ids.hiddenDefinition, campaignId: ids.campaign, name: "Засада" },
    {
      id: ids.otherDefinition,
      campaignId: ids.otherCampaign,
      name: "Чужой токен",
    },
  ]);
  await db.insert(schema.tokens).values([
    {
      id: ids.token,
      sceneId: ids.scene,
      definitionId: ids.definition,
      name: "Ллойд",
      x: 100,
      y: 100,
      width: 64,
      height: 64,
      layer: "PLAYER",
    },
    {
      id: ids.hiddenToken,
      sceneId: ids.scene,
      definitionId: ids.hiddenDefinition,
      name: "Засада",
      x: 400,
      y: 400,
      width: 64,
      height: 64,
      layer: "GM",
    },
    {
      id: ids.foreignToken,
      sceneId: ids.otherScene,
      definitionId: ids.otherDefinition,
      name: "Чужой токен",
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      layer: "PLAYER",
    },
  ]);
  // Без открытых областей туман прячет от игрока всё подряд, и тест «строка
  // видимого токена доезжает» проходил бы по неверной причине.
  await db.insert(schema.fogReveals).values({
    sceneId: ids.scene,
    x: 64,
    y: 64,
    width: 192,
    height: 192,
    geometry: { type: "RECT", x: 64, y: 64, width: 192, height: 192 },
    bbox: { x: 64, y: 64, width: 192, height: 192 },
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

describe("очередь ходов", () => {
  it("сохраняется и переживает перезагрузку", async () => {
    // Ради этого очередь и сделана durable: мастер собирает её живым временем
    // посреди игры, и случайный F5 не должен её терять.
    const response = await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), name: "Волк №3", initiative: 12 },
      ],
      await campaignRevision(),
    );
    expect(response.statusCode).toBe(200);
    expect(await storedInitiative()).toHaveLength(2);
  });

  it("отвергает токен чужой кампании", async () => {
    // Рамка выделения на клиенте отбирает токены по правам, но это удобство,
    // а не защита: список приходит по сети и проверяется здесь.
    const response = await patchInitiative(
      [{ id: crypto.randomUUID(), tokenId: ids.foreignToken }],
      await campaignRevision(),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "TOKEN_NOT_FOUND" });
    expect(await storedInitiative()).toEqual([]);
  });

  it("разводит одновременные правки конфликтом", async () => {
    const revision = await campaignRevision();
    const first = await patchInitiative(
      [{ id: crypto.randomUUID(), name: "Первый" }],
      revision,
    );
    expect(first.statusCode).toBe(200);
    const second = await patchInitiative(
      [{ id: crypto.randomUUID(), name: "Второй" }],
      revision,
    );
    expect(second.statusCode).toBe(409);
    expect(await storedInitiative()).toMatchObject([{ name: "Первый" }]);
  });

  it("не применяет повтор того же действия дважды", async () => {
    const actionId = crypto.randomUUID();
    const revision = await campaignRevision();
    const participants = [{ id: crypto.randomUUID(), name: "Волк" }];
    expect(
      (await patchInitiative(participants, revision, actionId)).statusCode,
    ).toBe(200);
    const replay = await patchInitiative(participants, revision, actionId);
    expect(replay.statusCode).toBe(200);
    expect(await campaignRevision()).toBe(revision + 1);
  });

  it("не пускает игрока пересобирать состав очереди", async () => {
    // UIX-466 открыл игроку маршрут, но только ради своего значения. Подмена
    // состава через тот же PATCH обязана остаться закрытой.
    const playerSecret = await givePlayerSession();
    const response = await asPlayer(playerSecret, [
      { id: crypto.randomUUID(), name: "Я хожу первым" },
    ]);
    expect(response.statusCode).toBe(403);
  });

  it("даёт игроку внести свой бросок узкой операцией", async () => {
    // Прежде броски игроков вносил мастер с их слов — самое частое действие боя
    // шло через посредника. Операция узкая не для красоты: очередь игрок видит
    // отфильтрованной, и отправить её целиком физически не может.
    const mine = crypto.randomUUID();
    const foe = crypto.randomUUID();
    await patchInitiative(
      [
        { id: mine, tokenId: ids.token, initiative: null },
        { id: foe, tokenId: ids.hiddenToken, initiative: 20 },
      ],
      await campaignRevision(),
    );
    const playerSecret = await givePlayerSession();
    const response = await setOwn(playerSecret, mine, 25);
    expect(response.statusCode).toBe(200);
    // 25 больше 20 — заодно видно, что запись пересортировалась.
    expect(await storedInitiative()).toMatchObject([
      { id: mine, initiative: 25 },
      { id: foe, initiative: 20 },
    ]);
  });

  it("не даёт игроку править чужую строку", async () => {
    const mine = crypto.randomUUID();
    const foe = crypto.randomUUID();
    await patchInitiative(
      [
        { id: mine, tokenId: ids.token, initiative: null },
        { id: foe, tokenId: ids.hiddenToken, initiative: 20 },
      ],
      await campaignRevision(),
    );
    const playerSecret = await givePlayerSession();
    const response = await setOwn(playerSecret, foe, 1);
    expect(response.statusCode).toBe(403);
    expect(await storedInitiative()).toMatchObject([
      { id: foe, initiative: 20 },
      { id: mine, initiative: null },
    ]);
  });

  it("не даёт игроку править строку без токена", async () => {
    // За «Волком №3» нет персонажа — значит нет и владельца, которому он свой.
    const wolf = crypto.randomUUID();
    await patchInitiative(
      [{ id: wolf, name: "Волк №3", initiative: null }],
      await campaignRevision(),
    );
    const playerSecret = await givePlayerSession();
    expect((await setOwn(playerSecret, wolf, 30)).statusCode).toBe(403);
  });

  it("пересортировывает очередь после каждой правки", async () => {
    // Порядок стал производным от значений: собирать его руками больше нечем,
    // и «пересортировать» отдельной кнопкой тоже нечего.
    await patchInitiative(
      [
        { id: crypto.randomUUID(), name: "Медленный", initiative: 4 },
        { id: crypto.randomUUID(), name: "Быстрый", initiative: 21 },
        { id: crypto.randomUUID(), name: "Не бросал", initiative: null },
      ],
      await campaignRevision(),
    );
    expect(await storedInitiative()).toMatchObject([
      { name: "Быстрый" },
      { name: "Медленный" },
      { name: "Не бросал" },
    ]);
  });
});

describe("очередь и состояние боя", () => {
  const startBattle = async () =>
    app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${secret}` },
      payload: {
        actionId: crypto.randomUUID(),
        revision: await campaignRevision(),
        command: "START_BATTLE",
      },
    });

  const endBattle = async () =>
    app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${secret}` },
      payload: {
        actionId: crypto.randomUUID(),
        revision: await campaignRevision(),
        command: "END_BATTLE",
      },
    });

  beforeEach(async () => {
    await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), name: "Волк №3", initiative: 12 },
      ],
      await campaignRevision(),
    );
  });

  it("конец боя очищает очередь", async () => {
    // UIX-466 отменил прежнее решение — «конец боя сохраняет очередь целиком».
    // Оно исходило из того, что состав пригодится снова, но на игре между боями
    // в очереди оставались убитые и ушедшие, и следующий бой начинался с
    // вычёркивания прошлого. Собрать состав заново рамкой — несколько секунд.
    await startBattle();
    await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), name: "Волк №3", initiative: 12 },
      ],
      await campaignRevision(),
    );
    await endBattle();
    expect(await storedInitiative()).toEqual([]);
  });

  it("начало боя обнуляет броски, но не состав", async () => {
    // Старые числа, пережившие начало боя, выглядели бы как уже сделанные
    // броски — мастер повёл бы новый бой по прошлой инициативе.
    // Броски из `beforeEach` уже лежат в очереди. Прогонять бой по кругу
    // больше нельзя: UIX-466 сделал `END_BATTLE` очищающим, и состав после него
    // просто нечему пережить.
    await startBattle();
    expect(await storedInitiative()).toMatchObject([
      { tokenId: ids.token, initiative: null },
      { name: "Волк №3", initiative: null },
    ]);
  });
});

describe("что из очереди приходит игроку", () => {
  it("строка противника не доезжает до снапшота игрока", async () => {
    // UIX-466 сменил правило с «виден токен» на «это персонаж игрока»: NPC не
    // попадает в очередь игрока независимо от тумана и слоя. Запрет тот же, что
    // у самих токенов в UIX-449 — панель не должна выдавать ни позиции засады,
    // ни её численность. Само правило разобрано в initiative.test.ts, здесь
    // проверяется, что снапшот действительно его применяет.
    await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), tokenId: ids.hiddenToken, initiative: 20 },
      ],
      await campaignRevision(),
    );
    const playerSnapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.player,
        campaignId: ids.campaign,
        role: "PLAYER",
        displayName: "Игрок",
      } as never,
    );
    expect(playerSnapshot.campaign.initiative).toMatchObject([
      { name: "Ллойд" },
    ]);
    expect(JSON.stringify(playerSnapshot.campaign.initiative)).not.toContain(
      ids.hiddenToken,
    );

    const gmSnapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.gm,
        campaignId: ids.campaign,
        role: "GM",
        displayName: "Мастер",
      } as never,
    );
    expect(gmSnapshot.campaign.initiative).toHaveLength(2);
  });
});

/**
 * UIX-466 п. 3-4 — зона боя.
 *
 * Здесь проверяется то, чего не видит юнит-тест геометрии: зона переживает
 * перезагрузку и конец боя, игроку не уезжает вовсе, а состав по ней собирается
 * из настоящих токенов настоящей сцены.
 */
describe("зона боя", () => {
  /** Накрывает Ллойда (100,100) и не достаёт до Засады (400,400). */
  const zone = { sceneId: ids.scene, x: 50, y: 50, width: 250, height: 250 };

  const putZone = async (value: unknown, cookieSecret = secret) =>
    app.inject({
      method: "PUT",
      url: "/api/campaign/battle-zone",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${cookieSecret}` },
      payload: {
        actionId: crypto.randomUUID(),
        revision: await campaignRevision(),
        zone: value,
      },
    });

  const fromZone = async (cookieSecret = secret) =>
    app.inject({
      method: "POST",
      url: "/api/campaign/initiative/from-zone",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${cookieSecret}` },
      payload: {
        actionId: crypto.randomUUID(),
        revision: await campaignRevision(),
      },
    });

  const clock = async (command: "START_BATTLE" | "END_BATTLE") =>
    app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${secret}` },
      payload: {
        actionId: crypto.randomUUID(),
        revision: await campaignRevision(),
        command,
      },
    });

  const storedZone = async () => {
    const [row] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, ids.campaign));
    return row!.battleZone;
  };

  it("сохраняется и уезжает мастеру, но не игроку", async () => {
    expect((await putZone(zone)).statusCode).toBe(200);
    expect(await storedZone()).toMatchObject(zone);

    const gmSnapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.gm,
        campaignId: ids.campaign,
        role: "GM",
        displayName: "Мастер",
      } as never,
    );
    expect(gmSnapshot.campaign.battleZone).toMatchObject(zone);

    // Игроку зона сказала бы, где мастер собирается драться, ещё до начала боя
    // — и очертила бы место засады там, где тумана нет.
    const playerSnapshot = await buildSnapshot(
      db as never,
      {
        membershipId: ids.player,
        campaignId: ids.campaign,
        role: "PLAYER",
        displayName: "Игрок",
      } as never,
    );
    expect(playerSnapshot.campaign.battleZone).toBeNull();
    expect(JSON.stringify(playerSnapshot.campaign)).not.toContain('"x":50');
  });

  it("не даёт игроку обвести поле боя", async () => {
    // Зоной задаётся, кто вообще участвует в бою: это ручка мастера.
    const playerSecret = await givePlayerSession();
    expect((await putZone(zone, playerSecret)).statusCode).toBe(403);
    expect(await storedZone()).toBeNull();
  });

  it("не принимает сцену чужой кампании", async () => {
    // Иначе зона указывала бы на чужую карту, а состав по ней молча не
    // находил бы никого.
    expect(
      (await putZone({ ...zone, sceneId: ids.otherScene })).statusCode,
    ).toBe(404);
  });

  it("снимается и не мешает начать бой без неё", async () => {
    await putZone(zone);
    expect((await putZone(null)).statusCode).toBe(200);
    expect(await storedZone()).toBeNull();
    // Отказ начинать бой без обведённого поля сделал бы бой невозможным до
    // того, как мастер вспомнит про рамку.
    expect((await clock("START_BATTLE")).statusCode).toBe(200);
  });

  it("начало боя собирает состав по зоне", async () => {
    await putZone(zone);
    expect((await clock("START_BATTLE")).statusCode).toBe(200);
    const roster = await storedInitiative();
    expect(roster.map((row) => row.tokenId)).toEqual([ids.token]);
    // Засада стоит за пределами рамки — в бой не попадает, хотя видна мастеру.
    expect(roster.map((row) => row.tokenId)).not.toContain(ids.hiddenToken);
  });

  it("конец боя стирает состав, но оставляет рамку", async () => {
    await putZone(zone);
    await clock("START_BATTLE");
    expect((await clock("END_BATTLE")).statusCode).toBe(200);
    expect(await storedInitiative()).toEqual([]);
    // На той же карте следующий бой начинается с уже обведённым полем: обводить
    // заново после каждой стычки — работа руками посреди игры.
    expect(await storedZone()).toMatchObject(zone);
  });

  it("пополняет состав по зоне, не задваивая и не теряя брошенное", async () => {
    await putZone(zone);
    await patchInitiative(
      [{ id: crypto.randomUUID(), name: "Волк №3", initiative: 12 }],
      await campaignRevision(),
    );
    expect((await fromZone()).statusCode).toBe(200);
    const roster = await storedInitiative();
    expect(roster.map((row) => row.tokenId)).toEqual([null, ids.token]);
    // Участник вне карты переживает пополнение вместе со своим броском.
    expect(roster[0]).toMatchObject({ name: "Волк №3", initiative: 12 });

    // Повторное нажатие — обычное действие: мастер подвинул фигуры и нажал ещё.
    expect((await fromZone()).statusCode).toBe(200);
    expect(await storedInitiative()).toHaveLength(2);
  });

  it("отказывает в пополнении, пока поле не обведено", async () => {
    // Пустой ответ выглядел бы как «в зоне никого» — мастер начал бы бой без
    // противников, не поняв, что рамки нет.
    const response = await fromZone();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "BATTLE_ZONE_NOT_SET" });
  });

  it("не даёт игроку пополнять состав", async () => {
    const playerSecret = await givePlayerSession();
    await putZone(zone);
    expect((await fromZone(playerSecret)).statusCode).toBe(403);
  });
});
