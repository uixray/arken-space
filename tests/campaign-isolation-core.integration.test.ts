import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { PGlite } from "@electric-sql/pglite";
import Fastify, { type FastifyInstance } from "fastify";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { env } from "../apps/server/src/env.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { hashToken } from "../apps/server/src/security.js";
import {
  CORE_CAMPAIGN_PROBE_KEYS,
  type CoreCampaignProbeKey,
} from "./helpers/uix413-core.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ProbeRequest = {
  method: Method;
  url: string;
  payload?: object | Buffer;
  headers?: Record<string, string>;
};
type Probe = {
  key: CoreCampaignProbeKey;
  request: () => ProbeRequest;
  status: 403 | 404;
  error: string;
  /** Доказывает, что payload/query/file валидны там, где 404 идёт до их чтения. */
  control?: () => Promise<void>;
};

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let mediaRoot: string;

const originalMediaRoot = env.MEDIA_ROOT;
const originalMinFreeDiskBytes = env.MIN_FREE_DISK_BYTES;
const originalMediaQuotaBytes = env.MEDIA_QUOTA_BYTES;

const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignPlayer: crypto.randomUUID(),
  character: crypto.randomUUID(),
  foreignCharacter: crypto.randomUUID(),
  foreignArchivedCharacter: crypto.randomUUID(),
  catalog: crypto.randomUUID(),
  foreignCatalog: crypto.randomUUID(),
  foreignCharacterEntry: crypto.randomUUID(),
  foreignPlayerAccess: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  foreignScene: crypto.randomUUID(),
  definition: crypto.randomUUID(),
  foreignDefinition: crypto.randomUUID(),
  token: crypto.randomUUID(),
  foreignToken: crypto.randomUUID(),
  foreignDrawing: crypto.randomUUID(),
  asset: crypto.randomUUID(),
  foreignAsset: crypto.randomUUID(),
  ownActivePack: crypto.randomUUID(),
  ownDraftPack: crypto.randomUUID(),
  foreignActivePack: crypto.randomUUID(),
  foreignDraftPack: crypto.randomUUID(),
  foreignPlayerPack: crypto.randomUUID(),
  ownPlayerPack: crypto.randomUUID(),
  invalidCrossCampaignPlayerPack: crypto.randomUUID(),
  ownStickerMedia: crypto.randomUUID(),
  foreignStickerMedia: crypto.randomUUID(),
  ownSticker: crypto.randomUUID(),
  foreignSticker: crypto.randomUUID(),
  replayAction: crypto.randomUUID(),
  replayOwnDefinitionAction: crypto.randomUUID(),
  replayHybridAction: crypto.randomUUID(),
  hybridToken: crypto.randomUUID(),
};

