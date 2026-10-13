import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { starterStatLayout } from "@arken/system";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerRoutes } from "./routes.js";
import { createMigratedPglite } from "../../../tests/helpers/pglite-template.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let fakeSockets: Array<{
  data: {
    auth: {
      campaignId: string;
      membershipId: string;
      role: "GM" | "PLAYER";
      displayName: string;
    };
    viewedSceneId: null;
  };
  emit: (event: string, payload: unknown) => void;
}>;
let snapshotEmissions: Array<{
  membershipId: string;
  event: string;
  payload: unknown;
}>;
const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  owner: id(),
  siblingOwner: id(),
  foreignOwner: id(),
  character: id(),
  siblingCharacter: id(),
  foreignCharacter: id(),
};
const secrets = {
  gm: "g".repeat(40),
  owner: "o".repeat(40),
  siblingOwner: "s".repeat(40),
  foreignOwner: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const campaignLayout = () => {
  const layout = structuredClone(starterStatLayout);
  const group = layout.find((item) => item.id === "characteristics")!;
  group.rows.push({
    key: "campaignOnly",
    label: "Campaign only",
    source: "STAT",
  });
  return layout;
};
const layoutWith = (key: string) => {
  const layout = campaignLayout();
  layout
    .find((item) => item.id === "characteristics")!
    .rows.push({
      key,
      label: key,
      source: "STAT",
    });
  return layout;
};
const withoutKey = (layout: ReturnType<typeof campaignLayout>, key: string) =>
  layout.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => row.key !== key),
  }));

beforeEach(async () => {
  database = await createMigratedPglite();
  db = drizzle(database, { schema });
  fakeSockets = [];
  snapshotEmissions = [];
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Primary", statLayout: campaignLayout() },
    { id: ids.foreignCampaign, name: "Foreign", statLayout: campaignLayout() },
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
      id: ids.siblingOwner,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Sibling",
    },
    {
      id: ids.foreignOwner,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.owner, secrets.owner],
    [ids.siblingOwner, secrets.siblingOwner],
    [ids.foreignOwner, secrets.foreignOwner],
  ] as const) {
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  }
  await db.insert(schema.characters).values([
    {
      id: ids.character,
      campaignId: ids.campaign,
      ownerMembershipId: ids.owner,
      name: "Owner hero",
      stats: { craft: 9, campaignOnly: 4 },
      resources: { stamina: { current: 3, maximum: 5 } },
    },
    {
      id: ids.siblingCharacter,
      campaignId: ids.campaign,
      ownerMembershipId: ids.siblingOwner,
      name: "Sibling hero",
      stats: { craft: 2 },
    },
    {
      id: ids.foreignCharacter,
      campaignId: ids.foreignCampaign,
      ownerMembershipId: ids.foreignOwner,
      name: "Foreign hero",
    },
  ]);
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => fakeSockets }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await database.close();
});

const patch = (
  characterId: string,
  secret: string,
  actionId: string,
  revision: number,
  layout: ReturnType<typeof campaignLayout>,
) =>
  app.inject({
    method: "PATCH",
    url: `/api/characters/${characterId}/stat-layout`,
    headers: headers(secret),
    payload: { actionId, revision, layout },
  });

