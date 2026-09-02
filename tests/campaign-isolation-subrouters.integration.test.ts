import { readdir, readFile } from "node:fs/promises";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpellProgressionGraph } from "@arken/contracts";
import * as schema from "../packages/db/src/schema.js";
import { registerCharacterMediaRoutes } from "../apps/server/src/character-media.js";
import { registerEncounterRoutes } from "../apps/server/src/encounters.js";
import { env } from "../apps/server/src/env.js";
import { registerPlayerRequestRoutes } from "../apps/server/src/player-requests.js";
import { hashToken } from "../apps/server/src/security.js";
import { registerSpellPackRoutes } from "../apps/server/src/spell-pack-routes.js";
import { registerWorldContentInstanceRoutes } from "../apps/server/src/world-content-instances.js";
import { registerWorldMapRoutes } from "../apps/server/src/world-map-routes.js";
import {
  SUBROUTER_CAMPAIGN_PROBE_KEYS,
  type SubrouterCampaignProbeKey,
} from "./helpers/uix413-subrouters.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;

const uuid = () => crypto.randomUUID();
const pair = () => ({ own: uuid(), foreign: uuid() });
const ids = {
  campaign: pair(),
  gm: pair(),
  player: pair(),
  character: pair(),
  characterAsset: pair(),
  mapAsset: pair(),
  scene: pair(),
  encounter: pair(),
  media: {
    patch: pair(),
    reorder: pair(),
    detach: pair(),
    delete: pair(),
  },
  request: {
    get: pair(),
    patch: pair(),
    action: pair(),
  },
  spellPack: {
    versions: pair(),
    lifecycle: pair(),
    archive: pair(),
  },
  spellPackVersion: {
    versions: pair(),
    lifecycle: pair(),
    archive: pair(),
  },
  worldContent: uuid(),
  instance: {
    get: pair(),
    patch: pair(),
    delete: pair(),
  },
  map: {
    patch: pair(),
    draftBackground: pair(),
    approveBackground: pair(),
    publish: pair(),
    archive: pair(),
    locations: pair(),
  },
  location: {
    patch: pair(),
    delete: pair(),
    link: pair(),
    unlink: pair(),
  },
};
const secrets = {
  ownGm: "g".repeat(40),
  foreignGm: "h".repeat(40),
  ownPlayer: "p".repeat(40),
  foreignPlayer: "q".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const ownGmHeaders = headers(secrets.ownGm);
const ownPlayerHeaders = headers(secrets.ownPlayer);
const executedProbeKeys = new Set<SubrouterCampaignProbeKey>();
const grid = {
  enabled: true,
  size: 64,
  offsetX: 0,
  offsetY: 0,
  color: "#ffffff",
  opacity: 0.2,
};

function spellGraph(
  packId: string,
  versionId: string,
  version = 1,
): SpellProgressionGraph {
  return {
    packId,
    versionId,
    version,
    title: "Campaign isolation spell pack",
    lifecycle: "DRAFT",
    provenance: {
      sourceType: "GM_AUTHORED",
      sourceLabel: "UIX-580 tenant probe",
      rawSourceText: "Tenant probe source",
    },
    schools: [],
    nodes: [],
    requirementGroups: [],
    edges: [],
  };
}

async function spellVersions(campaignId: string, packId: string) {
  return db
    .select()
    .from(schema.spellPackVersions)
    .where(
      and(
        eq(schema.spellPackVersions.campaignId, campaignId),
        eq(schema.spellPackVersions.packId, packId),
      ),
    );
}

type ProbeRequest = {
  method: "GET" | "PATCH" | "POST" | "DELETE";
  url: string;
  headers: Record<string, string>;
  payload?: Record<string, unknown>;
};

async function expectForeignNotFound(
  key: SubrouterCampaignProbeKey,
  request: ProbeRequest,
  error: string,
) {
  executedProbeKeys.add(key);
  const response = await app.inject(request);
  expect(response.statusCode, key).toBe(404);
  expect(response.json(), key).toEqual({ error });
}

async function rowById<
  TTable extends
    | typeof schema.characterMedia
    | typeof schema.encounters
    | typeof schema.playerRequests
    | typeof schema.worldContentInstances
    | typeof schema.worldMaps
    | typeof schema.worldMapLocations,
>(table: TTable, id: string) {
  const [row] = await db
    .select()
    .from(table as never)
    .where(eq(table.id, id))
    .limit(1);
  return row;
}

beforeAll(async () => {
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
    { id: ids.campaign.own, name: "Own campaign" },
    { id: ids.campaign.foreign, name: "Foreign campaign" },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.gm.own,
      campaignId: ids.campaign.own,
      role: "GM",
      displayName: "Own GM",
    },
    {
      id: ids.gm.foreign,
      campaignId: ids.campaign.foreign,
      role: "GM",
      displayName: "Foreign GM",
    },
    {
      id: ids.player.own,
      campaignId: ids.campaign.own,
      role: "PLAYER",
      displayName: "Own player",
    },
    {
      id: ids.player.foreign,
      campaignId: ids.campaign.foreign,
      role: "PLAYER",
      displayName: "Foreign player",
    },
  ]);
  for (const [membershipId, secret] of [
    [ids.gm.own, secrets.ownGm],
    [ids.gm.foreign, secrets.foreignGm],
    [ids.player.own, secrets.ownPlayer],
    [ids.player.foreign, secrets.foreignPlayer],
  ] as const)
    await db.insert(schema.sessions).values({
      membershipId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + 600_000),
    });

  await db.insert(schema.characters).values([
    {
      id: ids.character.own,
      campaignId: ids.campaign.own,
      ownerMembershipId: ids.player.own,
      name: "Own hero",
    },
    {
      id: ids.character.foreign,
      campaignId: ids.campaign.foreign,
      ownerMembershipId: ids.player.foreign,
      name: "Foreign hero",
    },
  ]);
  await db.insert(schema.assets).values([
    {
      id: ids.characterAsset.own,
      campaignId: ids.campaign.own,
      uploadedByMembershipId: ids.gm.own,
      kind: "IMAGE",
      name: "Own portrait",
      storageKey: `own/${uuid()}`,
      mimeType: "image/png",
      sizeBytes: 1,
    },
    {
      id: ids.characterAsset.foreign,
      campaignId: ids.campaign.foreign,
      uploadedByMembershipId: ids.gm.foreign,
      kind: "IMAGE",
      name: "Foreign portrait",
      storageKey: `foreign/${uuid()}`,
      mimeType: "image/png",
      sizeBytes: 1,
    },
    {
      id: ids.mapAsset.own,
      campaignId: ids.campaign.own,
      uploadedByMembershipId: ids.gm.own,
      kind: "MAP",
      name: "Own map",
      storageKey: `own/${uuid()}`,
      mimeType: "image/webp",
      sizeBytes: 1,
    },
    {
      id: ids.mapAsset.foreign,
      campaignId: ids.campaign.foreign,
      uploadedByMembershipId: ids.gm.foreign,
      kind: "MAP",
      name: "Foreign map",
      storageKey: `foreign/${uuid()}`,
      mimeType: "image/webp",
      sizeBytes: 1,
    },
  ]);

  const mediaRows = Object.entries(ids.media).flatMap(
    ([operation, mediaIds], index) => [
      {
        id: mediaIds.own,
        campaignId: ids.campaign.own,
        characterId: ids.character.own,
        assetId: ids.characterAsset.own,
        category: "CHARACTER_ART" as const,
        caption: `Own ${operation}`,
        ordering: index,
        visibility: "GM_ONLY" as const,
        uploadedByMembershipId: ids.gm.own,
      },
      {
        id: mediaIds.foreign,
        campaignId: ids.campaign.foreign,
        characterId: ids.character.foreign,
        assetId: ids.characterAsset.foreign,
        category: "CHARACTER_ART" as const,
        caption: `Foreign ${operation}`,
        ordering: index,
        visibility: "GM_ONLY" as const,
        uploadedByMembershipId: ids.gm.foreign,
      },
    ],
  );
  await db.insert(schema.characterMedia).values(mediaRows);

  await db.insert(schema.scenes).values([
    {
      id: ids.scene.own,
      campaignId: ids.campaign.own,
      name: "Own scene",
      grid,
    },
    {
      id: ids.scene.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign scene",
      grid,
    },
  ]);
  await db.insert(schema.encounters).values([
    {
      id: ids.encounter.own,
      campaignId: ids.campaign.own,
      mode: "SCENE_REGION",
      sourceSceneId: ids.scene.own,
      targetSceneId: ids.scene.own,
      focusRegion: { x: 0, y: 0, width: 100, height: 100 },
      sourceSceneRevision: 0,
      initiatorMembershipId: ids.gm.own,
    },
    {
      id: ids.encounter.foreign,
      campaignId: ids.campaign.foreign,
      mode: "SCENE_REGION",
      sourceSceneId: ids.scene.foreign,
      targetSceneId: ids.scene.foreign,
      focusRegion: { x: 0, y: 0, width: 100, height: 100 },
      sourceSceneRevision: 0,
      initiatorMembershipId: ids.gm.foreign,
    },
  ]);

  const requestRows = Object.entries(ids.request).flatMap(
    ([operation, requestIds]) => [
      {
        id: requestIds.own,
        campaignId: ids.campaign.own,
        authorMembershipId: ids.player.own,
        audience: "PUBLIC" as const,
        horizon: "NOW" as const,
        title: `Own ${operation}`,
        body: "Own request body",
      },
      {
        id: requestIds.foreign,
        campaignId: ids.campaign.foreign,
        authorMembershipId: ids.player.foreign,
        audience: "PUBLIC" as const,
        horizon: "NOW" as const,
        title: `Foreign ${operation}`,
        body: "Foreign request body",
      },
    ],
  );
  await db.insert(schema.playerRequests).values(requestRows);

  await db.insert(schema.worldContent).values({
    id: ids.worldContent,
    slug: "uix-413-probe",
    type: "MONSTER",
    name: "Campaign isolation probe",
    lifecycle: "PUBLISHED",
  });
  const instanceRows = Object.entries(ids.instance).flatMap(
    ([operation, instanceIds]) => [
      {
        id: instanceIds.own,
        campaignId: ids.campaign.own,
        worldContentId: ids.worldContent,
        currentState: `Own ${operation}`,
      },
      {
        id: instanceIds.foreign,
        campaignId: ids.campaign.foreign,
        worldContentId: ids.worldContent,
        currentState: `Foreign ${operation}`,
      },
    ],
  );
  await db.insert(schema.worldContentInstances).values(instanceRows);

  const approvedAt = new Date("2026-08-30T12:00:00.000Z");
  await db.insert(schema.worldMaps).values([
    {
      id: ids.map.patch.own,
      campaignId: ids.campaign.own,
      name: "Own patch map",
    },
    {
      id: ids.map.patch.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign patch map",
    },
    {
      id: ids.map.draftBackground.own,
      campaignId: ids.campaign.own,
      name: "Own draft background map",
    },
    {
      id: ids.map.draftBackground.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign draft background map",
    },
    {
      id: ids.map.approveBackground.own,
      campaignId: ids.campaign.own,
      name: "Own approve background map",
      backgroundAssetId: ids.mapAsset.own,
    },
    {
      id: ids.map.approveBackground.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign approve background map",
      backgroundAssetId: ids.mapAsset.foreign,
    },
    {
      id: ids.map.publish.own,
      campaignId: ids.campaign.own,
      name: "Own publish map",
      backgroundAssetId: ids.mapAsset.own,
      backgroundAssetApprovedByMembershipId: ids.gm.own,
      backgroundAssetApprovedAt: approvedAt,
    },
    {
      id: ids.map.publish.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign publish map",
      backgroundAssetId: ids.mapAsset.foreign,
      backgroundAssetApprovedByMembershipId: ids.gm.foreign,
      backgroundAssetApprovedAt: approvedAt,
    },
    {
      id: ids.map.archive.own,
      campaignId: ids.campaign.own,
      name: "Own archive map",
    },
    {
      id: ids.map.archive.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign archive map",
    },
    {
      id: ids.map.locations.own,
      campaignId: ids.campaign.own,
      name: "Own locations map",
    },
    {
      id: ids.map.locations.foreign,
      campaignId: ids.campaign.foreign,
      name: "Foreign locations map",
    },
  ]);
  const locationRows = Object.entries(ids.location).flatMap(
    ([operation, locationIds], index) => [
      {
        id: locationIds.own,
        campaignId: ids.campaign.own,
        mapId: ids.map.locations.own,
        name: `Own ${operation} location`,
        x: 0.1 + index * 0.1,
        y: 0.2,
      },
      {
        id: locationIds.foreign,
        campaignId: ids.campaign.foreign,
        mapId: ids.map.locations.foreign,
        name: `Foreign ${operation} location`,
        x: 0.1 + index * 0.1,
        y: 0.8,
      },
    ],
  );
  await db.insert(schema.worldMapLocations).values(locationRows);
  await db.insert(schema.worldMapLocationScenes).values([
    {
      campaignId: ids.campaign.own,
      locationId: ids.location.unlink.own,
      sceneId: ids.scene.own,
    },
    {
      campaignId: ids.campaign.foreign,
      locationId: ids.location.unlink.foreign,
      sceneId: ids.scene.foreign,
    },
  ]);

  const spellPackRows = Object.values(ids.spellPack).flatMap((packIds) => [
    { id: packIds.own, campaignId: ids.campaign.own },
    { id: packIds.foreign, campaignId: ids.campaign.foreign },
  ]);
  await db.insert(schema.spellPacks).values(spellPackRows);
  const spellVersionRows = Object.entries(ids.spellPack).flatMap(
    ([operation, packIds]) => {
      const versionIds =
        ids.spellPackVersion[operation as keyof typeof ids.spellPackVersion];
      return [
        {
          id: versionIds.own,
          campaignId: ids.campaign.own,
          packId: packIds.own,
          version: 1,
          lifecycle: "DRAFT" as const,
          graph: spellGraph(packIds.own, versionIds.own),
        },
        {
          id: versionIds.foreign,
          campaignId: ids.campaign.foreign,
          packId: packIds.foreign,
          version: 1,
          lifecycle: "DRAFT" as const,
          graph: spellGraph(packIds.foreign, versionIds.foreign),
        },
      ];
    },
  );
  await db.insert(schema.spellPackVersions).values(spellVersionRows);

  app = Fastify();
  await app.register(cookie);
  registerCharacterMediaRoutes(app, db as never);
  registerEncounterRoutes(app, db as never, async () => {});
  registerPlayerRequestRoutes(app, db as never);
  registerSpellPackRoutes(app, db as never);
  registerWorldContentInstanceRoutes(app, db as never);
  registerWorldMapRoutes(app, db as never, async () => {});
  await app.ready();
}, 30_000);

