import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import { env } from "../apps/server/src/env.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignPlayer: crypto.randomUUID(),
  foreignCharacter: crypto.randomUUID(),
  character: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  definition: crypto.randomUUID(),
  token: crypto.randomUUID(),
  foreignAsset: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignPlayer: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
  database = new PGlite();
  for (const file of (
    await readdir(new URL("../packages/db/drizzle/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await database.exec(
      (
        await readFile(
          new URL(`../packages/db/drizzle/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("--> statement-breakpoint", ""),
    );
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "A", activeSceneId: ids.scene },
    { id: ids.foreignCampaign, name: "B" },
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
      id: ids.foreignPlayer,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(secrets.gm),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: ids.player,
      tokenHash: hashToken(secrets.player),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: ids.foreignPlayer,
      tokenHash: hashToken(secrets.foreignPlayer),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  await db.insert(schema.characters).values({
    id: ids.character,
    campaignId: ids.campaign,
    ownerMembershipId: ids.player,
    name: "Hero",
    stats: {
      strength: 2,
      agility: 3,
      endurance: 0,
      vitality: 0,
      knowledge: 0,
      intelligence: 0,
      willpower: 0,
      charisma: 0,
    },
  });
  await db.insert(schema.characters).values({
    id: ids.foreignCharacter,
    campaignId: ids.foreignCampaign,
    ownerMembershipId: ids.foreignPlayer,
    name: "Foreign Hero",
    stats: {
      strength: 0,
      agility: 0,
      endurance: 0,
      vitality: 0,
      knowledge: 0,
      intelligence: 0,
      willpower: 0,
      charisma: 0,
    },
  });
  await db.insert(schema.scenes).values({
    id: ids.scene,
    campaignId: ids.campaign,
    name: "Map",
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.2,
    },
  });
  await db.insert(schema.assets).values({
    id: ids.foreignAsset,
    campaignId: ids.foreignCampaign,
    uploadedByMembershipId: ids.foreignPlayer,
    kind: "TOKEN",
    name: "Foreign",
    storageKey: crypto.randomUUID(),
    mimeType: "image/webp",
    sizeBytes: 1,
  });
  await db.insert(schema.tokenDefinitions).values({
    id: ids.definition,
    campaignId: ids.campaign,
    characterId: ids.character,
    name: "Hero",
  });
  await db
    .insert(schema.tokenControllers)
    .values({ tokenDefinitionId: ids.definition, membershipId: ids.player });
  await db.insert(schema.tokens).values({
    id: ids.token,
    definitionId: ids.definition,
    sceneId: ids.scene,
    name: "Hero",
    x: 0,
    y: 0,
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

describe("Pool B HTTP boundaries", () => {
  it("replaces controllers with GM auth, CAS, replay and reconnect revision", async () => {
    const playerDenied = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [],
      },
    });
    expect(playerDenied.statusCode).toBe(403);
    const duplicateIds = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.player, ids.player],
      },
    });
    expect(duplicateIds.statusCode).toBe(400);
    const foreign = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.foreignPlayer],
      },
    });
    expect(foreign.statusCode).toBe(400);
    const actionId = crypto.randomUUID();
    const accepted = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0, controllerMembershipIds: [] },
    });
    expect(accepted.json()).toMatchObject({
      ok: true,
      revision: 1,
      controllerMembershipIds: [],
    });
    const replay = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: { actionId, revision: 0, controllerMembershipIds: [] },
    });
    expect(replay.json()).toMatchObject({ duplicate: true });
    const conflict = await app.inject({
      method: "PUT",
      url: `/api/token-definitions/${ids.definition}/controllers`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        controllerMembershipIds: [ids.player],
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ revision: 1 });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.gm),
    });
    expect(snapshot.json().tokens[0]).toMatchObject({
      definitionRevision: 1,
      controllerMembershipIds: [],
    });
  });

  it("enforces catalog permissions, receipts, assignment snapshots and role filtering", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "SKILL",
        name: "No",
        description: "",
        data: {},
      },
    });
    expect(denied.statusCode).toBe(403);
    const createAction = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: createAction,
        kind: "ABILITY",
        name: "Wave",
        description: "old",
        data: { power: 1 },
      },
    });
    expect(created.statusCode).toBe(201);
    const template = created.json();
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: createAction,
        kind: "ABILITY",
        name: "Ignored",
        description: "",
        data: {},
      },
    });
    expect(duplicate.json()).toMatchObject({ duplicate: true });
    const updateAction = crypto.randomUUID();
    const updatedTemplate = await app.inject({
      method: "PATCH",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: updateAction,
        name: "Wave v2",
        description: "new",
        data: { power: 2 },
      },
    });
    expect(updatedTemplate.json()).toMatchObject({
      name: "Wave v2",
      revision: 1,
      data: { power: 2 },
    });
    const updateReplay = await app.inject({
      method: "PATCH",
      url: `/api/catalog/${template.id}`,
      headers: headers(secrets.gm),
      payload: { actionId: updateAction, name: "Must not apply" },
    });
    expect(updateReplay.json()).toMatchObject({ duplicate: true });
    const assigned = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), catalogEntryId: template.id },
    });
    expect(assigned.statusCode).toBe(201);
    const entry = assigned.json();
    const playerEdit = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), name: "Hack" },
    });
    expect(playerEdit.statusCode).toBe(403);
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/catalog/${entry.id}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "SKILL",
        name: "Custom",
        description: "changed",
        data: { power: 9 },
      },
    });
    expect(edited.json()).toMatchObject({
      name: "Custom",
      kind: "SKILL",
      data: { power: 9 },
      sourceCatalogEntryId: template.id,
    });
    const playerSnapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(playerSnapshot.json()).toMatchObject({
      catalogEntries: [],
      characters: [{ entries: [expect.objectContaining({ name: "Custom" })] }],
    });
    const events = await database.query<{ count: number }>(
      `select count(*)::int count from game_events where campaign_id='${ids.campaign}'`,
    );
    expect(events.rows[0]!.count).toBe(4);
  });

  it("rejects a foreign-campaign token asset without creating a receipt", async () => {
    const actionId = crypto.randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/tokens",
      headers: headers(secrets.gm),
      payload: {
        actionId,
        sceneId: ids.scene,
        assetId: ids.foreignAsset,
        name: "Bad",
        x: 0,
        y: 0,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "ASSET_NOT_FOUND" });
    const receipt = await database.query<{ count: number }>(
      `select count(*)::int count from game_events where action_id='${actionId}'`,
    );
    expect(receipt.rows[0]!.count).toBe(0);
  });

  it("executes authorized ordered entry rolls and audits/decrements uses atomically", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "ABILITY",
        name: "Stun",
        description: "Lowers initiative",
        data: {
          notes: "GM note",
          values: { magic: 4 },
          uses: { current: 1, max: 1, recharge: "DAY" },
          rollActions: [
            {
              id: "hit",
              kind: "HIT",
              label: "Hit",
              dice: "1d20",
              order: 0,
              advantage: true,
              consumeUse: false,
              modifiers: [{ type: "CHARACTERISTIC", key: "agility" }],
            },
            {
              id: "damage",
              kind: "DAMAGE",
              label: "Damage",
              dice: "1d8",
              order: 1,
              advantage: false,
              consumeUse: true,
              modifiers: [{ type: "ENTRY_VALUE", key: "magic" }],
            },
          ],
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const template = create.json();
    const assigned = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog`,
      headers: headers(secrets.gm),
      payload: { actionId: crypto.randomUUID(), catalogEntryId: template.id },
    });
    const entry = assigned.json();
    const roll = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        rollActionId: "hit",
        visibility: "PUBLIC",
      },
    });
    expect(roll.statusCode).toBe(201);
    expect(roll.json()).toMatchObject({
      formula: "2d20kh1 + modifier_0",
      source: { entryName: "Stun", actionKind: "HIT" },
      actor: { membershipId: ids.player },
      characterId: ids.character,
    });
    expect(roll.json().terms[0].rolls).toHaveLength(2);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json().characters[0].entries[0].data.uses.current).toBe(1);
    expect(snapshot.json().messages.at(-1)).toMatchObject({
      kind: "DICE",
      body: expect.stringContaining("Lowers initiative"),
    });
    const damageActionId = crypto.randomUUID();
    const damage = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: damageActionId,
        rollActionId: "damage",
        visibility: "PUBLIC",
      },
    });
    expect(damage.statusCode).toBe(201);
    const afterDamage = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(afterDamage.json().characters[0].entries[0].data.uses.current).toBe(
      0,
    );
    expect(afterDamage.json().messages.slice(-2)).toEqual([
      expect.objectContaining({ kind: "DICE", visibility: "PUBLIC" }),
      expect.objectContaining({ kind: "SYSTEM", visibility: "PUBLIC" }),
    ]);
    const replay = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: damageActionId,
        rollActionId: "damage",
        visibility: "PUBLIC",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ duplicate: true });
    const exhausted = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${entry.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        rollActionId: "damage",
        visibility: "PUBLIC",
      },
    });
    expect(exhausted.statusCode).toBe(409);
  });

  it("updates clock, cooldowns, resources and wallet with public system audit", async () => {
    await db.insert(schema.characterCatalogEntries).values([
      {
        characterId: ids.character,
        kind: "ABILITY",
        name: "Weekly",
        data: {
          uses: { current: 0, max: 1, recharge: "WEEK", lastRechargeDay: 1 },
        },
      },
      {
        characterId: ids.character,
        kind: "ABILITY",
        name: "Battle",
        data: { uses: { current: 0, max: 2, recharge: "BATTLE" } },
      },
    ]);
    await database.exec(
      `update campaigns set day = 7 where id = '${ids.campaign}'`,
    );
    const countersActionId = crypto.randomUUID();
    const counters = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: countersActionId,
        revision: 0,
        wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
        resources: { mana: { current: 5, maximum: 8 } },
      },
    });
    expect(counters.statusCode).toBe(200);
    expect(counters.json()).toMatchObject({
      wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
      resources: { mana: { current: 5, maximum: 8 } },
      revision: 1,
    });
    const countersReplay = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: countersActionId,
        revision: 0,
        wallet: { gold: 9, silver: 9, copper: 9, sp: 9 },
      },
    });
    expect(countersReplay.json()).toEqual({ duplicate: true });
    const advanceActionId = crypto.randomUUID();
    const advance = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: advanceActionId,
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(advance.json()).toMatchObject({ day: 8, revision: 1 });
    const advanceReplay = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: advanceActionId,
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(advanceReplay.json()).toEqual({ duplicate: true });
    const start = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "START_BATTLE",
        revision: 1,
      },
    });
    expect(start.json()).toMatchObject({
      battleActive: true,
      battleCounter: 1,
      revision: 2,
    });
    const end = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "END_BATTLE",
        revision: 2,
      },
    });
    expect(end.json()).toMatchObject({
      battleActive: false,
      battleCounter: 1,
      revision: 3,
    });
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(snapshot.json()).toMatchObject({
      campaign: { day: 8, battleActive: false, battleCounter: 1, revision: 3 },
      characters: [
        {
          wallet: { gold: 1, silver: 2, copper: 3, sp: 4 },
          resources: { mana: { current: 5, maximum: 8 } },
        },
      ],
    });
    expect(
      snapshot
        .json()
        .characters[0].entries.map(
          (entry: { data: { uses?: { current: number } } }) =>
            entry.data.uses?.current,
        ),
    ).toEqual([1, 2]);
    expect(
      snapshot
        .json()
        .messages.filter(
          (message: { kind: string }) => message.kind === "SYSTEM",
        ),
    ).toHaveLength(4);
  });

  it("rejects foreign ownership, player clock access, malformed use models and stale revisions", async () => {
    const [foreignEntry] = await db
      .insert(schema.characterCatalogEntries)
      .values({
        characterId: ids.foreignCharacter,
        kind: "ABILITY",
        name: "Foreign ability",
        data: {
          uses: { current: 1, max: 1, recharge: "DAY" },
          rollActions: [
            {
              id: "use",
              kind: "CUSTOM",
              label: "Use",
              dice: "1d20",
              modifiers: [],
              order: 0,
              consumeUse: true,
            },
          ],
        },
      })
      .returning();
    const foreignHeaders = headers(secrets.foreignPlayer);
    const roll = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/catalog/${foreignEntry!.id}/roll`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        rollActionId: "use",
        visibility: "PUBLIC",
      },
    });
    expect(roll.statusCode).toBe(403);
    const recharge = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/catalog/${foreignEntry!.id}/recharge`,
      headers: headers(secrets.player),
      payload: { actionId: crypto.randomUUID(), revision: 0 },
    });
    expect(recharge.statusCode).toBe(403);
    const counters = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
      },
    });
    expect(counters.statusCode).toBe(403);
    const clock = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: foreignHeaders,
      payload: {
        actionId: crypto.randomUUID(),
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(clock.statusCode).toBe(403);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/catalog",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        kind: "ABILITY",
        name: "Malformed",
        data: {
          uses: { current: 2, max: 1, recharge: "DAY" },
          rollActions: [
            {
              id: "bad",
              kind: "CUSTOM",
              label: "Bad",
              dice: "1d20",
              order: 0,
              consumeUse: true,
              modifiers: [{ type: "FORMULA", formula: "magic+1" }],
            },
          ],
        },
      },
    });
    expect(malformed.statusCode).toBe(400);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/characters/${ids.character}/counters`,
      headers: headers(secrets.player),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 99,
        wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
      },
    });
    expect(stale.statusCode).toBe(409);
  });

  it("anchors manual recharge to the current interval", async () => {
    await database.exec(
      `update campaigns set day=8,battle_counter=3 where id='${ids.campaign}'`,
    );
    const [weekly, battle, daily] = await db
      .insert(schema.characterCatalogEntries)
      .values([
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Weekly anchor",
          data: {
            uses: {
              current: 0,
              max: 1,
              recharge: "WEEK",
              lastRechargeDay: 1,
            },
          },
        },
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Battle anchor",
          data: { uses: { current: 0, max: 1, recharge: "BATTLE" } },
        },
        {
          characterId: ids.character,
          kind: "ABILITY",
          name: "Daily anchor",
          data: { uses: { current: 0, max: 1, recharge: "DAY" } },
        },
      ])
      .returning();
    const actionId = crypto.randomUUID();
    const recharge = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${weekly!.id}/recharge`,
      headers: headers(secrets.player),
      payload: { actionId, revision: 0 },
    });
    expect(recharge.statusCode).toBe(200);
    expect(recharge.json().data.uses).toMatchObject({
      current: 1,
      lastRechargeDay: 8,
    });
    for (const entry of [battle!, daily!]) {
      const anchored = await app.inject({
        method: "POST",
        url: `/api/characters/${ids.character}/catalog/${entry.id}/recharge`,
        headers: headers(secrets.player),
        payload: { actionId: crypto.randomUUID(), revision: 0 },
      });
      expect(anchored.statusCode).toBe(200);
      expect(anchored.json().data.uses).toMatchObject(
        entry.id === battle!.id
          ? { lastBattleCounter: 3 }
          : { lastRechargeDay: 8 },
      );
    }
    const replay = await app.inject({
      method: "POST",
      url: `/api/characters/${ids.character}/catalog/${weekly!.id}/recharge`,
      headers: headers(secrets.player),
      payload: { actionId, revision: 0 },
    });
    expect(replay.json()).toEqual({ duplicate: true });
    await database.exec(
      `update character_catalog_entries set data=jsonb_set(data,'{uses,current}','0') where id='${weekly!.id}'`,
    );
    const advance = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(advance.statusCode).toBe(200);
    const [notDue] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, weekly!.id));
    expect((notDue!.data as { uses: { current: number } }).uses.current).toBe(
      0,
    );
    for (let revision = 1; revision <= 6; revision++) {
      const next = await app.inject({
        method: "POST",
        url: "/api/campaign/clock",
        headers: headers(secrets.gm),
        payload: {
          actionId: crypto.randomUUID(),
          command: "ADVANCE_DAY",
          revision,
        },
      });
      expect(next.statusCode).toBe(200);
    }
    const [due] = await db
      .select()
      .from(schema.characterCatalogEntries)
      .where(eq(schema.characterCatalogEntries.id, weekly!.id));
    expect((due!.data as { uses: { current: number } }).uses.current).toBe(1);
  });

  it("rolls back the complete clock mutation when a due entry CAS fails", async () => {
    await db.insert(schema.characterCatalogEntries).values({
      characterId: ids.character,
      kind: "ABILITY",
      name: "Blocked recharge",
      data: { uses: { current: 0, max: 1, recharge: "DAY" } },
    });
    await database.exec(`
      create function reject_entry_update() returns trigger language plpgsql as $$ begin return null; end $$;
      create trigger reject_entry_update before update on character_catalog_entries for each row execute function reject_entry_update();
    `);
    const response = await app.inject({
      method: "POST",
      url: "/api/campaign/clock",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        command: "ADVANCE_DAY",
        revision: 0,
      },
    });
    expect(response.statusCode).toBe(409);
    const state = await database.query<{
      day: number;
      revision: number;
      messages: number;
      events: number;
    }>(
      `select day,revision,(select count(*) from chat_messages) messages,(select count(*) from game_events) events from campaigns where id='${ids.campaign}'`,
    );
    expect(state.rows[0]).toMatchObject({
      day: 1,
      revision: 0,
      messages: 0,
      events: 0,
    });
  });
});