const bootstrap = async (secret: string) => {
  const response = await app.inject({
    method: "GET",
    url: "/api/bootstrap",
    headers: headers(secret),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
};

describe("PLAYER-owned character stat layout", () => {
  it("adds the nullable override column without rewriting an existing row", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(
        "CREATE TABLE characters (id uuid PRIMARY KEY, name text NOT NULL); INSERT INTO characters (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Legacy');",
      );
      const migration = await readFile(
        new URL(
          "../../../packages/db/drizzle/0059_character_stat_layout.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await legacy.exec(migration.replaceAll("--> statement-breakpoint", ""));
      const rows = await legacy.query<{ stat_layout: unknown }>(
        "SELECT stat_layout FROM characters WHERE name = 'Legacy'",
      );
      expect(rows.rows).toEqual([{ stat_layout: null }]);
    } finally {
      await legacy.close();
    }
  });

  it("inherits campaign layout until edited, then isolates override and preserves values/replay", async () => {
    const [legacyCharacter] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(legacyCharacter!.statLayout).toBeNull();
    const before = await bootstrap(secrets.owner);
    expect(before.campaign.statLayout).toEqual(campaignLayout());
    expect(
      before.characters.find((row: { id: string }) => row.id === ids.character)
        .statLayout,
    ).toEqual(before.campaign.statLayout);
    const next = layoutWith("personalOnly");
    const actionId = id();
    const first = await patch(ids.character, secrets.owner, actionId, 0, next);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ characterId: ids.character, revision: 1 });
    const replay = await patch(ids.character, secrets.owner, actionId, 0, next);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const [receipt] = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, actionId));
    expect(receipt?.payload).toMatchObject({
      keys: expect.arrayContaining(["personalOnly"]),
    });
    expect(receipt?.payload).not.toHaveProperty("layout");
    expect(Object.keys(receipt?.payload as object).sort()).toEqual([
      "fingerprint",
      "keys",
    ]);
    const reused = await patch(
      ids.character,
      secrets.owner,
      actionId,
      0,
      layoutWith("different"),
    );
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error).toBe("ACTION_ID_REUSED");

    const ownerSnapshot = await bootstrap(secrets.owner);
    const siblingSnapshot = await bootstrap(secrets.siblingOwner);
    const foreignSnapshot = await bootstrap(secrets.foreignOwner);
    expect(
      foreignSnapshot.characters.map((row: { id: string }) => row.id),
    ).not.toContain(ids.character);
    expect(JSON.stringify(foreignSnapshot)).not.toContain("personalOnly");
    expect(ownerSnapshot.campaign.statLayout).toEqual(campaignLayout());
    expect(
      ownerSnapshot.characters.find(
        (row: { id: string }) => row.id === ids.character,
      ).statLayout,
    ).toEqual(next);
    expect(
      siblingSnapshot.characters.find(
        (row: { id: string }) => row.id === ids.siblingCharacter,
      ).statLayout,
    ).toEqual(siblingSnapshot.campaign.statLayout);
    const [stored] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(stored).toBeDefined();
    expect(stored!.statLayout).toEqual(next);
    expect(stored!.stats).toEqual({ craft: 9, campaignOnly: 4 });
    expect(stored!.resources).toEqual({ stamina: { current: 3, maximum: 5 } });
  });

  it("does not disclose foreign campaign characters and denies same-campaign other owners", async () => {
    const actionId = id();
    const layout = layoutWith("personalOnly");
    const otherOwner = await patch(
      ids.character,
      secrets.siblingOwner,
      actionId,
      0,
      layout,
    );
    expect(otherOwner.statusCode).toBe(403);
    expect(otherOwner.json().error).toBe("CHARACTER_FORBIDDEN");
    const crossCampaign = await patch(
      ids.foreignCharacter,
      secrets.owner,
      actionId,
      0,
      layout,
    );
    expect(crossCampaign.statusCode).toBe(404);
    expect(crossCampaign.json().error).toBe("CHARACTER_NOT_FOUND");
    const gm = await patch(ids.character, secrets.gm, actionId, 0, layout);
    expect(gm.statusCode).toBe(403);
    expect(gm.json().error).toBe("PLAYER_REQUIRED");
  });

  it("uses character revision CAS and keeps the shared GM layout endpoint GM-only", async () => {
    const stale = await patch(
      ids.character,
      secrets.owner,
      id(),
      3,
      layoutWith("personalOnly"),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: "CHARACTER_CONFLICT",
      revision: 0,
    });
    const shared = await app.inject({
      method: "PATCH",
      url: "/api/campaign/stat-layout",
      headers: headers(secrets.owner),
      payload: {
        actionId: id(),
        revision: 0,
        layout: layoutWith("sharedAttempt"),
      },
    });
    expect(shared.statusCode).toBe(403);
    expect(shared.json().error).toBe("GM_REQUIRED");
  });

  it("rejects replay receipts owned by another actor or entity without returning projection", async () => {
    const actionForOtherEntity = id();
    const actionForOtherMember = id();
    const actionForOtherPayload = id();
    const layout = layoutWith("personalOnly");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ revision: 0, layout }))
      .digest("hex");
    await db.insert(schema.gameEvents).values([
      {
        campaignId: ids.campaign,
        actionId: actionForOtherEntity,
        membershipId: ids.owner,
        type: "character.stat-layout.updated",
        entityType: "character",
        entityId: ids.siblingCharacter,
        entityRevision: 1,
        payload: { fingerprint, keys: [] },
      },
      {
        campaignId: ids.campaign,
        actionId: actionForOtherMember,
        membershipId: ids.siblingOwner,
        type: "character.stat-layout.updated",
        entityType: "character",
        entityId: ids.character,
        entityRevision: 1,
        payload: { fingerprint, keys: [] },
      },
      {
        campaignId: ids.campaign,
        actionId: actionForOtherPayload,
        membershipId: ids.owner,
        type: "character.stat-layout.updated",
        entityType: "character",
        entityId: ids.character,
        entityRevision: 1,
        payload: { fingerprint: "0".repeat(64), keys: [] },
      },
    ]);
    for (const actionId of [
      actionForOtherEntity,
      actionForOtherMember,
      actionForOtherPayload,
    ]) {
      const response = await patch(
        ids.character,
        secrets.owner,
        actionId,
        0,
        layout,
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "ACTION_ID_REUSED" });
    }
  });

  it("broadcasts an allowed reorder with per-owner effective layouts", async () => {
    const ownLayout = layoutWith("personalOnly");
    const first = await patch(ids.character, secrets.owner, id(), 0, ownLayout);
    expect(first.statusCode).toBe(200);
    const reordered = structuredClone(ownLayout);
    reordered.find((group) => group.id === "characteristics")!.rows.reverse();
    const makeSocket = (membershipId: string, displayName: string) => ({
      data: {
        auth: {
          campaignId: ids.campaign,
          membershipId,
          role: "PLAYER" as const,
          displayName,
        },
        viewedSceneId: null,
      },
      emit: (event: string, payload: unknown) =>
        snapshotEmissions.push({ membershipId, event, payload }),
    });
    fakeSockets = [
      makeSocket(ids.owner, "Owner"),
      makeSocket(ids.siblingOwner, "Sibling"),
    ];
    const result = await patch(
      ids.character,
      secrets.owner,
      id(),
      1,
      reordered,
    );
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ characterId: ids.character, revision: 2 });
    const ownerEvent = snapshotEmissions.find(
      (item) => item.membershipId === ids.owner,
    );
    const siblingEvent = snapshotEmissions.find(
      (item) => item.membershipId === ids.siblingOwner,
    );
    expect(ownerEvent?.event).toBe("game:snapshot");
    expect(
      (
        ownerEvent?.payload as {
          characters: Array<{ id: string; statLayout: unknown }>;
        }
      ).characters.find((row) => row.id === ids.character)?.statLayout,
    ).toEqual(reordered);
    expect(siblingEvent?.event).toBe("game:snapshot");
    expect(
      (
        siblingEvent?.payload as {
          characters: Array<{ id: string; statLayout: unknown }>;
        }
      ).characters.find((row) => row.id === ids.siblingCharacter)?.statLayout,
    ).toEqual(
      (siblingEvent?.payload as { campaign: { statLayout: unknown } }).campaign
        .statLayout,
    );
  });

  it("rejects deleting a stat referenced by the character's own skill formula", async () => {
    const current = layoutWith("craft");
    await db
      .update(schema.characters)
      .set({
        statLayout: current,
        skills: [
          {
            key: "lockpick",
            name: "Lockpick",
            rank: 1,
            formula: "1d20 + craft",
          },
        ],
        spells: [
          {
            key: "cantrip",
            name: "Cantrip",
            description: "",
            formula: "1d20 + craft",
          },
        ],
      })
      .where(eq(schema.characters.id, ids.character));
    await db.insert(schema.characterCatalogEntries).values({
      id: id(),
      characterId: ids.character,
      kind: "ABILITY",
      name: "Personal Focus",
      data: {
        rollActions: [
          { modifiers: [{ type: "CHARACTERISTIC", key: "craft" }] },
        ],
      },
    });
    const response = await patch(
      ids.character,
      secrets.owner,
      id(),
      0,
      withoutKey(current, "craft"),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "STAT_ROW_REFERENCED",
      key: "craft",
    });
    expect(response.json().references).toContainEqual({
      kind: "SKILL",
      name: "Lockpick",
      owner: "Owner hero",
    });
    expect(response.json().references).toContainEqual({
      kind: "SPELL",
      name: "Cantrip",
      owner: "Owner hero",
    });
    expect(response.json().references).toContainEqual({
      kind: "CHARACTER_ENTRY",
      name: "Personal Focus",
      owner: "Owner hero",
    });
  });

  it("rejects deleting a stat referenced by a campaign catalog modifier", async () => {
    const current = layoutWith("craft");
    await db
      .update(schema.characters)
      .set({ statLayout: current })
      .where(eq(schema.characters.id, ids.character));
    await db.insert(schema.catalogEntries).values({
      id: id(),
      campaignId: ids.campaign,
      kind: "ABILITY",
      name: "Focus",
      description: "Focus",
      data: {
        rollActions: [
          { modifiers: [{ type: "CHARACTERISTIC", key: "craft" }] },
        ],
      },
    });
    const response = await patch(
      ids.character,
      secrets.owner,
      id(),
      0,
      withoutKey(current, "craft"),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "STAT_ROW_REFERENCED",
      key: "craft",
    });
    expect(response.json().references).toContainEqual({
      kind: "CATALOG_ENTRY",
      name: "Focus",
    });
  });

  it("scopes personal formula reference checks to the target character, not siblings", async () => {
    const current = layoutWith("craft");
    await db
      .update(schema.characters)
      .set({ statLayout: current })
      .where(eq(schema.characters.id, ids.character));
    await db
      .update(schema.characters)
      .set({
        skills: [
          {
            key: "lockpick",
            name: "Sibling lockpick",
            rank: 1,
            formula: "1d20 + craft",
          },
        ],
      })
      .where(eq(schema.characters.id, ids.siblingCharacter));
    const response = await patch(
      ids.character,
      secrets.owner,
      id(),
      0,
      withoutKey(current, "craft"),
    );
    expect(response.statusCode).toBe(200);
    const [stored] = await db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, ids.character));
    expect(stored).toBeDefined();
    expect(stored!.statLayout).not.toBeNull();
    expect(stored!.stats.craft).toBe(9);
  });
});