const gmSecret = "uix413-gm-session-token".padEnd(40, "g");
const playerSecret = "uix413-player-session-token".padEnd(40, "p");
const headers = (extra: Record<string, string> = {}) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${gmSecret}`,
  ...extra,
});
const playerHeaders = () => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${playerSecret}`,
});
const actionId = () => crypto.randomUUID();
const revisionBody = () => ({ actionId: actionId(), revision: 0 });

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function multipartImage() {
  const boundary = `arken-uix413-${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    tinyPng,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

const stickerUploadUrl = (packId: string) => {
  const query = new URLSearchParams({
    name: "Изоляционный probe",
    altText: "Тестовый стикер",
    provenanceType: "ORIGINAL",
  });
  return `/api/sticker-packs/${packId}/stickers?${query}`;
};

/**
 * Снимок берётся шире foreign-строки: если забытый predicate создаст локальный
 * event/journal/media вместо прямой правки чужой строки, это тоже мутация и
 * probe обязан её увидеть. Сессии исключены как не являющиеся бизнес-сущностью
 * запроса; grant остаётся в снимке и ловит ошибочный revoke/rotate.
 */
const fingerprintTables = [
  "campaigns",
  "memberships",
  "assets",
  "characters",
  "character_controllers",
  "catalog_entries",
  "character_catalog_entries",
  "scenes",
  "token_definitions",
  "token_controllers",
  "tokens",
  "drawings",
  "player_access_grants",
  "sticker_packs",
  "sticker_pack_entitlements",
  "player_likeness_consents",
  "sticker_media",
  "stickers",
  "chat_threads",
  "chat_messages",
  "game_events",
  "action_journal",
] as const;

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

async function mutationFingerprint() {
  const tables = await Promise.all(
    fingerprintTables.map(async (table) => {
      const result = await database.query(`select * from "${table}"`);
      const rows = result.rows
        .map((row) => canonical(row))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      return [table, rows] as const;
    }),
  );
  return {
    tables: Object.fromEntries(tables),
    mediaFiles: (await readdir(mediaRoot)).sort(),
  };
}

async function expectControl(request: ProbeRequest, status: number) {
  const response = await app.inject({
    ...request,
    headers: headers(request.headers),
  });
  expect(response.statusCode, response.body).toBe(status);
}

async function expectRejected(
  label: string,
  request: ProbeRequest,
  status: 403 | 404,
  error: string,
) {
  const before = await mutationFingerprint();
  const response = await app.inject({
    ...request,
    headers: headers(request.headers),
  });
  expect(response.statusCode, `${label}: ${response.body}`).toBe(status);
  expect(response.json()).toEqual({ error });
  expect(await mutationFingerprint(), label).toEqual(before);
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-uix413-isolation-"));
  env.MEDIA_ROOT = mediaRoot;
  env.MIN_FREE_DISK_BYTES = 1;
  env.MEDIA_QUOTA_BYTES = 50 * 1024 * 1024;
  await Promise.all([
    writeFile(join(mediaRoot, "own-asset.webp"), tinyPng),
    writeFile(join(mediaRoot, "foreign-asset.webp"), tinyPng),
    writeFile(join(mediaRoot, "own-sticker.webp"), tinyPng),
    writeFile(join(mediaRoot, "foreign-sticker.webp"), tinyPng),
  ]);

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
    { id: ids.campaign, name: "Campaign A", activeSceneId: ids.scene },
    {
      id: ids.foreignCampaign,
      name: "Campaign B",
      activeSceneId: ids.foreignScene,
    },
  ]);
  await db.insert(schema.memberships).values([
    {
      id: ids.gm,
      campaignId: ids.campaign,
      role: "GM",
      displayName: "GM A",
    },
    {
      id: ids.player,
      campaignId: ids.campaign,
      role: "PLAYER",
      displayName: "Player A",
    },
    {
      id: ids.foreignPlayer,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Player B",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: ids.gm,
      tokenHash: hashToken(gmSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
    {
      membershipId: ids.player,
      tokenHash: hashToken(playerSecret),
      expiresAt: new Date(Date.now() + 600_000),
    },
  ]);
  await db.insert(schema.assets).values([
    {
      id: ids.asset,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "TOKEN",
      name: "Own asset",
      storageKey: "own-asset.webp",
      mimeType: "image/webp",
      sizeBytes: tinyPng.length,
    },
    {
      id: ids.foreignAsset,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreignPlayer,
      kind: "TOKEN",
      name: "Foreign asset",
      storageKey: "foreign-asset.webp",
      mimeType: "image/webp",
      sizeBytes: tinyPng.length,
    },
  ]);
  await db.insert(schema.characters).values([
    {
      id: ids.character,
      campaignId: ids.campaign,
      ownerMembershipId: ids.player,
      name: "Hero A",
      stats: { strength: 1 },
      resources: { physicalPower: { current: 5, maximum: 10 } },
    },
    {
      id: ids.foreignCharacter,
      campaignId: ids.foreignCampaign,
      ownerMembershipId: ids.foreignPlayer,
      name: "Hero B",
      stats: { strength: 2 },
      resources: { physicalPower: { current: 6, maximum: 10 } },
    },
    {
      id: ids.foreignArchivedCharacter,
      campaignId: ids.foreignCampaign,
      name: "Archived B",
      lifecycle: "ARCHIVED",
      archivedAt: new Date(),
      archivedByMembershipId: ids.foreignPlayer,
    },
  ]);
  await db.insert(schema.catalogEntries).values([
    {
      id: ids.catalog,
      campaignId: ids.campaign,
      kind: "ABILITY",
      name: "Own ability",
    },
    {
      id: ids.foreignCatalog,
      campaignId: ids.foreignCampaign,
      kind: "ABILITY",
      name: "Foreign ability",
    },
  ]);
  await db.insert(schema.characterCatalogEntries).values({
    id: ids.foreignCharacterEntry,
    characterId: ids.foreignCharacter,
    sourceCatalogEntryId: ids.foreignCatalog,
    kind: "ABILITY",
    name: "Foreign assigned ability",
  });
  const grid = {
    enabled: true,
    size: 64,
    offsetX: 0,
    offsetY: 0,
    color: "#ffffff",
    opacity: 0.2,
  };
  await db.insert(schema.scenes).values([
    { id: ids.scene, campaignId: ids.campaign, name: "Scene A", grid },
    {
      id: ids.foreignScene,
      campaignId: ids.foreignCampaign,
      name: "Scene B",
      grid,
    },
  ]);
  await db.insert(schema.tokenDefinitions).values([
    {
      id: ids.definition,
      campaignId: ids.campaign,
      characterId: ids.character,
      name: "Token A",
    },
    {
      id: ids.foreignDefinition,
      campaignId: ids.foreignCampaign,
      characterId: ids.foreignCharacter,
      name: "Token B",
    },
  ]);
  await db.insert(schema.tokenControllers).values({
    tokenDefinitionId: ids.foreignDefinition,
    membershipId: ids.foreignPlayer,
  });
  await db.insert(schema.tokens).values([
    {
      id: ids.token,
      definitionId: ids.definition,
      sceneId: ids.scene,
      name: "Placement A",
      x: 0,
      y: 0,
    },
    {
      id: ids.foreignToken,
      definitionId: ids.foreignDefinition,
      sceneId: ids.foreignScene,
      name: "Placement B",
      x: 10,
      y: 20,
    },
    {
      id: ids.hybridToken,
      definitionId: ids.foreignDefinition,
      sceneId: ids.scene,
      name: "Hybrid placement",
      x: 30,
      y: 40,
    },
  ]);
  await db.insert(schema.drawings).values({
    id: ids.foreignDrawing,
    sceneId: ids.foreignScene,
    authorMembershipId: ids.foreignPlayer,
    points: [0, 0, 10, 10],
    color: "#ffffff",
  });
  await db.insert(schema.playerAccessGrants).values({
    id: ids.foreignPlayerAccess,
    campaignId: ids.foreignCampaign,
    membershipId: ids.foreignPlayer,
    label: "Foreign access",
    tokenHash: hashToken("foreign-access-token"),
  });
  await db.insert(schema.stickerPacks).values([
    {
      id: ids.ownActivePack,
      campaignId: ids.campaign,
      name: "Own active",
      subject: "CREATURE",
      subjectLabel: "Own creature",
      lifecycle: "ACTIVE",
    },
    {
      id: ids.ownDraftPack,
      campaignId: ids.campaign,
      name: "Own draft",
      subject: "CREATURE",
      subjectLabel: "Own draft creature",
      lifecycle: "DRAFT",
    },
    {
      id: ids.foreignActivePack,
      campaignId: ids.foreignCampaign,
      name: "Foreign active",
      subject: "CREATURE",
      subjectLabel: "Foreign creature",
      lifecycle: "ACTIVE",
    },
    {
      id: ids.foreignDraftPack,
      campaignId: ids.foreignCampaign,
      name: "Foreign draft",
      subject: "CREATURE",
      subjectLabel: "Foreign draft creature",
      lifecycle: "DRAFT",
    },
    {
      id: ids.foreignPlayerPack,
      campaignId: ids.foreignCampaign,
      name: "Foreign player",
      subject: "PLAYER",
      subjectMembershipId: ids.foreignPlayer,
      lifecycle: "DRAFT",
    },
    {
      id: ids.ownPlayerPack,
      campaignId: ids.campaign,
      name: "Own player",
      subject: "PLAYER",
      subjectMembershipId: ids.player,
      lifecycle: "DRAFT",
    },
  ]);
  await db.insert(schema.stickerMedia).values([
    {
      id: ids.ownStickerMedia,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      storageKey: "own-sticker.webp",
      mimeType: "image/webp",
      sizeBytes: tinyPng.length,
      width: 1,
      height: 1,
      sha256: "a".repeat(64),
    },
    {
      id: ids.foreignStickerMedia,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreignPlayer,
      storageKey: "foreign-sticker.webp",
      mimeType: "image/webp",
      sizeBytes: tinyPng.length,
      width: 1,
      height: 1,
      sha256: "b".repeat(64),
    },
  ]);
  await db.insert(schema.stickers).values([
    {
      id: ids.ownSticker,
      campaignId: ids.campaign,
      packId: ids.ownActivePack,
      mediaId: ids.ownStickerMedia,
      name: "Own sticker",
      altText: "Own",
      provenanceType: "ORIGINAL",
    },
    {
      id: ids.foreignSticker,
      campaignId: ids.foreignCampaign,
      packId: ids.foreignActivePack,
      mediaId: ids.foreignStickerMedia,
      name: "Foreign sticker",
      altText: "Foreign",
      provenanceType: "ORIGINAL",
    },
  ]);
  await db.insert(schema.stickerPackEntitlements).values({
    campaignId: ids.foreignCampaign,
    packId: ids.foreignActivePack,
    membershipId: ids.foreignPlayer,
  });
  await db.insert(schema.gameEvents).values({
    campaignId: ids.campaign,
    actionId: ids.replayAction,
    membershipId: ids.gm,
    type: "token.placed",
    entityType: "token",
    entityId: ids.foreignToken,
    entityRevision: 0,
    payload: {
      definitionId: ids.foreignDefinition,
      sceneId: ids.foreignScene,
    },
  });
  await db.insert(schema.gameEvents).values([
    {
      campaignId: ids.campaign,
      actionId: ids.replayOwnDefinitionAction,
      membershipId: ids.gm,
      type: "token.placed",
      entityType: "token",
      entityId: ids.foreignToken,
      entityRevision: 0,
      payload: {
        definitionId: ids.foreignDefinition,
        sceneId: ids.foreignScene,
      },
    },
    {
      campaignId: ids.campaign,
      actionId: ids.replayHybridAction,
      membershipId: ids.gm,
      type: "token.placed",
      entityType: "token",
      entityId: ids.hybridToken,
      entityRevision: 0,
      payload: {
        definitionId: ids.foreignDefinition,
        sceneId: ids.scene,
      },
    },
  ]);

  app = Fastify();
  await app.register(cookie);
  await app.register(multipart);
  const room = {
    fetchSockets: async () => [],
    disconnectSockets() {},
    emit() {},
  };
  const io = {
    in: () => room,
    to: () => room,
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
  await database.close();
  env.MEDIA_ROOT = originalMediaRoot;
  env.MIN_FREE_DISK_BYTES = originalMinFreeDiskBytes;
  env.MEDIA_QUOTA_BYTES = originalMediaQuotaBytes;
  await rm(mediaRoot, { recursive: true, force: true });
});

const probes: readonly Probe[] = [
  {
    key: "PATCH /api/memberships/:id/name",
    request: () => ({
      method: "PATCH",
      url: `/api/memberships/${ids.foreignPlayer}/name`,
      payload: { ...revisionBody(), name: "No tenant crossing" },
    }),
    status: 404,
    error: "MEMBERSHIP_NOT_FOUND",
  },
  {
    key: "PUT /api/characters/:id/controllers",
    request: () => ({
      method: "PUT",
      url: `/api/characters/${ids.foreignCharacter}/controllers`,
      payload: { ...revisionBody(), controllerMembershipIds: [] },
    }),
    status: 404,
    error: "CHARACTER_NOT_FOUND",
  },
  {
    key: "PATCH /api/characters/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}`,
      payload: { ...revisionBody(), name: "No tenant crossing" },
    }),
    status: 404,
    error: "CHARACTER_NOT_FOUND",
  },
  {
    key: "POST /api/characters/:id/archive",
    request: () => ({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/archive`,
      payload: revisionBody(),
    }),
    status: 404,
    error: "CHARACTER_NOT_FOUND",
  },
  {
    key: "POST /api/characters/:id/restore",
    request: () => ({
      method: "POST",
      url: `/api/characters/${ids.foreignArchivedCharacter}/restore`,
      payload: revisionBody(),
    }),
    status: 404,
    error: "CHARACTER_NOT_FOUND",
  },
  {
    key: "PATCH /api/catalog/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/catalog/${ids.foreignCatalog}`,
      payload: { ...revisionBody(), name: "No tenant crossing" },
    }),
    status: 404,
    error: "CATALOG_NOT_FOUND",
  },
  {
    key: "DELETE /api/catalog/:id",
    request: () => ({
      method: "DELETE",
      url: `/api/catalog/${ids.foreignCatalog}`,
      payload: revisionBody(),
    }),
    status: 404,
    error: "CATALOG_NOT_FOUND",
  },
  {
    key: "POST /api/characters/:id/catalog",
    request: () => ({
      method: "POST",
      url: `/api/characters/${ids.foreignCharacter}/catalog`,
      payload: {
        actionId: actionId(),
        catalogEntryId: ids.foreignCatalog,
      },
    }),
    status: 404,
    error: "ASSIGNMENT_SOURCE_NOT_FOUND",
  },
  {
    key: "PATCH /api/characters/:characterId/catalog/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}/catalog/${ids.foreignCharacterEntry}`,
      payload: { ...revisionBody(), name: "No tenant crossing" },
    }),
    status: 404,
    error: "CHARACTER_ENTRY_NOT_FOUND",
  },
  {
    key: "DELETE /api/characters/:characterId/catalog/:id",
    request: () => ({
      method: "DELETE",
      url: `/api/characters/${ids.foreignCharacter}/catalog/${ids.foreignCharacterEntry}`,
      payload: revisionBody(),
    }),
    status: 404,
    error: "CHARACTER_ENTRY_NOT_FOUND",
  },
  {
    key: "POST /api/player-access/:id/revoke",
    request: () => ({
      method: "POST",
      url: `/api/player-access/${ids.foreignPlayerAccess}/revoke`,
      payload: { actionId: actionId() },
    }),
    status: 404,
    error: "PLAYER_ACCESS_NOT_FOUND",
  },
  {
    key: "POST /api/player-access/:id/rotate",
    request: () => ({
      method: "POST",
      url: `/api/player-access/${ids.foreignPlayerAccess}/rotate`,
      payload: { actionId: actionId() },
    }),
    status: 404,
    error: "PLAYER_ACCESS_NOT_FOUND",
  },
  {
    key: "PATCH /api/scenes/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/scenes/${ids.foreignScene}`,
      payload: { ...revisionBody(), name: "No tenant crossing" },
    }),
    status: 404,
    error: "SCENE_NOT_FOUND",
  },
  {
    key: "POST /api/token-definitions/:id/placements",
    request: () => ({
      method: "POST",
      url: `/api/token-definitions/${ids.foreignDefinition}/placements`,
      payload: {
        actionId: actionId(),
        sceneId: ids.scene,
        x: 64,
        y: 64,
      },
    }),
    status: 404,
    error: "TOKEN_DEFINITION_NOT_FOUND",
  },
  {
    key: "PATCH /api/tokens/:id/size",
    request: () => ({
      method: "PATCH",
      url: `/api/tokens/${ids.foreignToken}/size`,
      payload: { ...revisionBody(), width: 96, height: 96 },
    }),
    status: 404,
    error: "TOKEN_NOT_FOUND",
  },
  {
    key: "PATCH /api/tokens/:id/appearance",
    request: () => ({
      method: "PATCH",
      url: `/api/tokens/${ids.foreignToken}/appearance`,
      payload: {
        ...revisionBody(),
        baseColor: "#112233",
        frameColor: "#445566",
      },
    }),
    status: 404,
    error: "TOKEN_NOT_FOUND",
  },
  {
    key: "PATCH /api/tokens/:id/conditions",
    request: () => ({
      method: "PATCH",
      url: `/api/tokens/${ids.foreignToken}/conditions`,
      payload: { ...revisionBody(), conditions: ["POISONED"] },
    }),
    status: 404,
    error: "TOKEN_NOT_FOUND",
  },
  {
    key: "DELETE /api/tokens/:id",
    request: () => ({
      method: "DELETE",
      url: `/api/tokens/${ids.foreignToken}`,
      payload: revisionBody(),
    }),
    status: 404,
    error: "TOKEN_NOT_FOUND",
  },
  {
    key: "PUT /api/token-definitions/:id/controllers",
    request: () => ({
      method: "PUT",
      url: `/api/token-definitions/${ids.foreignDefinition}/controllers`,
      payload: { ...revisionBody(), controllerMembershipIds: [] },
    }),
    status: 404,
    error: "TOKEN_DEFINITION_NOT_FOUND",
  },
  {
    key: "PATCH /api/token-definitions/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/token-definitions/${ids.foreignDefinition}`,
      payload: { ...revisionBody(), name: "No tenant crossing" },
    }),
    status: 404,
    error: "TOKEN_DEFINITION_NOT_FOUND",
  },
  {
    key: "DELETE /api/token-definitions/:id",
    request: () => ({
      method: "DELETE",
      url: `/api/token-definitions/${ids.foreignDefinition}`,
      payload: revisionBody(),
    }),
    status: 404,
    error: "TOKEN_DEFINITION_NOT_FOUND",
  },
  {
    key: "PATCH /api/tokens/:id/layer",
    request: () => ({
      method: "PATCH",
      url: `/api/tokens/${ids.foreignToken}/layer`,
      payload: { ...revisionBody(), layer: "GM" },
    }),
    status: 404,
    error: "TOKEN_NOT_FOUND",
  },
  {
    key: "PATCH /api/drawings/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/drawings/${ids.foreignDrawing}`,
      payload: { ...revisionBody(), color: "#112233" },
    }),
    status: 403,
    error: "DRAWING_FORBIDDEN",
  },
  {
    key: "POST /api/drawings/:id/copy",
    request: () => ({
      method: "POST",
      url: `/api/drawings/${ids.foreignDrawing}/copy`,
      payload: revisionBody(),
    }),
    status: 403,
    error: "DRAWING_FORBIDDEN",
  },
  {
    key: "DELETE /api/drawings/:id",
    request: () => ({
      method: "DELETE",
      url: `/api/drawings/${ids.foreignDrawing}`,
      payload: revisionBody(),
    }),
    status: 403,
    error: "DRAWING_FORBIDDEN",
  },
  {
    key: "PATCH /api/scenes/:id/canvas",
    request: () => ({
      method: "PATCH",
      url: `/api/scenes/${ids.foreignScene}/canvas`,
      payload: { ...revisionBody(), mapScale: 2 },
    }),
    status: 404,
    error: "SCENE_NOT_FOUND",
  },
  {
    key: "PATCH /api/sticker-packs/:id",
    request: () => ({
      method: "PATCH",
      url: `/api/sticker-packs/${ids.foreignDraftPack}`,
      payload: { revision: 0, name: "No tenant crossing" },
    }),
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
  },
  {
    key: "DELETE /api/sticker-packs/:id",
    request: () => ({
      method: "DELETE",
      url: `/api/sticker-packs/${ids.foreignDraftPack}`,
    }),
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
  },
  {
    key: "POST /api/sticker-packs/:id/stickers",
    request: () => {
      const form = multipartImage();
      return {
        method: "POST",
        url: stickerUploadUrl(ids.foreignDraftPack),
        headers: { "content-type": form.contentType },
        payload: form.body,
      };
    },
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
    control: async () => {
      const form = multipartImage();
      await expectControl(
        {
          method: "POST",
          url: stickerUploadUrl(ids.ownDraftPack),
          headers: { "content-type": form.contentType },
          payload: form.body,
        },
        201,
      );
    },
  },
  {
    key: "POST /api/sticker-packs/:id/publish",
    request: () => ({
      method: "POST",
      url: `/api/sticker-packs/${ids.foreignDraftPack}/publish`,
    }),
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
  },
  {
    key: "POST /api/sticker-packs/:id/deprecate",
    request: () => ({
      method: "POST",
      url: `/api/sticker-packs/${ids.foreignActivePack}/deprecate`,
    }),
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
  },
  {
    key: "PUT /api/sticker-packs/:id/entitlements/:membershipId",
    request: () => ({
      method: "PUT",
      url: `/api/sticker-packs/${ids.foreignActivePack}/entitlements/${ids.foreignPlayer}`,
      payload: { granted: true },
    }),
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
  },
  {
    key: "PUT /api/sticker-packs/:id/consent",
    request: () => ({
      method: "PUT",
      url: `/api/sticker-packs/${ids.foreignPlayerPack}/consent`,
      headers: playerHeaders(),
      payload: { granted: true },
    }),
    status: 404,
    error: "STICKER_PACK_NOT_FOUND",
    control: () =>
      expectControl(
        {
          method: "PUT",
          url: `/api/sticker-packs/${ids.ownPlayerPack}/consent`,
          headers: playerHeaders(),
          payload: { granted: true },
        },
        204,
      ),
  },
  {
    key: "GET /api/stickers/:id/content",
    request: () => ({
      method: "GET",
      url: `/api/stickers/${ids.foreignSticker}/content`,
    }),
    status: 404,
    error: "STICKER_NOT_FOUND",
    control: () =>
      expectControl(
        {
          method: "GET",
          url: `/api/stickers/${ids.ownSticker}/content`,
        },
        200,
      ),
  },
  {
    key: "PATCH /api/characters/:id/counters",
    request: () => ({
      method: "PATCH",
      url: `/api/characters/${ids.foreignCharacter}/counters`,
      payload: {
        ...revisionBody(),
        wallet: { gold: 1, silver: 0, copper: 0, sp: 0 },
      },
    }),
    status: 403,
    error: "CHARACTER_FORBIDDEN",
  },
  {
    key: "GET /api/assets/:id/content",
    request: () => ({
      method: "GET",
      url: `/api/assets/${ids.foreignAsset}/content`,
    }),
    status: 404,
    error: "ASSET_NOT_FOUND",
    control: () =>
      expectControl(
        { method: "GET", url: `/api/assets/${ids.asset}/content` },
        200,
      ),
  },
];

