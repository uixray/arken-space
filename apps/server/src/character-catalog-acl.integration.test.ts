import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerRoutes } from "./routes.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  gm: id(),
  owner: id(),
  controller: id(),
  unrelated: id(),
  character: id(),
  catalogEntry: id(),
  foreignCampaign: id(),
  foreignCharacter: id(),
};
const secrets = {
  gm: "g".repeat(40),
  owner: "o".repeat(40),
  controller: "c".repeat(40),
  unrelated: "u".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await database.exec(
      (await readFile(new URL(file, migrations), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  db = drizzle(database, { schema });

  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Campaign" },
    { id: ids.foreignCampaign, name: "Foreign campaign" },
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
      id: ids.controller,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Controller",
    },
    {
      id: ids.unrelated,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Unrelated",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.owner, secrets.owner],
    [ids.controller, secrets.controller],
    [ids.unrelated, secrets.unrelated],
  ] as const) {
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    name: "Hero",
    ownerMembershipId: ids.owner,
  });
  await db.insert(schema.characters).values({
    id: ids.foreignCharacter,
    campaignId: ids.foreignCampaign,
    name: "Foreign hero",
  });

  await db.insert(schema.characterControllers).values({
    characterId: ids.character,
    membershipId: ids.controller,
  });

  await db.insert(schema.catalogEntries).values({
    id: ids.catalogEntry,
    campaignId: ids.campaign,
    kind: "SKILL",
    name: "Stealth",
    description: "Move quietly",
    data: { formula: "1d20+dexterity" },
  });

  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => [] }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

