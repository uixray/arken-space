import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { buildSnapshot, loadCampaignReadSet } from "./snapshot.js";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import {
  isGameEventActionConflict,
  registerCampaignPauseRoutes,
} from "./campaign-pause.js";

describe("isGameEventActionConflict", () => {
  const relevant = {
    code: "23505",
    constraint_name: "game_events_campaign_action_idx",
  };

  it("распознаёт прямую и обёрнутую ошибку нужного ограничения", () => {
    expect(isGameEventActionConflict(relevant)).toBe(true);
    expect(isGameEventActionConflict({ cause: relevant })).toBe(true);
  });

  it("не маскирует нарушение другого уникального ограничения", () => {
    expect(
      isGameEventActionConflict({
        code: "23505",
        constraint_name: "unrelated_unique_idx",
      }),
    ).toBe(false);
    expect(
      isGameEventActionConflict({
        cause: { code: "23505", constraint: "unrelated_unique_idx" },
      }),
    ).toBe(false);
  });
});

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let broadcasts: string[] = [];
let failNextBroadcast = false;

const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignGm: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignGm: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const command = (
  secret: string,
  body: {
    actionId?: string;
    revision?: number;
    paused?: boolean;
  } = {},
) =>
  app.inject({
    method: "POST",
    url: "/api/campaign/pause",
    headers: headers(secret),
    payload: {
      actionId: crypto.randomUUID(),
      revision: 0,
      paused: true,
      ...body,
    },
  });

const storedCampaign = async (campaignId = ids.campaign) => {
  const [row] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  return row!;
};

beforeAll(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
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
    { id: ids.campaign, name: "Кампания" },
    { id: ids.foreignCampaign, name: "Чужая кампания" },
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
    {
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Чужой мастер",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.foreignGm, secrets.foreignGm],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });

  app = Fastify();
  await app.register(cookie);
  registerCampaignPauseRoutes(app, db as never, async (campaignId) => {
    if (failNextBroadcast) {
      failNextBroadcast = false;
      throw new Error("TEST_BROADCAST_FAILED");
    }
    broadcasts.push(campaignId);
  });
  await app.ready();
});

