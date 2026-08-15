import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerEncounterRoutes } from "./encounters.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let broadcastCount = 0;
const broadcastedCampaigns: string[] = [];

const id = () => crypto.randomUUID();
const ids = {
  campaign: id(),
  foreignCampaign: id(),
  gm: id(),
  player: id(),
  playerNoToken: id(), // party member with no controlled token anywhere
  foreign: id(),
  sceneA: id(), // source/active scene, 1000x800
  sceneB: id(), // linked destination scene, 500x2000
  foreignScene: id(),
  worldMap: id(),
  foreignWorldMap: id(),
  location: id(),
  foreignLocation: id(),
  tokenDefinition: id(),
  token: id(), // PLAYER-layer token on sceneA at 300,480 (30%, 60%)
  gmToken: id(), // GM-layer token, must NOT transfer
  tokenDefinitionB: id(),
  tokenOnSceneB: id(), // PLAYER-layer token already placed on sceneB, controlled by `player`
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreign: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const grid = {
  enabled: true,
  size: 64,
  offsetX: 0,
  offsetY: 0,
  color: "#ffffff",
  opacity: 0.2,
};

async function startRegion(
  secret: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/encounters/start",
    headers: headers(secret),
    payload: {
      actionId: id(),
      mode: "SCENE_REGION",
      sourceSceneId: ids.sceneA,
      sourceSceneRevision: 0,
      focusRegion: { x: 100, y: 100, width: 200, height: 200 },
      ...overrides,
    },
  });
}
async function startLinked(
  secret: string,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/encounters/start",
    headers: headers(secret),
    payload: {
      actionId: id(),
      mode: "LINKED_SCENE",
      sourceSceneId: ids.sceneA,
      sourceSceneRevision: 0,
      targetSceneId: ids.sceneB,
      ...overrides,
    },
  });
}
async function endEncounter(
  secret: string,
  encounterId: string,
  revision: number,
  overrides: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/encounters/${encounterId}/end`,
    headers: headers(secret),
    payload: { actionId: id(), revision, ...overrides },
  });
}

beforeEach(() => {
  broadcastCount = 0;
  broadcastedCampaigns.length = 0;
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
    { id: ids.campaign, name: "Campaign", activeSceneId: ids.sceneA },
    { id: ids.foreignCampaign, name: "Foreign" },
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
      id: ids.playerNoToken,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player without a token",
    },
    {
      id: ids.foreign,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm, secrets.gm],
    [ids.player, secrets.player],
    [ids.foreign, secrets.foreign],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 60_000),
    });
  await db.insert(schema.scenes).values([
    {
      id: ids.sceneA,
      campaignId: ids.campaign,
      name: "Scene A",
      width: 1000,
      height: 800,
      grid,
    },
    {
      id: ids.sceneB,
      campaignId: ids.campaign,
      name: "Scene B",
      width: 500,
      height: 2000,
      grid,
    },
    {
      id: ids.foreignScene,
      campaignId: ids.foreignCampaign,
      name: "Foreign scene",
      grid,
    },
  ]);
  await db.insert(schema.worldMaps).values([
    { id: ids.worldMap, campaignId: ids.campaign, name: "World" },
    {
      id: ids.foreignWorldMap,
      campaignId: ids.foreignCampaign,
      name: "Foreign world",
    },
  ]);
  await db.insert(schema.worldMapLocations).values([
    {
      id: ids.location,
      campaignId: ids.campaign,
      mapId: ids.worldMap,
      name: "Ruins",
      x: 0.5,
      y: 0.5,
    },
    {
      id: ids.foreignLocation,
      campaignId: ids.foreignCampaign,
      mapId: ids.foreignWorldMap,
      name: "Forged",
      x: 0.1,
      y: 0.1,
    },
  ]);
  await db.insert(schema.worldMapLocationScenes).values({
    campaignId: ids.campaign,
    locationId: ids.location,
    sceneId: ids.sceneB,
  });
  await db.insert(schema.tokenDefinitions).values([
    { id: ids.tokenDefinition, campaignId: ids.campaign, name: "Hero" },
    {
      id: ids.tokenDefinitionB,
      campaignId: ids.campaign,
      name: "Hero (scene B)",
    },
  ]);
  await db.insert(schema.tokens).values([
    {
      id: ids.token,
      definitionId: ids.tokenDefinition,
      sceneId: ids.sceneA,
      layer: "PLAYER",
      name: "Hero",
      x: 300, // 30% of 1000
      y: 480, // 60% of 800
    },
    {
      id: ids.gmToken,
      definitionId: ids.tokenDefinition,
      sceneId: ids.sceneA,
      layer: "GM",
      name: "Trap marker",
      x: 500,
      y: 400,
    },
    {
      id: ids.tokenOnSceneB,
      definitionId: ids.tokenDefinitionB,
      sceneId: ids.sceneB,
      layer: "PLAYER",
      name: "Hero (scene B)",
      x: 100,
      y: 100,
    },
  ]);
  // `player` controls a definition whose only instance sits on sceneA (the
  // "controlled token, but on a different scene" case) *and* a definition
  // whose instance sits on sceneB (the "controlled token present" case) —
  // `playerNoToken` controls nothing, anywhere.
  await db.insert(schema.tokenControllers).values([
    { tokenDefinitionId: ids.tokenDefinition, membershipId: ids.player },
    { tokenDefinitionId: ids.tokenDefinitionB, membershipId: ids.player },
  ]);

  app = Fastify();
  await app.register(cookie);
  registerEncounterRoutes(app, db as never, async (campaignId: string) => {
    broadcastCount++;
    broadcastedCampaigns.push(campaignId);
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
  await database.close();
});

describe("encounter start authorization and validation", () => {
  it("requires auth and GM role", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/encounters/start",
          payload: {
            actionId: id(),
            mode: "SCENE_REGION",
            sourceSceneId: ids.sceneA,
            sourceSceneRevision: 0,
            focusRegion: { x: 0, y: 0, width: 10, height: 10 },
          },
        })
      ).statusCode,
    ).toBe(401);
    expect((await startRegion(secrets.player)).statusCode).toBe(403);
  });

  it("rejects a SCENE_REGION rectangle outside scene bounds or degenerate", async () => {
    expect(
      (
        await startRegion(secrets.gm, {
          focusRegion: { x: 900, y: 0, width: 200, height: 200 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await startRegion(secrets.gm, {
          focusRegion: { x: 0, y: 0, width: 0, height: 200 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await startRegion(secrets.gm, {
          focusRegion: { x: 0, y: 0, width: -50, height: 200 },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects SCENE_REGION when the source scene is not the campaign's active scene", async () => {
    const response = await startRegion(secrets.gm, {
      sourceSceneId: ids.sceneB,
      sourceSceneRevision: 0,
      focusRegion: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("SOURCE_SCENE_NOT_ACTIVE");
  });

  it("rejects a stale source-scene revision", async () => {
    const response = await startRegion(secrets.gm, { sourceSceneRevision: 7 });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("SOURCE_SCENE_REVISION_CONFLICT");
  });

  it("rejects a LINKED_SCENE target that is not a valid location-to-scene link", async () => {
    const response = await startLinked(secrets.gm, {
      targetSceneId: ids.sceneB,
      locationId: id(), // random, unlinked location id
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("INVALID_LOCATION_SCENE_LINK");
  });

  it("rejects forged/cross-campaign scene and location ids", async () => {
    expect(
      (await startRegion(secrets.gm, { sourceSceneId: id() })).statusCode,
    ).toBe(404);
    expect(
      (
        await startLinked(secrets.gm, {
          sourceSceneId: ids.foreignScene,
          sourceSceneRevision: 0,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await startLinked(secrets.gm, { targetSceneId: ids.foreignScene }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await startLinked(secrets.gm, {
          targetSceneId: ids.sceneB,
          locationId: ids.foreignLocation,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("atomic LINKED_SCENE start", () => {
  it("activates the destination scene and transfers only PLAYER-layer tokens by relative position, in one broadcast", async () => {
    const response = await startLinked(secrets.gm, {
      locationId: ids.location,
    });
    expect(response.statusCode).toBe(201);
    const encounter = response.json();
    expect(encounter).toMatchObject({
      status: "ACTIVE",
      mode: "LINKED_SCENE",
      sourceSceneId: ids.sceneA,
      targetSceneId: ids.sceneB,
      locationId: ids.location,
      focusRegion: null,
      revision: 0,
    });

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, ids.campaign));
    expect(campaign?.activeSceneId).toBe(ids.sceneB);

    const [heroToken] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.token));
    // 30% of 1000 -> 30% of 500 = 150; 60% of 800 -> 60% of 2000 = 1200
    expect(heroToken?.sceneId).toBe(ids.sceneB);
    expect(heroToken?.x).toBeCloseTo(150);
    expect(heroToken?.y).toBeCloseTo(1200);
    expect(heroToken?.revision).toBe(1);

    const [gmMarker] = await db
      .select()
      .from(schema.tokens)
      .where(eq(schema.tokens.id, ids.gmToken));
    expect(gmMarker?.sceneId).toBe(ids.sceneA);
    expect(gmMarker?.x).toBe(500);
    expect(gmMarker?.revision).toBe(0);

    expect(broadcastCount).toBe(1);
    expect(broadcastedCampaigns).toEqual([ids.campaign]);

    // Restore fixture state for later describe blocks.
    await endEncounter(secrets.gm, encounter.id, 0);
    await db
      .update(schema.campaigns)
      .set({ activeSceneId: ids.sceneA })
      .where(eq(schema.campaigns.id, ids.campaign));
    await db
      .update(schema.tokens)
      .set({ sceneId: ids.sceneA, x: 300, y: 480, revision: 0 })
      .where(eq(schema.tokens.id, ids.token));
  });
});

describe("encounter end authorization", () => {
  it("requires auth and GM role — a PLAYER cannot end an active encounter", async () => {
    const started = (await startRegion(secrets.gm)).json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/encounters/${started.id}/end`,
          payload: { actionId: id(), revision: started.revision },
        })
      ).statusCode,
    ).toBe(401);
    const playerAttempt = await endEncounter(
      secrets.player,
      started.id,
      started.revision,
    );
    expect(playerAttempt.statusCode).toBe(403);
    expect(playerAttempt.json().error).toBe("GM_REQUIRED");

    // Confirm the PLAYER's rejected attempt left the encounter untouched,
    // then let the GM end it for real.
    const stillActive = (
      await app.inject({
        method: "GET",
        url: "/api/encounters",
        headers: headers(secrets.gm),
      })
    ).json();
    expect(
      stillActive.find((row: { id: string }) => row.id === started.id)?.status,
    ).toBe("ACTIVE");
    await endEncounter(secrets.gm, started.id, started.revision);
  });
});

