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
import { registerWorldContentInstanceRoutes } from "./world-content-instances.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  cascadeCampaign: id(),
  gm: id(),
  player: id(),
  foreignGm: id(),
  cascadeGm: id(),
  entity: id(),
  draftEntity: id(),
  archivedEntity: id(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignGm: "f".repeat(40),
  cascadeGm: "c".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

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
    { id: ids.cascadeCampaign, name: "Cascade" },
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player",
    },
    {
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
    {
      id: ids.cascadeGm,
      campaignId: ids.cascadeCampaign,
      role: "GM",
      displayName: "Cascade GM",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.foreignGm, secrets.foreignGm],
    [ids.cascadeGm, secrets.cascadeGm],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.worldContent).values([
    {
      id: ids.entity,
      slug: "the-dragon",
      type: "MONSTER",
      name: "The Dragon",
      lifecycle: "PUBLISHED",
    },
    {
      id: ids.draftEntity,
      slug: "draft-entity",
      type: "PERSON",
      name: "Unpublished Innkeeper",
      lifecycle: "DRAFT",
    },
    {
      id: ids.archivedEntity,
      slug: "archived-entity",
      type: "ITEM",
      name: "Retired Sword",
      lifecycle: "ARCHIVED",
    },
  ]);
  app = Fastify();
  await app.register(cookie);
  registerWorldContentInstanceRoutes(app, db as never);
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await database.close();
});

const createBody = (overrides: Record<string, unknown> = {}) => ({
  actionId: id(),
  worldContentId: ids.entity,
  displayNameOverride: "Scarred Wyrm",
  ...overrides,
});
async function createInstance(
  secret: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/world-content-instances",
    headers: headers(secret),
    payload: createBody(overrides),
  });
}

describe("world content instances HTTP: create", () => {
  it("lets the GM create an instance", async () => {
    const res = await createInstance(secrets.gm);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      campaignId: ids.campaign,
      worldContentId: ids.entity,
      displayNameOverride: "Scarred Wyrm",
      discovered: false,
      revision: 0,
    });
  });

  it("forbids a non-GM from creating", async () => {
    const res = await createInstance(secrets.player);
    expect(res.statusCode).toBe(403);
  });

  it("404s when the canonical entity does not exist", async () => {
    const res = await createInstance(secrets.gm, { worldContentId: id() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "WORLD_CONTENT_NOT_FOUND" });
  });

  it("allows instancing a DRAFT canonical entity (GM sees everything)", async () => {
    const res = await createInstance(secrets.gm, {
      worldContentId: ids.draftEntity,
    });
    expect(res.statusCode).toBe(201);
  });

  it("allows instancing an ARCHIVED canonical entity", async () => {
    const res = await createInstance(secrets.gm, {
      worldContentId: ids.archivedEntity,
    });
    expect(res.statusCode).toBe(201);
  });

  it("is idempotent on duplicate actionId", async () => {
    const body = createBody();
    const first = await app.inject({
      method: "POST",
      url: "/api/world-content-instances",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const retry = await app.inject({
      method: "POST",
      url: "/api/world-content-instances",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });
});

describe("world content instances HTTP: list/get", () => {
  it("lists only the caller's own campaign instances", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const list = (
      await app.inject({
        method: "GET",
        url: "/api/world-content-instances",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(list.map((row: { id: string }) => row.id)).toContain(created.id);

    const foreignList = (
      await app.inject({
        method: "GET",
        url: "/api/world-content-instances",
        headers: headers(secrets.foreignGm),
      })
    ).json();
    expect(foreignList.map((row: { id: string }) => row.id)).not.toContain(
      created.id,
    );
  });

  it("filters by worldContentId", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const list = (
      await app.inject({
        method: "GET",
        url: `/api/world-content-instances?worldContentId=${ids.entity}`,
        headers: headers(secrets.gm),
      })
    ).json();
    expect(list.map((row: { id: string }) => row.id)).toContain(created.id);
    for (const row of list) expect(row.worldContentId).toBe(ids.entity);
  });

  it("404s (not leak) when a GM tries to read another campaign's instance", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "GET",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.foreignGm),
    });
    expect(res.statusCode).toBe(404);
  });

  it("forbids a non-GM from listing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/world-content-instances",
      headers: headers(secrets.player),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("world content instances HTTP: update", () => {
  it("lets the GM update overrides with revision CAS", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        revision: created.revision,
        currentState: "wounded, fled to the docks",
        discovered: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      currentState: "wounded, fled to the docks",
      discovered: true,
      revision: created.revision + 1,
    });
  });

  it("409s on a stale revision", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 99, currentState: "stale" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("is idempotent on duplicate actionId", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const body = {
      actionId: id(),
      revision: created.revision,
      currentState: "first edit",
    };
    const first = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const retry = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });

  it("404s (not leak) when the instance belongs to another campaign", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.foreignGm),
      payload: { actionId: id(), revision: created.revision, currentState: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("forbids a non-GM from updating", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.player),
      payload: { actionId: id(), revision: created.revision, currentState: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("world content instances HTTP: delete", () => {
  it("lets the GM hard-delete with revision CAS", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: created.revision },
    });
    expect(res.statusCode).toBe(204);
    const [row] = await db
      .select()
      .from(schema.worldContentInstances)
      .where(eq(schema.worldContentInstances.id, created.id));
    expect(row).toBeUndefined();
  });

  it("404s (not leak) when deleting another campaign's instance", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.foreignGm),
      payload: { actionId: id(), revision: created.revision },
    });
    expect(res.statusCode).toBe(404);
  });

  it("409s on a stale revision", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 99 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("is idempotent on duplicate actionId (replay after delete)", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const body = { actionId: id(), revision: created.revision };
    const first = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(204);
    const retry = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });

  it("forbids a non-GM from deleting", async () => {
    const created = (await createInstance(secrets.gm)).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${created.id}`,
      headers: headers(secrets.player),
      payload: { actionId: id(), revision: created.revision },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("world content instances: campaign cascade delete", () => {
  it("removes instances when their campaign is deleted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/world-content-instances",
      headers: headers(secrets.cascadeGm),
      payload: createBody({ actionId: id() }),
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();

    await db.delete(schema.campaigns).where(eq(schema.campaigns.id, ids.cascadeCampaign));

    const [row] = await db
      .select()
      .from(schema.worldContentInstances)
      .where(eq(schema.worldContentInstances.id, created.id));
    expect(row).toBeUndefined();
  });
});
