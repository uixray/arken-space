import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { env } from "../apps/server/src/env.js";
import {
  buildSnapshot,
  SNAPSHOT_MESSAGES_PER_THREAD,
} from "../apps/server/src/snapshot.js";

/**
 * UIX-450 — маршрут истории чата.
 *
 * Существует затем, чтобы историю можно было убрать из снапшота: до него взять
 * её было неоткуда, и снапшот вёз по 200 сообщений на поток каждому при каждом
 * действии — две трети всего трафика рассылки.
 *
 * Проверяется в первую очередь не пагинация, а видимость: маршрут отдаёт
 * сообщения тем же правилом, что снапшот, и любое расхождение здесь — это
 * прочитанное чужое.
 */
let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;

const ids = {
  campaign: crypto.randomUUID(),
  otherCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  otherPlayer: crypto.randomUUID(),
  outsider: crypto.randomUUID(),
  // Заполняется из потока, созданного триггером кампании.
  table: "",
  direct: crypto.randomUUID(),
  directPlayers: crypto.randomUUID(),
  privateRequest: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  otherPlayer: "o".repeat(40),
  outsider: "x".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

const history = (secret: string, threadId: string, query = "") =>
  app.inject({
    method: "GET",
    url: `/api/chat/threads/${threadId}/messages${query}`,
    headers: headers(secret),
  });

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
    { id: ids.campaign, name: "Кампания" },
    { id: ids.otherCampaign, name: "Чужая" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "Мастер" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    },
    {
      id: ids.otherPlayer,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Другой",
    },
    {
      id: ids.outsider,
      campaignId: ids.otherCampaign,
      role: "PLAYER",
      displayName: "Посторонний",
    },
  ]);
  await db.insert(schema.sessions).values(
    (
      [
        [ids.gm, secrets.gm],
        [ids.player, secrets.player],
        [ids.otherPlayer, secrets.otherPlayer],
        [ids.outsider, secrets.outsider],
      ] as const
    ).map(([membershipId, secret]) => ({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  );
  // Потоки ROLLS/STORY/TABLE создаёт триггер при вставке кампании
  // (миграция 0017), поэтому общий поток здесь не вставляется, а находится.
  // Это же и объясняет, почему снапшот тянет `.limit(200)` минимум трижды.
  const [tableThread] = await db
    .select()
    .from(schema.chatThreads)
    .where(
      and(
        eq(schema.chatThreads.campaignId, ids.campaign),
        eq(schema.chatThreads.stream, "TABLE"),
      ),
    );
  ids.table = tableThread!.id;
  // `chat_threads_shape_check` требует упорядоченную пару участников
  // (`participant_a < participant_b`). Со случайными UUID порядок выпадает как
  // придётся, и тест без сортировки падал через раз.
  const pair = [ids.player, ids.gm].sort();
  const playerPair = [ids.player, ids.otherPlayer].sort();
  await db.insert(schema.chatThreads).values([
    {
      id: ids.direct,
      campaignId: ids.campaign,
      type: "DIRECT",
      stream: null,
      participantAMembershipId: pair[0],
      participantBMembershipId: pair[1],
    },
    {
      id: ids.directPlayers,
      campaignId: ids.campaign,
      type: "DIRECT",
      stream: null,
      participantAMembershipId: playerPair[0],
      participantBMembershipId: playerPair[1],
    },
  ]);
  // Тридцать сообщений в общем потоке: пятое — «только мастеру» от мастера.
  await db.insert(schema.chatMessages).values(
    Array.from({ length: 30 }, (_, index) => ({
      campaignId: ids.campaign,
      membershipId: index === 4 ? ids.gm : ids.player,
      threadId: ids.table,
      visibility: index === 4 ? ("GM_ONLY" as const) : ("PUBLIC" as const),
      body: index === 4 ? "тайна мастера" : `сообщение ${index}`,
      sequence: index + 1,
    })),
  );
  await db.insert(schema.chatMessages).values([
    {
      campaignId: ids.campaign,
      membershipId: ids.player,
      threadId: ids.direct,
      visibility: "PUBLIC",
      body: "личное письмо",
      sequence: 100,
    },
    {
      campaignId: ids.campaign,
      membershipId: ids.player,
      threadId: ids.directPlayers,
      visibility: "PUBLIC",
      body: "диалог игроков",
      sequence: 101,
    },
  ]);

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

describe("маршрут истории чата", () => {
  it("отдаёт последнюю страницу по возрастанию номера", async () => {
    // Лента читается сверху вниз, значит и приходить должна в том же порядке —
    // иначе клиенту пришлось бы переворачивать её самому, и он однажды забыл бы.
    const response = await history(secrets.player, ids.table, "?limit=10");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(10);
    expect(body.hasMore).toBe(true);
    const sequences = body.messages.map(
      (m: { sequence: number }) => m.sequence,
    );
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(sequences.at(-1)).toBe(30);
  });

  it("листает назад по курсору без дублей и пропусков", async () => {
    const first = (
      await history(secrets.player, ids.table, "?limit=10")
    ).json();
    const oldest = first.messages[0].sequence;
    const second = (
      await history(secrets.player, ids.table, `?limit=10&before=${oldest}`)
    ).json();

    const overlap = second.messages.filter((m: { sequence: number }) =>
      first.messages.some(
        (other: { sequence: number }) => other.sequence === m.sequence,
      ),
    );
    expect(overlap).toEqual([]);
    expect(second.messages.at(-1).sequence).toBe(oldest - 1);
  });

  it("честно сообщает, что страниц больше нет", async () => {
    // `hasMore` считается по лишней прочитанной строке, а не по длине
    // страницы: ровно кратная длина иначе навсегда обещала бы продолжение.
    const all = (await history(secrets.player, ids.table, "?limit=100")).json();
    expect(all.hasMore).toBe(false);
  });

  it("не показывает игроку чужое сообщение «только мастеру»", async () => {
    // Тот же фильтр, что в снапшоте. Своя копия правила здесь означала бы
    // способ прочитать чужое, минуя проверенную дорогу.
    const forPlayer = (
      await history(secrets.player, ids.table, "?limit=100")
    ).json();
    expect(JSON.stringify(forPlayer)).not.toContain("тайна мастера");

    const forGm = (await history(secrets.gm, ids.table, "?limit=100")).json();
    expect(JSON.stringify(forGm)).toContain("тайна мастера");
  });

  it("фильтрует замороженную аудиторию до limit и завершает all-hidden поток", async () => {
    const [rolls] = await db
      .select()
      .from(schema.chatThreads)
      .where(
        and(
          eq(schema.chatThreads.campaignId, ids.campaign),
          eq(schema.chatThreads.stream, "ROLLS"),
        ),
      );
    await db.insert(schema.chatMessages).values(
      Array.from({ length: 55 }, (_, index) => ({
        campaignId: ids.campaign,
        membershipId: ids.otherPlayer,
        threadId: rolls!.id,
        visibility: "PUBLIC" as const,
        body: `заморожено ${index}`,
        sequence: 200 + index,
        stickerViewerMembershipIds: [ids.otherPlayer],
      })),
    );

    // В старой реализации raw LIMIT срабатывал до постпроекции: первая
    // страница была пустой, но hasMore=true, и курсор не мог сдвинуться.
    const hidden = (
      await history(secrets.player, rolls!.id, "?limit=50")
    ).json();
    expect(hidden).toEqual({ messages: [], hasMore: false });
    expect((await history(secrets.gm, rolls!.id, "?limit=50")).json()).toEqual({
      messages: [],
      hasMore: false,
    });

    const forFrozenViewer = (
      await history(secrets.otherPlayer, rolls!.id, "?limit=50")
    ).json();
    expect(forFrozenViewer.messages).toHaveLength(50);
    expect(forFrozenViewer.hasMore).toBe(true);
  });

  it("фильтрует карточку заявки тем же ACL, что саму заявку", async () => {
    await db.insert(schema.playerRequests).values({
      id: ids.privateRequest,
      campaignId: ids.campaign,
      authorMembershipId: ids.otherPlayer,
      audience: "GM_ONLY",
      horizon: "NOW",
      title: "Скрытая заявка",
      body: "Только автору и мастеру",
    });
    await db.insert(schema.chatMessages).values({
      campaignId: ids.campaign,
      membershipId: ids.otherPlayer,
      threadId: ids.table,
      visibility: "PUBLIC",
      kind: "SYSTEM",
      body: "",
      playerRequestId: ids.privateRequest,
      sequence: 300,
    });

    expect(
      JSON.stringify((await history(secrets.player, ids.table)).json()),
    ).not.toContain(ids.privateRequest);
    expect(
      JSON.stringify((await history(secrets.otherPlayer, ids.table)).json()),
    ).toContain(ids.privateRequest);
    expect(
      JSON.stringify((await history(secrets.gm, ids.table)).json()),
    ).toContain(ids.privateRequest);
  });

  it("невидимые новые строки не уменьшают страницу и не меняют latest/unread", async () => {
    await db
      .update(schema.chatMessages)
      .set({ membershipId: ids.otherPlayer })
      .where(
        and(
          eq(schema.chatMessages.threadId, ids.table),
          eq(schema.chatMessages.visibility, "PUBLIC"),
        ),
      );
    await db.insert(schema.chatMessages).values(
      Array.from({ length: 8 }, (_, index) => ({
        campaignId: ids.campaign,
        membershipId: ids.otherPlayer,
        threadId: ids.table,
        visibility: "PUBLIC" as const,
        body: `невидимый новый ${index}`,
        sequence: 400 + index,
        stickerViewerMembershipIds: [ids.otherPlayer],
      })),
    );
    await db.insert(schema.playerRequests).values({
      id: ids.privateRequest,
      campaignId: ids.campaign,
      authorMembershipId: ids.otherPlayer,
      audience: "GM_ONLY",
      horizon: "NOW",
      title: "Невидимая новая заявка",
      body: "Не для этого игрока",
    });
    await db.insert(schema.chatMessages).values({
      campaignId: ids.campaign,
      membershipId: ids.otherPlayer,
      threadId: ids.table,
      visibility: "PUBLIC",
      kind: "SYSTEM",
      body: "",
      playerRequestId: ids.privateRequest,
      sequence: 408,
    });

    const page = (await history(secrets.player, ids.table, "?limit=10")).json();
    expect(page.messages).toHaveLength(10);
    expect(
      page.messages.map((message: { sequence: number }) => message.sequence),
    ).toEqual(Array.from({ length: 10 }, (_, index) => 21 + index));

    const snapshot = await buildSnapshot(db as never, {
      membershipId: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Игрок",
    });
    const tableMessages = snapshot.messages.filter(
      (message) => message.threadId === ids.table,
    );
    expect(tableMessages).toHaveLength(SNAPSHOT_MESSAGES_PER_THREAD);
    expect(tableMessages[0]?.sequence).toBe(11);
    expect(tableMessages.at(-1)?.sequence).toBe(30);
    expect(JSON.stringify(tableMessages)).not.toContain("невидимый новый");
    expect(JSON.stringify(tableMessages)).not.toContain(ids.privateRequest);
    expect(
      snapshot.chatThreadStates.find((state) => state.threadId === ids.table),
    ).toMatchObject({ latestSequence: 30, unreadCount: 29 });

    const marked = await app.inject({
      method: "POST",
      url: "/api/chat/read",
      headers: headers(secrets.player),
      payload: { threadId: ids.table, sequence: 999 },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().lastReadSequence).toBe(30);
  });

  it("не отдаёт личный диалог тому, кто в нём не участвует", async () => {
    // Мастер здесь участник и видит письмо; роль GM сама по себе не является
    // обходом ACL — второй диалог принадлежит только двум игрокам.
    expect(
      JSON.stringify((await history(secrets.player, ids.direct)).json()),
    ).toContain("личное письмо");
    expect(
      JSON.stringify((await history(secrets.gm, ids.direct)).json()),
    ).toContain("личное письмо");
    expect(
      JSON.stringify((await history(secrets.otherPlayer, ids.direct)).json()),
    ).not.toContain("личное письмо");

    expect(
      JSON.stringify((await history(secrets.player, ids.directPlayers)).json()),
    ).toContain("диалог игроков");
    expect(
      JSON.stringify((await history(secrets.gm, ids.directPlayers)).json()),
    ).not.toContain("диалог игроков");
    expect(
      JSON.stringify(
        (await history(secrets.outsider, ids.directPlayers)).json(),
      ),
    ).not.toContain("диалог игроков");
  });

  it("не отдаёт поток чужой кампании", async () => {
    // Проверка арендатора: поток принадлежит другой кампании, и знать о нём
    // посторонний не должен даже фактом непустого ответа.
    const response = await history(secrets.outsider, ids.table, "?limit=100");
    expect(response.json().messages).toEqual([]);
  });

  it("требует авторизации", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/chat/threads/${ids.table}/messages`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("запрещает приватной истории попадать в общий HTTP-кеш", async () => {
    const response = await history(secrets.player, ids.table, "?limit=10");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});