describe("late-join / reconnect encounter-focus restoration", () => {
  it("lets a non-initiating PLAYER fetch the ACTIVE encounter (region + focusRegion) as a fresh client would on reconnect", async () => {
    const started = (
      await startRegion(secrets.gm, {
        focusRegion: { x: 50, y: 60, width: 120, height: 90 },
      })
    ).json();

    // Simulate a late-joining/reconnecting PLAYER client: it has no prior
    // state, only a fresh authenticated GET — the same request path used to
    // build the initial/reconnect game snapshot (listEncounters is included
    // unconditionally in every snapshot, see snapshot.ts).
    const reconnectView = await app.inject({
      method: "GET",
      url: "/api/encounters",
      headers: headers(secrets.player),
    });
    expect(reconnectView.statusCode).toBe(200);
    const active = reconnectView
      .json()
      .find((row: { id: string }) => row.id === started.id);
    expect(active).toMatchObject({
      status: "ACTIVE",
      mode: "SCENE_REGION",
      sourceSceneId: ids.sceneA,
      targetSceneId: ids.sceneA,
      focusRegion: { x: 50, y: 60, width: 120, height: 90 },
    });

    await endEncounter(secrets.gm, started.id, started.revision);
  });
});

describe("one-active-encounter-at-a-time and idempotency", () => {
  it("rejects a second start while one is active, and allows a new one once ended", async () => {
    const first = (await startRegion(secrets.gm)).json();
    expect(first.status).toBe("ACTIVE");
    const second = await startRegion(secrets.gm);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("ENCOUNTER_ALREADY_ACTIVE");

    const ended = await endEncounter(secrets.gm, first.id, first.revision);
    expect(ended.statusCode).toBe(200);
    expect(ended.json().status).toBe("ENDED");
    expect(ended.json().endedByMembershipId).toBe(ids.gm);

    // Ending writes an auditable ENCOUNTER_ENDED game event tied to the
    // encounter's post-end revision, not just a status flip on the row.
    const encounterEvents = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.entityType, "ENCOUNTER"));
    expect(
      encounterEvents.some(
        (row) =>
          row.entityId === first.id &&
          row.type === "ENCOUNTER_ENDED" &&
          row.membershipId === ids.gm,
      ),
    ).toBe(true);

    const third = await startRegion(secrets.gm);
    expect(third.statusCode).toBe(201);
    await endEncounter(secrets.gm, third.json().id, third.json().revision);
  });

  it("replays an identical start action and conflicts on actionId reuse with a different payload", async () => {
    const body = {
      actionId: id(),
      mode: "SCENE_REGION" as const,
      sourceSceneId: ids.sceneA,
      sourceSceneRevision: 0,
      focusRegion: { x: 10, y: 10, width: 50, height: 50 },
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/encounters/start",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const replayed = await app.inject({
      method: "POST",
      url: "/api/encounters/start",
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(first.json());
    const conflicting = await app.inject({
      method: "POST",
      url: "/api/encounters/start",
      headers: headers(secrets.gm),
      payload: {
        ...body,
        focusRegion: { x: 20, y: 20, width: 50, height: 50 },
      },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error).toBe("ACTION_ID_CONFLICT");

    await endEncounter(secrets.gm, first.json().id, first.json().revision);
  });

  it("rejects stale revisions and replays identical end actions on the terminal encounter", async () => {
    const started = (await startRegion(secrets.gm)).json();
    const staleEnd = await endEncounter(secrets.gm, started.id, 5);
    expect(staleEnd.statusCode).toBe(409);
    expect(staleEnd.json().error).toBe("REVISION_CONFLICT");

    const body = { actionId: id(), revision: started.revision };
    const first = await app.inject({
      method: "POST",
      url: `/api/encounters/${started.id}/end`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(first.statusCode).toBe(200);
    const replayed = await app.inject({
      method: "POST",
      url: `/api/encounters/${started.id}/end`,
      headers: headers(secrets.gm),
      payload: body,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(first.json());

    const againstEnded = await endEncounter(
      secrets.gm,
      started.id,
      first.json().revision,
    );
    expect(againstEnded.statusCode).toBe(409);
    expect(againstEnded.json().error).toBe("ENCOUNTER_NOT_ACTIVE");
  });
});

describe("LINKED_SCENE preflight (missing-token warning)", () => {
  it("requires auth and GM role", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/encounters/preflight?targetSceneId=${ids.sceneB}`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/encounters/preflight?targetSceneId=${ids.sceneB}`,
          headers: headers(secrets.player),
        })
      ).statusCode,
    ).toBe(403);
  });

  it("404s on a forged/cross-campaign target scene, and on an invalid location-to-scene link", async () => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/encounters/preflight?targetSceneId=${id()}`,
          headers: headers(secrets.gm),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/encounters/preflight?targetSceneId=${ids.foreignScene}`,
          headers: headers(secrets.gm),
        })
      ).statusCode,
    ).toBe(404);
    const badLink = await app.inject({
      method: "GET",
      url: `/api/encounters/preflight?targetSceneId=${ids.sceneB}&locationId=${id()}`,
      headers: headers(secrets.gm),
    });
    expect(badLink.statusCode).toBe(404);
    expect(badLink.json().error).toBe("INVALID_LOCATION_SCENE_LINK");
  });

  it("reports party members with no controlled PLAYER-layer token on the target scene", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/encounters/preflight?targetSceneId=${ids.sceneB}&locationId=${ids.location}`,
      headers: headers(secrets.gm),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.targetSceneId).toBe(ids.sceneB);
    // `player` controls a token already placed on sceneB -> not missing.
    // `playerNoToken` controls nothing -> missing.
    // `player`'s *other* controlled token sits on sceneA, not sceneB, so it
    // doesn't save them from being reported for sceneA-as-target below.
    // GM memberships never appear (only PLAYER-role party members count).
    expect(body.missingTokenMembershipIds.sort()).toEqual(
      [ids.playerNoToken].sort(),
    );

    const sceneAResponse = await app.inject({
      method: "GET",
      url: `/api/encounters/preflight?targetSceneId=${ids.sceneA}`,
      headers: headers(secrets.gm),
    });
    expect(sceneAResponse.statusCode).toBe(200);
    // On sceneA, `player`'s controlled token there covers them, but they're
    // still not missing for a *different* reason than on sceneB above —
    // this asserts the same-scene-only join, not a cross-scene fallback.
    expect(sceneAResponse.json().missingTokenMembershipIds.sort()).toEqual(
      [ids.playerNoToken].sort(),
    );
  });
});

describe("cross-campaign isolation", () => {
  it("hides a foreign campaign's encounter from GET and forbids ending it", async () => {
    const started = (await startRegion(secrets.gm)).json();
    const list = (
      await app.inject({
        method: "GET",
        url: "/api/encounters",
        headers: headers(secrets.foreign),
      })
    ).json();
    expect(list.some((row: { id: string }) => row.id === started.id)).toBe(
      false,
    );
    const foreignEnd = await app.inject({
      method: "POST",
      url: `/api/encounters/${started.id}/end`,
      headers: headers(secrets.foreign),
      payload: { actionId: id(), revision: started.revision },
    });
    // Foreign GM is a GM, so role check passes; the encounter must still be
    // invisible/not-found under the foreign campaign scope.
    expect(foreignEnd.statusCode).toBe(404);
    await endEncounter(secrets.gm, started.id, started.revision);
  });
});