afterAll(async () => {
  expect([...executedProbeKeys].sort()).toEqual(
    [...SUBROUTER_CAMPAIGN_PROBE_KEYS].sort(),
  );
  await app.close();
  await database.close();
});

describe("UIX-413 campaign isolation: character media sub-router", () => {
  const cases = [
    {
      key: "PATCH /api/character-media/:id" as const,
      ids: ids.media.patch,
      method: "PATCH" as const,
      suffix: "",
      success: 200,
      payload: () => ({ actionId: uuid(), revision: 0, caption: "Updated" }),
    },
    {
      key: "POST /api/character-media/:id/reorder" as const,
      ids: ids.media.reorder,
      method: "POST" as const,
      suffix: "/reorder",
      success: 200,
      payload: () => ({ actionId: uuid(), revision: 0, ordering: 30 }),
    },
    {
      key: "POST /api/character-media/:id/detach" as const,
      ids: ids.media.detach,
      method: "POST" as const,
      suffix: "/detach",
      success: 200,
      payload: () => ({ actionId: uuid(), revision: 0 }),
    },
    {
      key: "DELETE /api/character-media/:id" as const,
      ids: ids.media.delete,
      method: "DELETE" as const,
      suffix: "",
      success: 204,
      payload: () => ({ actionId: uuid(), revision: 0 }),
    },
  ];

  it.each(cases)("rejects a foreign target for $key", async (probe) => {
    const ownResponse = await app.inject({
      method: probe.method,
      url: `/api/character-media/${probe.ids.own}${probe.suffix}`,
      headers: ownGmHeaders,
      payload: probe.payload(),
    });
    expect(ownResponse.statusCode, `${probe.key} own control`).toBe(
      probe.success,
    );

    const foreignBefore = await rowById(
      schema.characterMedia,
      probe.ids.foreign,
    );
    await expectForeignNotFound(
      probe.key,
      {
        method: probe.method,
        url: `/api/character-media/${probe.ids.foreign}${probe.suffix}`,
        headers: ownGmHeaders,
        payload: probe.payload(),
      },
      "CHARACTER_MEDIA_NOT_FOUND",
    );
    expect(await rowById(schema.characterMedia, probe.ids.foreign)).toEqual(
      foreignBefore,
    );
  });
});