describe("UIX-413 core campaign isolation", () => {
  it("keeps the exported behavioral inventory exact and executable", () => {
    expect(probes.map((probe) => probe.key)).toEqual(CORE_CAMPAIGN_PROBE_KEYS);
    expect(new Set(probes.map((probe) => probe.key)).size).toBe(36);
  });

  it.each(probes)("rejects foreign entity: $key", async (probe) => {
    await probe.control?.();
    await expectRejected(probe.key, probe.request(), probe.status, probe.error);
  });

  it("checks both IDs of catalog assignment with mixed campaigns", async () => {
    await expectRejected(
      "foreign character + own catalog",
      {
        method: "POST",
        url: `/api/characters/${ids.foreignCharacter}/catalog`,
        payload: { actionId: actionId(), catalogEntryId: ids.catalog },
      },
      404,
      "ASSIGNMENT_SOURCE_NOT_FOUND",
    );
    await expectRejected(
      "own character + foreign catalog",
      {
        method: "POST",
        url: `/api/characters/${ids.character}/catalog`,
        payload: { actionId: actionId(), catalogEntryId: ids.foreignCatalog },
      },
      404,
      "ASSIGNMENT_SOURCE_NOT_FOUND",
    );
  });

  it("checks both IDs of sticker entitlement with mixed campaigns", async () => {
    await expectRejected(
      "foreign pack + own membership",
      {
        method: "PUT",
        url: `/api/sticker-packs/${ids.foreignActivePack}/entitlements/${ids.player}`,
        payload: { granted: true },
      },
      404,
      "STICKER_PACK_NOT_FOUND",
    );
    await expectRejected(
      "own pack + foreign membership",
      {
        method: "PUT",
        url: `/api/sticker-packs/${ids.ownActivePack}/entitlements/${ids.foreignPlayer}`,
        payload: { granted: true },
      },
      404,
      "STICKER_PACK_NOT_FOUND",
    );
  });

  it("keeps player-pack subject identity campaign-scoped in the database", async () => {
    // Consent has two independent guards: campaignId and exact subject player.
    // A foreign pack whose subject is Player A would isolate the first one, but
    // the composite FK deliberately makes that corrupted fixture impossible.
    const before = await mutationFingerprint();
    let rejected: unknown;
    try {
      await db.insert(schema.stickerPacks).values({
        id: ids.invalidCrossCampaignPlayerPack,
        campaignId: ids.foreignCampaign,
        name: "Invalid cross-campaign subject",
        subject: "PLAYER",
        subjectMembershipId: ids.player,
      });
    } catch (reason) {
      rejected = reason;
    }
    expect(rejected).toBeInstanceOf(Error);
    const cause = (rejected as Error & { cause?: unknown }).cause;
    expect(cause).toMatchObject({ code: "23503" });
    expect(String(cause)).toContain("sticker_packs_campaign_membership_fk");
    expect(await mutationFingerprint()).toEqual(before);
  });

  it("rejects replay for a foreign definition and foreign-scene token", async () => {
    const before = await mutationFingerprint();
    const response = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.foreignDefinition}/placements`,
      headers: headers(),
      payload: {
        actionId: ids.replayAction,
        sceneId: ids.scene,
        x: 32,
        y: 32,
      },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json()).toEqual({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    expect(await mutationFingerprint()).toEqual(before);
  });

  it("does not return a foreign token for an own-definition replay", async () => {
    const before = await mutationFingerprint();
    const response = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.definition}/placements`,
      headers: headers(),
      payload: {
        actionId: ids.replayOwnDefinitionAction,
        sceneId: ids.scene,
        x: 32,
        y: 32,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ duplicate: true });
    expect(await mutationFingerprint()).toEqual(before);
  });

  it("rejects a foreign definition even when its token is in an own scene", async () => {
    const before = await mutationFingerprint();
    const response = await app.inject({
      method: "POST",
      url: `/api/token-definitions/${ids.foreignDefinition}/placements`,
      headers: headers(),
      payload: {
        actionId: ids.replayHybridAction,
        sceneId: ids.scene,
        x: 32,
        y: 32,
      },
    });
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json()).toEqual({ error: "TOKEN_DEFINITION_NOT_FOUND" });
    expect(await mutationFingerprint()).toEqual(before);
  });
});
