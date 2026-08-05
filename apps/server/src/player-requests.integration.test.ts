import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import {
  listVisiblePlayerRequests,
  registerPlayerRequestRoutes,
} from "./player-requests.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const realtimeEmissions: Array<{
  rooms: string[];
  event: string;
  request: any;
}> = [];
const realtime = {
  to(room: string) {
    const rooms = [room];
    const target = {
      to(nextRoom: string) {
        rooms.push(nextRoom);
        return target;
      },
      emit(event: string, request: any) {
        realtimeEmissions.push({ rooms: [...rooms], event, request });
      },
    };
    return target;
  },
};
const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  gm2: id(),
  author: id(),
  other: id(),
  foreign: id(),
  ownedCharacter: id(),
  controlledCharacter: id(),
  forgedCharacter: id(),
  foreignCharacter: id(),
};
const secrets = {
  gm: "g".repeat(40),
  gm2: "h".repeat(40),
  author: "a".repeat(40),
  other: "o".repeat(40),
  foreign: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const auth = (
  membershipId: string,
  role: "GM" | "PLAYER",
  campaignId = ids.campaign,
) => ({ membershipId, role, campaignId, displayName: role });
const createBody = (overrides: Record<string, unknown> = {}) => ({
  actionId: id(),
  audience: "PUBLIC",
  horizon: "NOW",
  title: "Need help",
  body: "Please help",
  ...overrides,
});
async function create(
  secret = secrets.author,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/player-requests",
    headers: headers(secret),
    payload: createBody(overrides),
  });
}
async function action(
  secret: string,
  requestId: string,
  revision: number,
  actionName: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/player-requests/${requestId}/actions`,
    headers: headers(secret),
    payload: { actionId: id(), revision, action: actionName, ...overrides },
  });
}

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
    { id: ids.campaign, name: "Campaign" },
    { id: ids.foreignCampaign, name: "Foreign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM One" },
    {
      id: ids.gm2,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "GM Two",
    },
    {
      id: ids.author,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Author",
    },
    {
      id: ids.other,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Other",
    },
    {
      id: ids.foreign,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.gm2, secrets.gm2],
    [ids.author, secrets.author],
    [ids.other, secrets.other],
    [ids.foreign, secrets.foreign],
  ] as const)
    await db
      .insert(schema.sessions)
      .values({
        membershipId,
        tokenHash: hashToken(secret),
        expiresAt: new Date(Date.now() + 60_000),
      });
  await db.insert(schema.characters).values([
    {
      id: ids.ownedCharacter,
      campaignId: ids.campaign,
      ownerMembershipId: ids.author,
      name: "Owned",
    },
    {
      id: ids.controlledCharacter,
      campaignId: ids.campaign,
      ownerMembershipId: ids.other,
      name: "Controlled",
    },
    {
      id: ids.forgedCharacter,
      campaignId: ids.campaign,
      ownerMembershipId: ids.other,
      name: "Forged",
    },
    {
      id: ids.foreignCharacter,
      campaignId: ids.foreignCampaign,
      ownerMembershipId: ids.foreign,
      name: "Foreign character",
    },
  ]);
  await db
    .insert(schema.characterControllers)
    .values({ characterId: ids.controlledCharacter, membershipId: ids.author });
  app = Fastify();
  await app.register(cookie);
  registerPlayerRequestRoutes(app, db as never, realtime as never);
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await database.close();
});

describe("player request HTTP authorization", () => {
  it("denies anonymous and GM creation", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/player-requests",
          payload: createBody(),
        })
      ).statusCode,
    ).toBe(401);
    expect((await create(secrets.gm)).statusCode).toBe(403);
  });
  it("accepts self/controlled characters and hides forged or foreign characters", async () => {
    expect(
      (await create(secrets.author, { characterId: ids.ownedCharacter }))
        .statusCode,
    ).toBe(201);
    expect(
      (await create(secrets.author, { characterId: ids.controlledCharacter }))
        .statusCode,
    ).toBe(201);
    expect(
      (await create(secrets.author, { characterId: ids.forgedCharacter }))
        .statusCode,
    ).toBe(404);
    expect(
      (await create(secrets.author, { characterId: ids.foreignCharacter }))
        .statusCode,
    ).toBe(404);
  });
  it("exposes PUBLIC campaign-wide and GM_ONLY only to author and both GMs", async () => {
    const publicId = (await create()).json().id;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/player-requests/${publicId}`,
          headers: headers(secrets.other),
        })
      ).statusCode,
    ).toBe(200);
    const privateId = (
      await create(secrets.author, { audience: "GM_ONLY" })
    ).json().id;
    for (const secret of [secrets.author, secrets.gm, secrets.gm2])
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/player-requests/${privateId}`,
            headers: headers(secret),
          })
        ).statusCode,
      ).toBe(200);
    for (const secret of [secrets.other, secrets.foreign])
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/player-requests/${privateId}`,
            headers: headers(secret),
          })
        ).statusCode,
      ).toBe(404);
  });
});