describe("UIX-413 campaign isolation: encounter sub-router", () => {
  it("ends an own encounter but rejects a foreign encounter", async () => {
    const foreignBefore = await rowById(
      schema.encounters,
      ids.encounter.foreign,
    );
    await expectForeignNotFound(
      "POST /api/encounters/:id/end",
      {
        method: "POST",
        url: `/api/encounters/${ids.encounter.foreign}/end`,
        headers: ownGmHeaders,
        payload: { actionId: uuid(), revision: 0 },
      },
      "ENCOUNTER_NOT_FOUND",
    );
    expect(await rowById(schema.encounters, ids.encounter.foreign)).toEqual(
      foreignBefore,
    );

    const ownResponse = await app.inject({
      method: "POST",
      url: `/api/encounters/${ids.encounter.own}/end`,
      headers: ownGmHeaders,
      payload: { actionId: uuid(), revision: 0 },
    });
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json()).toMatchObject({
      id: ids.encounter.own,
      status: "ENDED",
      revision: 1,
    });
  });
});

describe("UIX-413 campaign isolation: player request sub-router", () => {
  it("GET reaches an own public request and hides a foreign public request", async () => {
    const ownResponse = await app.inject({
      method: "GET",
      url: `/api/player-requests/${ids.request.get.own}`,
      headers: ownGmHeaders,
    });
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json().id).toBe(ids.request.get.own);
    await expectForeignNotFound(
      "GET /api/player-requests/:id",
      {
        method: "GET",
        url: `/api/player-requests/${ids.request.get.foreign}`,
        headers: ownGmHeaders,
      },
      "NOT_FOUND",
    );
  });

  it("PATCH updates an own request but leaves a foreign request unchanged", async () => {
    const ownResponse = await app.inject({
      method: "PATCH",
      url: `/api/player-requests/${ids.request.patch.own}`,
      headers: ownPlayerHeaders,
      payload: {
        actionId: uuid(),
        revision: 0,
        title: "Updated own request",
        body: "Updated own request body",
      },
    });
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json()).toMatchObject({
      id: ids.request.patch.own,
      title: "Updated own request",
      revision: 1,
    });

    const foreignBefore = await rowById(
      schema.playerRequests,
      ids.request.patch.foreign,
    );
    await expectForeignNotFound(
      "PATCH /api/player-requests/:id",
      {
        method: "PATCH",
        url: `/api/player-requests/${ids.request.patch.foreign}`,
        headers: ownPlayerHeaders,
        payload: {
          actionId: uuid(),
          revision: 0,
          title: "Forged update",
          body: "Must not be written",
        },
      },
      "NOT_FOUND",
    );
    expect(
      await rowById(schema.playerRequests, ids.request.patch.foreign),
    ).toEqual(foreignBefore);
  });

  it("actions transition an own request but leave a foreign request unchanged", async () => {
    const ownResponse = await app.inject({
      method: "POST",
      url: `/api/player-requests/${ids.request.action.own}/actions`,
      headers: ownGmHeaders,
      payload: { actionId: uuid(), revision: 0, action: "ACKNOWLEDGE" },
    });
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json()).toMatchObject({
      id: ids.request.action.own,
      status: "ACKNOWLEDGED",
      revision: 1,
    });

    const foreignBefore = await rowById(
      schema.playerRequests,
      ids.request.action.foreign,
    );
    await expectForeignNotFound(
      "POST /api/player-requests/:id/actions",
      {
        method: "POST",
        url: `/api/player-requests/${ids.request.action.foreign}/actions`,
        headers: ownGmHeaders,
        payload: { actionId: uuid(), revision: 0, action: "ACKNOWLEDGE" },
      },
      "NOT_FOUND",
    );
    expect(
      await rowById(schema.playerRequests, ids.request.action.foreign),
    ).toEqual(foreignBefore);
  });
});