describe("Character catalog ACL and player ability management", () => {
  it("recharges only this character's short-rest abilities even when resources are full", async () => {
    const otherCharacterId = id();
    await db.insert(schema.characters).values({
      id: otherCharacterId,
      campaignId: ids.campaign,
      name: "Other hero",
      ownerMembershipId: ids.owner,
    });
    const entryIds = { target: id(), other: id(), day: id() };
    for (const [entryId, characterId, recharge] of [
      [entryIds.target, ids.character, "SHORT_REST"],
      [entryIds.other, otherCharacterId, "SHORT_REST"],
      [entryIds.day, ids.character, "DAY"],
    ] as const) {
      await db.insert(schema.characterCatalogEntries).values({
        id: entryId,
        characterId,
        kind: "ABILITY",
        name: recharge,
        data: { uses: { current: 0, max: 2, recharge } },
      });
    }
    const [character] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    const response = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.owner),
      payload: { actionId: id(), revision: character!.revision, rest: "SHORT" },
    });
    expect(response.statusCode).toBe(200);
    const rows = await db.select().from(schema.characterCatalogEntries);
    const uses = (entryId: string) =>
      (
        rows.find((row) => row.id === entryId)?.data as {
          uses: { current: number };
        }
      ).uses.current;
    expect(uses(entryIds.target)).toBe(2);
    expect(uses(entryIds.other)).toBe(0);
    expect(uses(entryIds.day)).toBe(0);

    await db
      .update(schema.characterCatalogEntries)
      .set({ data: { uses: { current: 0, max: 2, recharge: "SHORT_REST" } } })
      .where(eq(schema.characterCatalogEntries.id, entryIds.target));
    const [restedCharacter] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    const longRest = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.owner),
      payload: {
        actionId: id(),
        revision: restedCharacter!.revision,
        rest: "LONG",
      },
    });
    expect(longRest.statusCode).toBe(200);
    const afterLongRest = await db
      .select()
      .from(schema.characterCatalogEntries);
    const usesAfterLongRest = (entryId: string) =>
      (
        afterLongRest.find((row) => row.id === entryId)?.data as {
          uses: { current: number };
        }
      ).uses.current;
    expect(usesAfterLongRest(entryIds.target)).toBe(2);
    expect(usesAfterLongRest(entryIds.day)).toBe(2);
    expect(usesAfterLongRest(entryIds.other)).toBe(0);
  });
  it("creates a player character with self-ownership and hides foreign campaigns", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers: headers(secrets.owner),
      payload: { actionId: id(), name: "My character" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().ownerMembershipId).toBe(ids.owner);

    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}`,
      headers: headers(secrets.owner),
      payload: { actionId: id(), name: "Intrusion" },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("allows owner/controller resource, skill, and spell edits", async () => {
    for (const [secret, gold] of [
      [secrets.owner, 25],
      [secrets.controller, 26],
    ] as const) {
      const [beforeCounters] = await db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, ids.character));
      const counters = await app.inject({
        method: "PATCH",
        url: `/api/characters/${ids.character}/counters`,
        headers: headers(secret),
        payload: {
          actionId: id(),
          revision: beforeCounters!.revision,
          wallet: { gold, silver: 3, copper: 0, sp: 0 },
        },
      });
      expect(counters.statusCode).toBe(200);
      expect(counters.json().wallet).toMatchObject({
        gold,
        silver: 3,
        copper: 0,
        sp: 0,
      });
      const [walletPersisted] = await db
        .select()
        .from(schema.characters)
        .where(eq(schema.characters.id, ids.character));
      expect(walletPersisted?.wallet).toMatchObject({
        gold,
        silver: 3,
        copper: 0,
        sp: 0,
      });
      const skills = [
        {
          key: "stealth",
          name: "Stealth",
          rank: 2,
          formula: "1d20+dexterity",
        },
      ];
      const spells = [
        {
          key: "spark",
          name: "Spark",
          description: "A small flame",
          formula: "1d6",
        },
      ];
      for (const [field, value] of [
        ["skills", skills],
        ["spells", spells],
      ] as const) {
        const updated = await app.inject({
          method: "PATCH",
          url: `/api/characters/${ids.character}`,
          headers: headers(secret),
          payload: { actionId: id(), [field]: value },
        });
        expect(updated.statusCode).toBe(200);
        expect(updated.json()[field]).toEqual(value);
        const [persisted] = await db
          .select()
          .from(schema.characters)
          .where(eq(schema.characters.id, ids.character));
        expect(persisted?.[field]).toEqual(value);
      }
    }
  });

  it("denies a formerly delegated controller after grant revocation", async () => {
    await db
      .delete(schema.characterControllers)
      .where(eq(schema.characterControllers.characterId, ids.character));
    const revoked = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.controller),
      payload: { actionId: id(), catalogEntryId: ids.catalogEntry },
    });
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json()).toEqual({ error: "CHARACTER_FORBIDDEN" });
  });
  it("restricts campaign catalog template creation to GM", async () => {
    const resGm = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        kind: "ABILITY",
        name: "Fireball GM",
        description: "Boom",
        data: {},
      },
    });
    expect(resGm.statusCode).toBe(201);

    const resPlayer = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.owner),
      payload: {
        actionId: id(),
        kind: "ABILITY",
        name: "Fireball Player",
        description: "Player created ability",
        data: {},
      },
    });
    expect(resPlayer.statusCode).toBe(403);
    expect(resPlayer.json()).toEqual({ error: "GM_REQUIRED" });
  });

  it("allows character owner to assign, update, and delete catalog entries on their character", async () => {
    // 1. Assign
    const assignRes = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.owner),
      payload: {
        actionId: id(),
        catalogEntryId: ids.catalogEntry,
      },
    });
    expect(assignRes.statusCode).toBe(201);
    const assigned = assignRes.json();
    expect(assigned.id).toBeDefined();

    // 2. Update
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${assigned.id}`,
      headers: headers(secrets.owner),
      payload: {
        actionId: id(),
        name: "Stealth (Expert)",
        description: "Super quiet",
        data: { formula: "1d20+dexterity+2" },
        revision: assigned.revision,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json();
    expect(updated.name).toBe("Stealth (Expert)");

    // 3. Delete
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/characters/${ids.character}/catalog/${assigned.id}`,
      headers: headers(secrets.owner),
      payload: {
        actionId: id(),
        revision: updated.revision,
      },
    });
    expect(deleteRes.statusCode).toBe(200);
  });

  it("allows delegated controller to assign, update, and delete catalog entries on character", async () => {
    const assignRes = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.controller),
      payload: {
        actionId: id(),
        catalogEntryId: ids.catalogEntry,
      },
    });
    expect(assignRes.statusCode).toBe(201);
    const assigned = assignRes.json();

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${assigned.id}`,
      headers: headers(secrets.controller),
      payload: {
        actionId: id(),
        name: "Stealth (Controller)",
        data: {},
        revision: assigned.revision,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json();

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/characters/${ids.character}/catalog/${assigned.id}`,
      headers: headers(secrets.controller),
      payload: {
        actionId: id(),
        revision: updated.revision,
      },
    });
    expect(deleteRes.statusCode).toBe(200);
  });

  it("blocks unrelated player from assigning, editing, or deleting entries on someone else's character", async () => {
    // Attempt assign
    const assignRes = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.unrelated),
      payload: {
        actionId: id(),
        catalogEntryId: ids.catalogEntry,
      },
    });
    expect(assignRes.statusCode).toBe(403);
    expect(assignRes.json()).toEqual({ error: "CHARACTER_FORBIDDEN" });

    // Let GM assign one first
    const gmAssignRes = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: {
        actionId: id(),
        catalogEntryId: ids.catalogEntry,
      },
    });
    expect(gmAssignRes.statusCode).toBe(201);
    const assigned = gmAssignRes.json();

    // Attempt update by unrelated player
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${assigned.id}`,
      headers: headers(secrets.unrelated),
      payload: {
        actionId: id(),
        name: "Hacked",
        data: {},
        revision: assigned.revision,
      },
    });
    expect(updateRes.statusCode).toBe(403);
    expect(updateRes.json()).toEqual({ error: "CHARACTER_FORBIDDEN" });

    // Attempt delete by unrelated player
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/characters/${ids.character}/catalog/${assigned.id}`,
      headers: headers(secrets.unrelated),
      payload: {
        actionId: id(),
        revision: assigned.revision,
      },
    });
    expect(deleteRes.statusCode).toBe(403);
    expect(deleteRes.json()).toEqual({ error: "CHARACTER_FORBIDDEN" });
  });
});
