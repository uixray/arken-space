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
import { registerCharacterMediaRoutes } from "./character-media.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  owner: id(),
  other: id(),
  foreign: id(),
  character: id(),
  foreignCharacter: id(),
  asset: id(),
  foreignAsset: id(),
};
const secrets = {
  gm: "g".repeat(40),
  owner: "o".repeat(40),
  other: "p".repeat(40),
  foreign: "f".repeat(40),
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
  ]);
  await db.insert(schema.memberships).values([
    { id: ids.gm, campaignId: ids.campaign, role: "GM", displayName: "GM" },
    {
      id: ids.owner,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Owner",
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
    [ids.owner, secrets.owner],
    [ids.other, secrets.other],
    [ids.foreign, secrets.foreign],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.characters).values([
    {
      id: ids.character,
      campaignId: ids.campaign,
      ownerMembershipId: ids.owner,
      name: "Hero",
    },
    {
      id: ids.foreignCharacter,
      campaignId: ids.foreignCampaign,
      ownerMembershipId: ids.foreign,
      name: "Foreign hero",
    },
  ]);
  await db.insert(schema.assets).values([
    {
      id: ids.asset,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "IMAGE",
      name: "art.png",
      storageKey: "campaign/art.png",
      mimeType: "image/png",
      sizeBytes: 100,
    },
    {
      id: ids.foreignAsset,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreign,
      kind: "IMAGE",
      name: "foreign.png",
      storageKey: "foreign/art.png",
      mimeType: "image/png",
      sizeBytes: 100,
    },
  ]);
  app = Fastify();
  await app.register(cookie);
  registerCharacterMediaRoutes(app, db as never);
  await app.ready();
}, 30_000);
afterAll(async () => {
  await app.close();
  await database.close();
});

const createBody = (overrides: Record<string, unknown> = {}) => ({
  actionId: id(),
  characterId: ids.character,
  assetId: ids.asset,
  category: "CHARACTER_ART",
  ...overrides,
});
async function createMedia(
  secret: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/characters/${ids.character}/media`,
    headers: headers(secret),
    payload: createBody(overrides),
  });
}

describe("character media HTTP: create", () => {
  it("lets the GM create for any character", async () => {
    const res = await createMedia(secrets.gm);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      characterId: ids.character,
      assetId: ids.asset,
      visibility: "OWNER_GM",
      revision: 0,
    });
  });
  it("lets the owner create for their own character", async () => {
    const res = await createMedia(secrets.owner);
    expect(res.statusCode).toBe(201);
  });
  it("forbids another player from creating on someone else's character", async () => {
    const res = await createMedia(secrets.other);
    expect(res.statusCode).toBe(403);
  });
  it("rejects a cross-campaign asset id", async () => {
    const res = await createMedia(secrets.gm, { assetId: ids.foreignAsset });
    expect(res.statusCode).toBe(404);
  });
  it("rejects a cross-campaign character id in the URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/media`,
      headers: headers(secrets.gm),
      payload: createBody({ characterId: ids.foreignCharacter }),
    });
    expect(res.statusCode).toBe(404);
  });
  it("is idempotent on duplicate actionId", async () => {
    const body = createBody();
    const first = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/media`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const retry = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/media`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });
});

describe("character media HTTP: list visibility", () => {
  it("filters by role: GM sees all, owner sees own OWNER_GM+PARTY, others see PARTY only", async () => {
    const ownerGm = (
      await createMedia(secrets.gm, { visibility: "OWNER_GM" })
    ).json();
    const party = (
      await createMedia(secrets.gm, { visibility: "PARTY" })
    ).json();
    const gmOnly = (
      await createMedia(secrets.gm, { visibility: "GM_ONLY" })
    ).json();

    const gmList = (
      await app.inject({
        method: "GET",
        url: `/api/characters/${ids.character}/media`,
        headers: headers(secrets.gm),
      })
    ).json();
    const gmIds = gmList.map((row: { id: string }) => row.id);
    expect(gmIds).toEqual(
      expect.arrayContaining([ownerGm.id, party.id, gmOnly.id]),
    );

    const ownerList = (
      await app.inject({
        method: "GET",
        url: `/api/characters/${ids.character}/media`,
        headers: headers(secrets.owner),
      })
    ).json();
    const ownerIds = ownerList.map((row: { id: string }) => row.id);
    expect(ownerIds).toEqual(expect.arrayContaining([ownerGm.id, party.id]));
    expect(ownerIds).not.toContain(gmOnly.id);

    const otherList = (
      await app.inject({
        method: "GET",
        url: `/api/characters/${ids.character}/media`,
        headers: headers(secrets.other),
      })
    ).json();
    const otherIds = otherList.map((row: { id: string }) => row.id);
    expect(otherIds).toContain(party.id);
    expect(otherIds).not.toContain(ownerGm.id);
    expect(otherIds).not.toContain(gmOnly.id);
  });
});

describe("character media HTTP: edit", () => {
  it("lets the GM and owner edit, revision-gates, and forbids other players", async () => {
    const created = (await createMedia(secrets.gm)).json();
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.other),
      payload: { actionId: id(), revision: 0, caption: "nope" },
    });
    expect(forbidden.statusCode).toBe(403);
    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 5, caption: "wrong revision" },
    });
    expect(conflict.statusCode).toBe(409);
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 0, caption: "Updated caption" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      caption: "Updated caption",
      revision: 1,
    });
  });
  it("is idempotent on duplicate actionId for edits", async () => {
    const created = (await createMedia(secrets.gm)).json();
    const actionId = id();
    const payload = { actionId, revision: 0, caption: "Once" };
    const first = await app.inject({
      method: "PATCH",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.gm),
      payload,
    });
    expect(first.statusCode).toBe(200);
    const retry = await app.inject({
      method: "PATCH",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.gm),
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ duplicate: true });
  });
});

describe("character media HTTP: detach", () => {
  it("lets owner and GM detach but not other players, and hides detached rows from list", async () => {
    const created = (await createMedia(secrets.gm, { visibility: "PARTY" })).json();
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/character-media/${created.id}/detach`,
      headers: headers(secrets.other),
      payload: { actionId: id(), revision: 0 },
    });
    expect(forbidden.statusCode).toBe(403);
    const detached = await app.inject({
      method: "POST",
      url: `/api/character-media/${created.id}/detach`,
      headers: headers(secrets.owner),
      payload: { actionId: id(), revision: 0 },
    });
    expect(detached.statusCode).toBe(200);
    expect(detached.json().detachedAt).not.toBeNull();
    const list = (
      await app.inject({
        method: "GET",
        url: `/api/characters/${ids.character}/media`,
        headers: headers(secrets.gm),
      })
    ).json();
    expect(list.some((row: { id: string }) => row.id === created.id)).toBe(
      false,
    );
  });
});

describe("character media HTTP: delete", () => {
  it("is GM-only and does not affect the underlying asset", async () => {
    const created = (await createMedia(secrets.owner)).json();
    const forbiddenOwner = await app.inject({
      method: "DELETE",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.owner),
      payload: { actionId: id(), revision: 0 },
    });
    expect(forbiddenOwner.statusCode).toBe(403);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/character-media/${created.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: id(), revision: 0 },
    });
    expect(deleted.statusCode).toBe(204);
    const assetStillThere = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, ids.asset));
    expect(assetStillThere).toHaveLength(1);
  });
});