describe("UIX-413 campaign isolation: world content instance sub-router", () => {
  it("GET reaches an own instance and hides a foreign instance", async () => {
    const ownResponse = await app.inject({
      method: "GET",
      url: `/api/world-content-instances/${ids.instance.get.own}`,
      headers: ownGmHeaders,
    });
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json().id).toBe(ids.instance.get.own);
    await expectForeignNotFound(
      "GET /api/world-content-instances/:id",
      {
        method: "GET",
        url: `/api/world-content-instances/${ids.instance.get.foreign}`,
        headers: ownGmHeaders,
      },
      "WORLD_CONTENT_INSTANCE_NOT_FOUND",
    );
  });

  it("PATCH updates an own instance but leaves a foreign instance unchanged", async () => {
    const ownResponse = await app.inject({
      method: "PATCH",
      url: `/api/world-content-instances/${ids.instance.patch.own}`,
      headers: ownGmHeaders,
      payload: {
        actionId: uuid(),
        revision: 0,
        currentState: "Own updated state",
      },
    });
    expect(ownResponse.statusCode).toBe(200);
    expect(ownResponse.json()).toMatchObject({
      id: ids.instance.patch.own,
      currentState: "Own updated state",
      revision: 1,
    });

    const foreignBefore = await rowById(
      schema.worldContentInstances,
      ids.instance.patch.foreign,
    );
    await expectForeignNotFound(
      "PATCH /api/world-content-instances/:id",
      {
        method: "PATCH",
        url: `/api/world-content-instances/${ids.instance.patch.foreign}`,
        headers: ownGmHeaders,
        payload: {
          actionId: uuid(),
          revision: 0,
          currentState: "Forged state",
        },
      },
      "WORLD_CONTENT_INSTANCE_NOT_FOUND",
    );
    expect(
      await rowById(schema.worldContentInstances, ids.instance.patch.foreign),
    ).toEqual(foreignBefore);
  });

  it("DELETE removes an own instance but leaves a foreign instance unchanged", async () => {
    const ownResponse = await app.inject({
      method: "DELETE",
      url: `/api/world-content-instances/${ids.instance.delete.own}`,
      headers: ownGmHeaders,
      payload: { actionId: uuid(), revision: 0 },
    });
    expect(ownResponse.statusCode).toBe(204);
    expect(
      await rowById(schema.worldContentInstances, ids.instance.delete.own),
    ).toBeUndefined();

    const foreignBefore = await rowById(
      schema.worldContentInstances,
      ids.instance.delete.foreign,
    );
    await expectForeignNotFound(
      "DELETE /api/world-content-instances/:id",
      {
        method: "DELETE",
        url: `/api/world-content-instances/${ids.instance.delete.foreign}`,
        headers: ownGmHeaders,
        payload: { actionId: uuid(), revision: 0 },
      },
      "WORLD_CONTENT_INSTANCE_NOT_FOUND",
    );
    expect(
      await rowById(schema.worldContentInstances, ids.instance.delete.foreign),
    ).toEqual(foreignBefore);
  });
});