beforeEach(async () => {
  broadcasts = [];
  failNextBroadcast = false;
  await db.delete(schema.gameEvents);
  await db
    .update(schema.campaigns)
    .set({ paused: false, revision: 0 })
    .where(eq(schema.campaigns.id, ids.campaign));
  await db
    .update(schema.campaigns)
    .set({ paused: false, revision: 0 })
    .where(eq(schema.campaigns.id, ids.foreignCampaign));
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("сервер-авторитетная пауза кампании", () => {
  it("даёт GM включить и снять паузу под ревизией", async () => {
    const paused = await command(secrets.gm);
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toEqual({
      campaignId: ids.campaign,
      paused: true,
      revision: 1,
    });

    const resumed = await command(secrets.gm, {
      revision: 1,
      paused: false,
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toEqual({
      campaignId: ids.campaign,
      paused: false,
      revision: 2,
    });
    expect(broadcasts).toEqual([ids.campaign, ids.campaign]);
  });

  it("не даёт PLAYER менять паузу", async () => {
    const response = await command(secrets.player);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "GM_REQUIRED" });
    expect(broadcasts).toEqual([]);
    expect(await storedCampaign()).toMatchObject({
      paused: false,
      revision: 0,
    });
    expect(await db.select().from(schema.gameEvents)).toHaveLength(0);
  });

  it("проверяет аутентификацию и роль до разбора тела команды", async () => {
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/campaign/pause",
      payload: {},
    });
    const player = await app.inject({
      method: "POST",
      url: "/api/campaign/pause",
      headers: headers(secrets.player),
      payload: {},
    });

    expect(anonymous.statusCode).toBe(401);
    expect(player.statusCode).toBe(403);
    expect(player.json()).toEqual({ error: "GM_REQUIRED" });
    expect(await db.select().from(schema.gameEvents)).toHaveLength(0);
  });

  it("отвергает stale revision без изменения состояния", async () => {
    await db
      .update(schema.campaigns)
      .set({ revision: 4 })
      .where(eq(schema.campaigns.id, ids.campaign));

    const response = await command(secrets.gm, { revision: 3 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "CAMPAIGN_CONFLICT",
      revision: 4,
    });
    expect(broadcasts).toEqual([]);
    expect(await storedCampaign()).toMatchObject({
      paused: false,
      revision: 4,
    });
    expect(await db.select().from(schema.gameEvents)).toHaveLength(0);
  });

  it("возвращает исходный response на exact retry и конфликтует при новом intent с тем же actionId", async () => {
    const actionId = crypto.randomUUID();
    const body = { actionId, revision: 0, paused: true };
    const first = await command(secrets.gm, body);
    const replayed = await command(secrets.gm, body);
    const conflicting = await command(secrets.gm, {
      actionId,
      revision: 0,
      paused: false,
    });
    const conflictingRevision = await command(secrets.gm, {
      actionId,
      revision: 1,
      paused: true,
    });

    expect(first.statusCode).toBe(200);
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(first.json());
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toEqual({ error: "ACTION_ID_CONFLICT" });
    expect(conflictingRevision.statusCode).toBe(409);
    expect(conflictingRevision.json()).toEqual({
      error: "ACTION_ID_CONFLICT",
    });
    expect(broadcasts).toEqual([ids.campaign, ids.campaign]);
    expect(await storedCampaign()).toMatchObject({ paused: true, revision: 1 });
    const events = await db.select().from(schema.gameEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      campaignId: ids.campaign,
      membershipId: ids.gm,
      type: "campaign.pause",
      entityType: "campaign",
      entityId: ids.campaign,
      entityRevision: 1,
    });
    expect(Object.keys(events[0]!.payload as object).sort()).toEqual([
      "commandHash",
      "response",
    ]);
  });

  it("сериализует два одновременных exact retry в одну ревизию и один receipt", async () => {
    const body = {
      actionId: crypto.randomUUID(),
      revision: 0,
      paused: true,
    };
    const [first, second] = await Promise.all([
      command(secrets.gm, body),
      command(secrets.gm, body),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await storedCampaign()).toMatchObject({ paused: true, revision: 1 });
    expect(await db.select().from(schema.gameEvents)).toHaveLength(1);
    expect(broadcasts).toEqual([ids.campaign, ids.campaign]);
  });

  it("повторяет snapshot broadcast после ошибки рассылки зафиксированной команды", async () => {
    const body = {
      actionId: crypto.randomUUID(),
      revision: 0,
      paused: true,
    };
    failNextBroadcast = true;

    const failed = await command(secrets.gm, body);
    expect(failed.statusCode).toBe(500);
    expect(await storedCampaign()).toMatchObject({ paused: true, revision: 1 });
    expect(await db.select().from(schema.gameEvents)).toHaveLength(1);
    expect(broadcasts).toEqual([]);

    const recovered = await command(secrets.gm, body);
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toEqual({
      campaignId: ids.campaign,
      paused: true,
      revision: 1,
    });
    expect(broadcasts).toEqual([ids.campaign]);
  });

  it("не создаёт новую ревизию для уже установленного состояния", async () => {
    const response = await command(secrets.gm, { paused: false });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "CAMPAIGN_PAUSE_STATE_UNCHANGED",
      paused: false,
      revision: 0,
    });
    expect(broadcasts).toEqual([]);
    expect(await storedCampaign()).toMatchObject({
      paused: false,
      revision: 0,
    });
    expect(await db.select().from(schema.gameEvents)).toHaveLength(0);
  });

  it("изолирует команду кампанией из auth context", async () => {
    const sharedActionId = crypto.randomUUID();
    const body = { actionId: sharedActionId };
    const [foreignResponse, ownResponse] = await Promise.all([
      command(secrets.foreignGm, body),
      command(secrets.gm, body),
    ]);
    expect(foreignResponse.statusCode).toBe(200);
    expect(foreignResponse.json().campaignId).toBe(ids.foreignCampaign);
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json().campaignId).toBe(ids.campaign);

    const [own, foreign] = await Promise.all([
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, ids.campaign))
        .limit(1),
      db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, ids.foreignCampaign))
        .limit(1),
    ]);
    expect(foreign[0]!.paused).toBe(true);
    expect(own[0]!.paused).toBe(true);

    // Уникальность журнала ограничена кампанией: тот же UUID в аутентифицированной
    // кампании — отдельная команда, а не межкампанейный повтор или конфликт.
    const [foreignReplay, ownReplay] = await Promise.all([
      command(secrets.foreignGm, body),
      command(secrets.gm, body),
    ]);
    expect(foreignReplay.statusCode).toBe(200);
    expect(foreignReplay.json()).toEqual(foreignResponse.json());
    expect(ownReplay.statusCode).toBe(200);
    expect(ownReplay.json()).toEqual(ownResponse.json());
    expect(await db.select().from(schema.gameEvents)).toHaveLength(2);
    expect(broadcasts.sort()).toEqual(
      [
        ids.foreignCampaign,
        ids.campaign,
        ids.foreignCampaign,
        ids.campaign,
      ].sort(),
    );
  });

  it("восстанавливает persisted pause в GM и PLAYER snapshot", async () => {
    expect((await command(secrets.gm)).statusCode).toBe(200);

    const [gmSnapshot, playerSnapshot] = await Promise.all([
      buildSnapshot(db as never, {
        membershipId: ids.gm,
        campaignId: ids.campaign,
        role: "GM",
        displayName: "Мастер",
      }),
      buildSnapshot(db as never, {
        membershipId: ids.player,
        campaignId: ids.campaign,
        role: "PLAYER",
        displayName: "Игрок",
      }),
    ]);
    expect(gmSnapshot.campaign.paused).toBe(true);
    expect(playerSnapshot.campaign.paused).toBe(true);
  });

  it("фиксирует одну campaign revision для всех snapshot одной рассылки", async () => {
    expect((await command(secrets.gm)).statusCode).toBe(200);
    const readSet = await loadCampaignReadSet(db as never, ids.campaign);

    await db
      .update(schema.campaigns)
      .set({ paused: false, revision: 2 })
      .where(eq(schema.campaigns.id, ids.campaign));

    const fromBroadcastReadSet = await buildSnapshot(
      db as never,
      {
        membershipId: ids.player,
        campaignId: ids.campaign,
        role: "PLAYER",
        displayName: "Игрок",
      },
      [],
      readSet,
    );
    const fresh = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    });

    expect(fromBroadcastReadSet.campaign).toMatchObject({
      paused: true,
      revision: 1,
    });
    expect(fresh.campaign).toMatchObject({ paused: false, revision: 2 });
  });
});
