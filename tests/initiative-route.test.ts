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
  await db.insert(schema.tokenDefinitions).values([
    { id: ids.definition, campaignId: ids.campaign, name: "Ллойд" },
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
    expect((await patchInitiative(participants, revision, actionId)).statusCode).toBe(
      200,
    );
    const replay = await patchInitiative(participants, revision, actionId);
    expect(replay.statusCode).toBe(200);
    expect(await campaignRevision()).toBe(revision + 1);
  });

  it("не пускает игрока править очередь", async () => {
    const playerSecret = "j".repeat(40);
    await db.insert(schema.sessions).values({
      membershipId: ids.player,
      tokenHash: hashToken(playerSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/campaign/initiative",
      headers: { cookie: `${env.SESSION_COOKIE_NAME}=${playerSecret}` },
      payload: {
        actionId: crypto.randomUUID(),
        revision: await campaignRevision(),
        participants: [{ id: crypto.randomUUID(), name: "Я хожу первым" }],
      },
    });
    expect(response.statusCode).toBe(403);
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

  it("конец боя сохраняет очередь целиком", async () => {
    // Кнопка одна и та же на начало и конец: случайное нажатие не должно
    // уничтожать расстановку, собранную руками. Броски вносятся после начала
    // боя — как за столом, и как того требует обнуление на старте.
    await startBattle();
    await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), name: "Волк №3", initiative: 12 },
      ],
      await campaignRevision(),
    );
    await endBattle();
    expect(await storedInitiative()).toMatchObject([
      { initiative: 17 },
      { initiative: 12 },
    ]);
  });

  it("начало боя обнуляет броски, но не состав", async () => {
    // Старые числа, пережившие начало боя, выглядели бы как уже сделанные
    // броски — мастер повёл бы новый бой по прошлой инициативе.
    await startBattle();
    await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), name: "Волк №3", initiative: 12 },
      ],
      await campaignRevision(),
    );
    await endBattle();
    await startBattle();
    expect(await storedInitiative()).toMatchObject([
      { tokenId: ids.token, initiative: null },
      { name: "Волк №3", initiative: null },
    ]);
  });
});

describe("что из очереди приходит игроку", () => {
  it("строка скрытого токена не доезжает до снапшота игрока", async () => {
    // Тот же запрет, что у самих токенов в UIX-449: панель не должна выдавать
    // ни позиции засады, ни её численность. «Засада» скрыта сразу двумя
    // правилами — GM-слой и туман, — и тест не различает, каким именно: он
    // закрепляет, что панель берёт готовый набор видимых токенов, а не считает
    // видимость заново. Само правило разобрано в initiative.test.ts.
    await patchInitiative(
      [
        { id: crypto.randomUUID(), tokenId: ids.token, initiative: 17 },
        { id: crypto.randomUUID(), tokenId: ids.hiddenToken, initiative: 20 },
      ],
      await campaignRevision(),
    );
    const playerSnapshot = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    } as never);
    expect(playerSnapshot.campaign.initiative).toMatchObject([
      { name: "Ллойд" },
    ]);
    expect(JSON.stringify(playerSnapshot.campaign.initiative)).not.toContain(
      ids.hiddenToken,
    );

    const gmSnapshot = await buildSnapshot(db as never, {
      membershipId: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "Мастер",
    } as never);
    expect(gmSnapshot.campaign.initiative).toHaveLength(2);
  });
});