describe("UIX-413 campaign isolation: world map sub-router", () => {
  const mapCases = [
    {
      key: "PATCH /api/world-maps/:id" as const,
      ids: ids.map.patch,
      method: "PATCH" as const,
      suffix: "",
      payload: () => ({ actionId: uuid(), revision: 0, name: "Updated map" }),
      verifyOwn: (body: Record<string, unknown>) => {
        expect(body).toMatchObject({ name: "Updated map", revision: 1 });
      },
    },
    {
      key: "POST /api/world-maps/:id/draft-background" as const,
      ids: ids.map.draftBackground,
      method: "POST" as const,
      suffix: "/draft-background",
      payload: () => ({
        actionId: uuid(),
        revision: 0,
        backgroundAssetId: ids.mapAsset.own,
      }),
      verifyOwn: (body: Record<string, unknown>) => {
        expect(body).toMatchObject({
          backgroundAssetId: ids.mapAsset.own,
          revision: 1,
        });
      },
    },
    {
      key: "POST /api/world-maps/:id/approve-background" as const,
      ids: ids.map.approveBackground,
      method: "POST" as const,
      suffix: "/approve-background",
      payload: () => ({ actionId: uuid(), revision: 0 }),
      verifyOwn: (body: Record<string, unknown>) => {
        expect(body).toMatchObject({ revision: 1 });
      },
    },
    {
      key: "POST /api/world-maps/:id/publish" as const,
      ids: ids.map.publish,
      method: "POST" as const,
      suffix: "/publish",
      payload: () => ({ actionId: uuid(), revision: 0 }),
      verifyOwn: (body: Record<string, unknown>) => {
        expect(body).toMatchObject({ lifecycle: "PUBLISHED", revision: 1 });
      },
    },
    {
      key: "POST /api/world-maps/:id/archive" as const,
      ids: ids.map.archive,
      method: "POST" as const,
      suffix: "/archive",
      payload: () => ({ actionId: uuid(), revision: 0 }),
      verifyOwn: (body: Record<string, unknown>) => {
        expect(body).toMatchObject({ lifecycle: "ARCHIVED", revision: 1 });
      },
    },
  ];

  it.each(mapCases)("rejects a foreign target for $key", async (probe) => {
    const ownResponse = await app.inject({
      method: probe.method,
      url: `/api/world-maps/${probe.ids.own}${probe.suffix}`,
      headers: ownGmHeaders,
      payload: probe.payload(),
    });
    expect(ownResponse.statusCode, `${probe.key} own control`).toBe(200);
    probe.verifyOwn(ownResponse.json());

    const foreignBefore = await rowById(schema.worldMaps, probe.ids.foreign);
    await expectForeignNotFound(
      probe.key,
      {
        method: probe.method,
        url: `/api/world-maps/${probe.ids.foreign}${probe.suffix}`,
        headers: ownGmHeaders,
        payload: probe.payload(),
      },
      "WORLD_MAP_NOT_FOUND",
    );
    expect(await rowById(schema.worldMaps, probe.ids.foreign)).toEqual(
      foreignBefore,
    );
  });

  const locationCases = [
    {
      key: "PATCH /api/world-maps/locations/:id" as const,
      ids: ids.location.patch,
      method: "PATCH" as const,
      payload: () => ({
        actionId: uuid(),
        revision: 0,
        name: "Updated own location",
      }),
      success: 200,
    },
    {
      key: "DELETE /api/world-maps/locations/:id" as const,
      ids: ids.location.delete,
      method: "DELETE" as const,
      payload: () => ({ actionId: uuid(), revision: 0 }),
      success: 204,
    },
  ];

  it.each(locationCases)(
    "rejects a foreign location for $key",
    async (probe) => {
      const ownResponse = await app.inject({
        method: probe.method,
        url: `/api/world-maps/locations/${probe.ids.own}`,
        headers: ownGmHeaders,
        payload: probe.payload(),
      });
      expect(ownResponse.statusCode, `${probe.key} own control`).toBe(
        probe.success,
      );

      const foreignBefore = await rowById(
        schema.worldMapLocations,
        probe.ids.foreign,
      );
      await expectForeignNotFound(
        probe.key,
        {
          method: probe.method,
          url: `/api/world-maps/locations/${probe.ids.foreign}`,
          headers: ownGmHeaders,
          payload: probe.payload(),
        },
        "WORLD_MAP_LOCATION_NOT_FOUND",
      );
      expect(
        await rowById(schema.worldMapLocations, probe.ids.foreign),
      ).toEqual(foreignBefore);
    },
  );

  it("links only an own location to an own scene", async () => {
    const key = "POST /api/world-maps/locations/:id/scenes/:sceneId" as const;
    const foreignBefore = await db
      .select()
      .from(schema.worldMapLocationScenes)
      .where(
        eq(schema.worldMapLocationScenes.locationId, ids.location.link.foreign),
      );

    await expectForeignNotFound(
      key,
      {
        method: "POST",
        url: `/api/world-maps/locations/${ids.location.link.foreign}/scenes/${ids.scene.own}`,
        headers: ownGmHeaders,
        payload: { actionId: uuid() },
      },
      "WORLD_MAP_LOCATION_NOT_FOUND",
    );
    await expectForeignNotFound(
      key,
      {
        method: "POST",
        url: `/api/world-maps/locations/${ids.location.link.own}/scenes/${ids.scene.foreign}`,
        headers: ownGmHeaders,
        payload: { actionId: uuid() },
      },
      "SCENE_NOT_FOUND",
    );
    expect(
      await db
        .select()
        .from(schema.worldMapLocationScenes)
        .where(
          eq(
            schema.worldMapLocationScenes.locationId,
            ids.location.link.foreign,
          ),
        ),
    ).toEqual(foreignBefore);

    const ownResponse = await app.inject({
      method: "POST",
      url: `/api/world-maps/locations/${ids.location.link.own}/scenes/${ids.scene.own}`,
      headers: ownGmHeaders,
      payload: { actionId: uuid() },
    });
    expect(ownResponse.statusCode).toBe(204);
    const ownLinks = await db
      .select()
      .from(schema.worldMapLocationScenes)
      .where(
        and(
          eq(schema.worldMapLocationScenes.locationId, ids.location.link.own),
          eq(schema.worldMapLocationScenes.sceneId, ids.scene.own),
        ),
      );
    expect(ownLinks).toHaveLength(1);
  });

  it("unlinks only an own location from an own scene", async () => {
    const key = "DELETE /api/world-maps/locations/:id/scenes/:sceneId" as const;
    await expectForeignNotFound(
      key,
      {
        method: "DELETE",
        url: `/api/world-maps/locations/${ids.location.unlink.foreign}/scenes/${ids.scene.own}`,
        headers: ownGmHeaders,
        payload: { actionId: uuid() },
      },
      "WORLD_MAP_LOCATION_NOT_FOUND",
    );
    await expectForeignNotFound(
      key,
      {
        method: "DELETE",
        url: `/api/world-maps/locations/${ids.location.unlink.own}/scenes/${ids.scene.foreign}`,
        headers: ownGmHeaders,
        payload: { actionId: uuid() },
      },
      "SCENE_NOT_FOUND",
    );
    const foreignLinkBefore = await db
      .select()
      .from(schema.worldMapLocationScenes)
      .where(
        and(
          eq(
            schema.worldMapLocationScenes.locationId,
            ids.location.unlink.foreign,
          ),
          eq(schema.worldMapLocationScenes.sceneId, ids.scene.foreign),
        ),
      );
    const ownLinkBefore = await db
      .select()
      .from(schema.worldMapLocationScenes)
      .where(
        and(
          eq(schema.worldMapLocationScenes.locationId, ids.location.unlink.own),
          eq(schema.worldMapLocationScenes.sceneId, ids.scene.own),
        ),
      );
    expect(foreignLinkBefore).toHaveLength(1);
    expect(ownLinkBefore).toHaveLength(1);

    const ownResponse = await app.inject({
      method: "DELETE",
      url: `/api/world-maps/locations/${ids.location.unlink.own}/scenes/${ids.scene.own}`,
      headers: ownGmHeaders,
      payload: { actionId: uuid() },
    });
    expect(ownResponse.statusCode).toBe(204);
    const ownLinkAfter = await db
      .select()
      .from(schema.worldMapLocationScenes)
      .where(
        and(
          eq(schema.worldMapLocationScenes.locationId, ids.location.unlink.own),
          eq(schema.worldMapLocationScenes.sceneId, ids.scene.own),
        ),
      );
    const foreignLinkAfter = await db
      .select()
      .from(schema.worldMapLocationScenes)
      .where(
        and(
          eq(
            schema.worldMapLocationScenes.locationId,
            ids.location.unlink.foreign,
          ),
          eq(schema.worldMapLocationScenes.sceneId, ids.scene.foreign),
        ),
      );
    expect(ownLinkAfter).toHaveLength(0);
    expect(foreignLinkAfter).toEqual(foreignLinkBefore);
  });
});