describe("player request mutation and replay", () => {
  it("allows only the author to edit SUBMITTED and enforces CAS", async () => {
    const created = (await create()).json();
    const payload = {
      actionId: id(),
      revision: 0,
      title: "Updated",
      body: "Updated body",
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/player-requests/${created.id}`,
          headers: headers(secrets.other),
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/player-requests/${created.id}`,
          headers: headers(secrets.gm),
          payload: { ...payload, actionId: id() },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/player-requests/${created.id}`,
          headers: headers(secrets.author),
          payload,
        })
      ).json().revision,
    ).toBe(1);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/player-requests/${created.id}`,
          headers: headers(secrets.author),
          payload: { ...payload, actionId: id() },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("replays identical create/update actions and conflicts on action hash reuse", async () => {
    const body = createBody();
    const first = await app.inject({
      method: "POST",
      url: "/api/player-requests",
      headers: headers(secrets.author),
      payload: body,
    });
    const retry = await app.inject({
      method: "POST",
      url: "/api/player-requests",
      headers: headers(secrets.author),
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/player-requests",
          headers: headers(secrets.author),
          payload: { ...body, title: "Different" },
        })
      ).statusCode,
    ).toBe(409);
    const update = { actionId: id(), revision: 0, title: "Once", body: "Once" };
    const once = await app.inject({
      method: "PATCH",
      url: `/api/player-requests/${first.json().id}`,
      headers: headers(secrets.author),
      payload: update,
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/player-requests/${first.json().id}`,
          headers: headers(secrets.author),
          payload: update,
        })
      ).json(),
    ).toEqual(once.json());
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/player-requests/${first.json().id}`,
          headers: headers(secrets.author),
          payload: { ...update, body: "Conflict" },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("supports GM transitions, resolver notes, author cancel after acknowledgement, and terminal immutability", async () => {
    const acknowledged = (await create()).json();
    expect(
      (await action(secrets.gm, acknowledged.id, 0, "ACKNOWLEDGE")).json()
        .status,
    ).toBe("ACKNOWLEDGED");
    expect(
      (await action(secrets.author, acknowledged.id, 1, "CANCEL")).json()
        .status,
    ).toBe("CANCELLED");
    expect(
      (await action(secrets.gm, acknowledged.id, 2, "RESOLVE")).statusCode,
    ).toBe(409);
    const resolved = (await create()).json();
    const resolution = (
      await action(secrets.gm2, resolved.id, 0, "RESOLVE", {
        resolutionNote: "Handled safely",
      })
    ).json();
    expect(resolution).toMatchObject({
      status: "RESOLVED",
      resolvedByMembershipId: ids.gm2,
      resolvedByDisplayName: "GM Two",
      resolutionNote: "Handled safely",
    });
    expect(
      (await action(secrets.gm, resolved.id, 1, "DECLINE")).statusCode,
    ).toBe(409);
    const declined = (await create()).json();
    expect(
      (
        await action(secrets.gm, declined.id, 0, "DECLINE", {
          resolutionNote: "Not possible",
        })
      ).json(),
    ).toMatchObject({ status: "DECLINED", resolvedByMembershipId: ids.gm });
  });
});

describe("player request filters and durable projection", () => {
  it("filters OPEN/CLOSED with horizon/audience and applies projection ACL", async () => {
    const openPrivate = (
      await create(secrets.author, {
        audience: "GM_ONLY",
        horizon: "BEFORE_BREAK",
        title: "Private open",
      })
    ).json();
    const closedPublic = (
      await create(secrets.author, {
        audience: "PUBLIC",
        horizon: "NEXT_SESSION",
        title: "Public closed",
      })
    ).json();
    await action(secrets.gm, closedPublic.id, 0, "RESOLVE");
    const open = (
      await app.inject({
        method: "GET",
        url: "/api/player-requests?state=OPEN&horizon=BEFORE_BREAK&audience=GM_ONLY",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(open.some((row: { id: string }) => row.id === openPrivate.id)).toBe(
      true,
    );
    expect(
      open.every(
        (row: { status: string; horizon: string; audience: string }) =>
          ["SUBMITTED", "ACKNOWLEDGED"].includes(row.status) &&
          row.horizon === "BEFORE_BREAK" &&
          row.audience === "GM_ONLY",
      ),
    ).toBe(true);
    const closed = (
      await app.inject({
        method: "GET",
        url: "/api/player-requests?state=CLOSED&horizon=NEXT_SESSION&audience=PUBLIC",
        headers: headers(secrets.author),
      })
    ).json();
    expect(
      closed.some((row: { id: string }) => row.id === closedPublic.id),
    ).toBe(true);
    const authorProjection = await listVisiblePlayerRequests(
      db as never,
      auth(ids.author, "PLAYER"),
    );
    const gmProjection = await listVisiblePlayerRequests(
      db as never,
      auth(ids.gm, "GM"),
    );
    const otherProjection = await listVisiblePlayerRequests(
      db as never,
      auth(ids.other, "PLAYER"),
    );
    expect(authorProjection.some((row) => row.id === openPrivate.id)).toBe(
      true,
    );
    expect(gmProjection.some((row) => row.id === openPrivate.id)).toBe(true);
    expect(otherProjection.some((row) => row.id === openPrivate.id)).toBe(
      false,
    );
  });
});

describe("player request realtime delivery", () => {
  it("targets public campaign and private GM/author union, and skips replay or conflict", async () => {
    realtimeEmissions.length = 0;
    const publicBody = createBody({ audience: "PUBLIC" });
    const publicResponse = await app.inject({
      method: "POST",
      url: "/api/player-requests",
      headers: headers(secrets.author),
      payload: publicBody,
    });
    expect(realtimeEmissions.slice(-2)).toMatchObject([
      {
        rooms: [`campaign:${ids.campaign}`],
        event: "player-request:changed",
        request: { id: publicResponse.json().id, revision: 0 },
      },
      {
        rooms: [`campaign:${ids.campaign}`],
        event: "chat:created",
        request: {
          data: {
            playerRequestId: publicResponse.json().id,
            body: "",
            kind: "SYSTEM",
            stream: "TABLE",
          },
        },
      },
    ]);

    const privateBody = createBody({ audience: "GM_ONLY" });
    const privateResponse = await app.inject({
      method: "POST",
      url: "/api/player-requests",
      headers: headers(secrets.author),
      payload: privateBody,
    });
    expect(realtimeEmissions.slice(-2)).toMatchObject([
      {
        rooms: [`campaign:${ids.campaign}:gm`, `member:${ids.author}`],
        event: "player-request:changed",
        request: { id: privateResponse.json().id, revision: 0 },
      },
      {
        rooms: [`campaign:${ids.campaign}:gm`, `member:${ids.author}`],
        event: "chat:created",
        request: {
          data: {
            playerRequestId: privateResponse.json().id,
            visibility: "GM_ONLY",
          },
        },
      },
    ]);
    expect(realtimeEmissions.at(-1)?.rooms).not.toContain(
      `campaign:${ids.campaign}`,
    );

    const count = realtimeEmissions.length;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/player-requests",
          headers: headers(secrets.author),
          payload: privateBody,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/player-requests",
          headers: headers(secrets.author),
          payload: { ...privateBody, title: "conflict" },
        })
      ).statusCode,
    ).toBe(409);
    expect(realtimeEmissions).toHaveLength(count);
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/player-requests/${privateResponse.json().id}`,
      headers: headers(secrets.author),
      payload: {
        actionId: id(),
        revision: 0,
        title: "Updated card",
        body: "Canonical only",
      },
    });
    expect(updated.statusCode).toBe(200);
    const transitioned = await action(
      secrets.gm,
      privateResponse.json().id,
      1,
      "ACKNOWLEDGE",
    );
    expect(transitioned.statusCode).toBe(200);
    expect(
      await db
        .select()
        .from(schema.chatMessages)
        .where(
          eq(schema.chatMessages.playerRequestId, privateResponse.json().id),
        ),
    ).toHaveLength(1);
  });
});