describe("UIX-580 campaign isolation: spell-pack sub-router", () => {
  const cases = [
    {
      key: "POST /api/spell-packs/:id/versions" as const,
      packIds: ids.spellPack.versions,
      suffix: "/versions",
      payload: (packId: string) => ({
        actionId: uuid(),
        expectedVersion: 1,
        graph: spellGraph(packId, uuid(), 2),
      }),
      lifecycle: "DRAFT",
    },
    {
      key: "POST /api/spell-packs/:id/lifecycle" as const,
      packIds: ids.spellPack.lifecycle,
      suffix: "/lifecycle",
      payload: () => ({
        actionId: uuid(),
        expectedVersion: 1,
        versionId: uuid(),
        lifecycle: "ACTIVE",
      }),
      lifecycle: "ACTIVE",
    },
    {
      key: "POST /api/spell-packs/:id/archive" as const,
      packIds: ids.spellPack.archive,
      suffix: "/archive",
      payload: () => ({
        actionId: uuid(),
        expectedVersion: 1,
        versionId: uuid(),
      }),
      lifecycle: "ARCHIVED",
    },
  ];

  it.each(cases)("rejects a foreign target for $key", async (probe) => {
    const foreignBefore = await spellVersions(
      ids.campaign.foreign,
      probe.packIds.foreign,
    );
    await expectForeignNotFound(
      probe.key,
      {
        method: "POST",
        url: `/api/spell-packs/${probe.packIds.foreign}${probe.suffix}`,
        headers: ownGmHeaders,
        payload: probe.payload(probe.packIds.foreign),
      },
      "SPELL_PACK_NOT_FOUND",
    );
    expect(
      await spellVersions(ids.campaign.foreign, probe.packIds.foreign),
    ).toEqual(foreignBefore);

    const ownResponse = await app.inject({
      method: "POST",
      url: `/api/spell-packs/${probe.packIds.own}${probe.suffix}`,
      headers: ownGmHeaders,
      payload: probe.payload(probe.packIds.own),
    });
    expect(ownResponse.statusCode, `${probe.key} own control`).toBe(201);
    expect(ownResponse.json(), `${probe.key} own control`).toMatchObject({
      packId: probe.packIds.own,
      version: 2,
      lifecycle: probe.lifecycle,
    });
  });
});
