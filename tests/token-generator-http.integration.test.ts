import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let mediaRoot: string;
let broadcastFailure: Error | null;
const originalMediaRoot = env.MEDIA_ROOT;
const originalMinFree = env.MIN_FREE_DISK_BYTES;
const originalQuota = env.MEDIA_QUOTA_BYTES;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignGm: crypto.randomUUID(),
  image: crypto.randomUUID(),
  token: crypto.randomUUID(),
  foreignImage: crypto.randomUUID(),
  scene: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string, actionId = crypto.randomUUID()) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
  "x-action-id": actionId,
});
const transform = {
  cropX: 0.5,
  cropY: 0.5,
  zoom: 1.5,
  frame: "BRONZE",
};

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-token-generator-"));
  broadcastFailure = null;
  env.MEDIA_ROOT = mediaRoot;
  env.MIN_FREE_DISK_BYTES = 1;
  env.MEDIA_QUOTA_BYTES = 50 * 1024 * 1024;
  await mkdir(mediaRoot, { recursive: true });
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(join(mediaRoot, "source.webp"), image);
  await writeFile(join(mediaRoot, "foreign.webp"), image);
  await writeFile(join(mediaRoot, "token.webp"), image);

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
      id: ids.foreignGm,
      campaignId: ids.foreignCampaign,
      role: "GM",
      displayName: "Other GM",
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
  ]);
  await db.insert(schema.scenes).values({
    id: ids.scene,
    campaignId: ids.campaign,
    name: "Scene",
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#ffffff",
      opacity: 0.2,
    },
  });
  await db.insert(schema.assets).values([
    {
      id: ids.image,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "IMAGE",
      name: "Portrait source",
      storageKey: "source.webp",
      mimeType: "image/webp",
      sizeBytes: (await readFile(join(mediaRoot, "source.webp"))).length,
      width: 900,
      height: 600,
    },
    {
      id: ids.token,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "TOKEN",
      name: "Existing token",
      storageKey: "token.webp",
      mimeType: "image/webp",
      sizeBytes: 100,
      width: 900,
      height: 600,
    },
    {
      id: ids.foreignImage,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreignGm,
      kind: "IMAGE",
      name: "Foreign source",
      storageKey: "foreign.webp",
      mimeType: "image/webp",
      sizeBytes: 100,
      width: 900,
      height: 600,
    },
  ]);
  app = Fastify();
  await app.register(cookie);
  registerRoutes(
    app,
    db as never,
    {
      in: () => ({
        fetchSockets: async () => {
          if (broadcastFailure) throw broadcastFailure;
          return [];
        },
      }),
      to: () => ({ emit() {} }),
    } as never,
  );
  await app.ready();
});

afterEach(async () => {
  await app?.close();
  await database?.close();
  await rm(mediaRoot, { recursive: true, force: true });
  env.MEDIA_ROOT = originalMediaRoot;
  env.MIN_FREE_DISK_BYTES = originalMinFree;
  env.MEDIA_QUOTA_BYTES = originalQuota;
});

describe("UIX-255 token generator HTTP", () => {
  it("is GM-only and hides foreign or non-IMAGE sources", async () => {
    const denied = await app.inject({
      method: "POST",
      url: `/api/assets/${ids.image}/token`,
      headers: headers(secrets.player),
      payload: transform,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "GM_REQUIRED" });

    for (const sourceId of [ids.foreignImage, ids.token]) {
      const hidden = await app.inject({
        method: "POST",
        url: `/api/assets/${sourceId}/token`,
        headers: headers(secrets.gm),
        payload: transform,
      });
      expect(hidden.statusCode).toBe(404);
      expect(hidden.json()).toEqual({ error: "SOURCE_IMAGE_NOT_FOUND" });
    }
  });

  it("creates one reusable 512px TOKEN and replays the same action", async () => {
    const actionId = crypto.randomUUID();
    const created = await app.inject({
      method: "POST",
      url: `/api/assets/${ids.image}/token`,
      headers: headers(secrets.gm, actionId),
      payload: { ...transform, name: "Gatekeeper token" },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      kind: "TOKEN",
      name: "Gatekeeper token",
      mimeType: "image/webp",
      width: 512,
      height: 512,
      durationSeconds: null,
    });
    expect(created.json().url).toBe(`/api/assets/${created.json().id}/content`);

    const replay = await app.inject({
      method: "POST",
      url: `/api/assets/${ids.image}/token`,
      headers: headers(secrets.gm, actionId),
      payload: transform,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(created.json().id);

    const allAssets = await db.select().from(schema.assets);
    expect(
      allAssets.filter((asset) => asset.id === created.json().id),
    ).toHaveLength(1);
    expect(allAssets.find((asset) => asset.id === ids.image)?.kind).toBe(
      "IMAGE",
    );
    const generated = allAssets.find(
      (asset) => asset.id === created.json().id,
    )!;
    const generatedContent = await readFile(
      join(mediaRoot, generated.storageKey),
    );
    expect(generatedContent.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(generatedContent.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("keeps committed media when snapshot broadcast fails", async () => {
    const actionId = crypto.randomUUID();
    broadcastFailure = new Error("BROADCAST_FAILED");
    const failedResponse = await app.inject({
      method: "POST",
      url: `/api/assets/${ids.image}/token`,
      headers: headers(secrets.gm, actionId),
      payload: transform,
    });
    expect(failedResponse.statusCode).toBe(500);

    const allAssets = await db.select().from(schema.assets);
    const committed = allAssets.find(
      (asset) => asset.kind === "TOKEN" && asset.id !== ids.token,
    );
    expect(committed).toBeDefined();
    await expect(
      readFile(join(mediaRoot, committed!.storageKey)),
    ).resolves.not.toHaveLength(0);

    broadcastFailure = null;
    const replay = await app.inject({
      method: "POST",
      url: `/api/assets/${ids.image}/token`,
      headers: headers(secrets.gm, actionId),
      payload: transform,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(committed!.id);
  });

  it("cleans the losing file when identical actions race", async () => {
    const actionId = crypto.randomUUID();
    const request = () =>
      app.inject({
        method: "POST",
        url: `/api/assets/${ids.image}/token`,
        headers: headers(secrets.gm, actionId),
        payload: transform,
      });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 201,
    ]);
    expect(new Set(responses.map((response) => response.json().id)).size).toBe(
      1,
    );
    expect(await readdir(mediaRoot)).toHaveLength(4);
  });

  it("rejects IMAGE assets in the legacy placement route", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/tokens",
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        sceneId: ids.scene,
        assetId: ids.image,
        name: "Not a token derivative",
        x: 0,
        y: 0,
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "ASSET_NOT_FOUND" });
  });
});

/**
 * UIX-474 п. 2 — почему в снапшоте живут ссылки на ассеты без содержимого.
 *
 * Разбор кода дал ответ: строку в `assets` не удаляет никто, а файл исчезает
 * лишь на откате неудачной загрузки — вместе со своей строкой. Значит расхождение
 * приходит снаружи: база пережила каталог `MEDIA_ROOT` (сброс стенда, другой
 * том, другой путь). Кода, который создаёт такую пару, в репозитории нет.
 *
 * Чинить здесь нечего — но узнавать об этом по битой картинке в браузере,
 * как вышло с журналом бросков, нельзя. Снаружи «нет такой строки» и «строка
 * есть, файла нет» отвечали одинаковым 404 и не различались в журнале сервера.
 * Теперь второй случай называет себя и печатает `storageKey`, а сбой чтения
 * (права, каталог вместо файла) перестал притворяться отсутствием файла:
 * иначе авария хранилища выглядела бы потерянным ассетом и чинили бы не то.
 *
 * Живёт рядом с генератором токенов ради его стенда: настоящий `MEDIA_ROOT`,
 * строки ассетов и сессии обеих ролей — всё, что этой проверке нужно.
 */
describe("UIX-474 asset content", () => {
  const contentUrl = (assetId: string) => `/api/assets/${assetId}/content`;

  it("serves a stored asset to the GM", async () => {
    const response = await app.inject({
      method: "GET",
      url: contentUrl(ids.image),
      headers: headers(secrets.gm),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
  });

  it("names the lost file instead of a bare 404", async () => {
    await rm(join(mediaRoot, "source.webp"));
    const warnings: unknown[] = [];
    app.log.warn = ((payload: unknown, message?: string) => {
      if (message === "asset.content_missing") warnings.push(payload);
    }) as typeof app.log.warn;

    const response = await app.inject({
      method: "GET",
      url: contentUrl(ids.image),
      headers: headers(secrets.gm),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "ASSET_CONTENT_NOT_FOUND" });
    // Без `storageKey` в журнале вопрос «битая запись или потерянный файл»
    // снова пришлось бы разбирать в браузере.
    expect(warnings).toEqual([
      { assetId: ids.image, storageKey: "source.webp" },
    ]);
  });

  it("does not disguise an unreadable file as a missing one", async () => {
    // Каталог на месте файла — самый дешёвый способ получить не-ENOENT: чтение
    // падает на EISDIR, хотя запись в базе цела и файл «есть».
    await rm(join(mediaRoot, "source.webp"));
    await mkdir(join(mediaRoot, "source.webp"));
    app.log.error = (() => {}) as typeof app.log.error;

    const response = await app.inject({
      method: "GET",
      url: contentUrl(ids.image),
      headers: headers(secrets.gm),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "ASSET_CONTENT_UNREADABLE" });
  });

  it("hides an asset the player cannot see behind the same 404", async () => {
    // Утечка была бы в различии ответов: игрок не должен узнавать по коду
    // ошибки, что засадный токен вообще существует.
    const response = await app.inject({
      method: "GET",
      url: contentUrl(ids.image),
      headers: headers(secrets.player),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "ASSET_NOT_FOUND" });
  });

  it("UIX-587 follows the current definition asset without retaining the legacy placement asset", async () => {
    const replacementAssetId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const placementId = crypto.randomUUID();
    const unknownAssetId = crypto.randomUUID();
    const foreignSecret = "f".repeat(40);
    const replacementStorageKey = "uix587-current.webp";
    const replacementContent = await readFile(join(mediaRoot, "token.webp"));
    await writeFile(join(mediaRoot, replacementStorageKey), replacementContent);
    await db.insert(schema.sessions).values({
      membershipId: ids.foreignGm,
      tokenHash: hashToken(foreignSecret),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.assets).values({
      id: replacementAssetId,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "TOKEN",
      name: "Current token",
      storageKey: replacementStorageKey,
      mimeType: "image/webp",
      sizeBytes: replacementContent.length,
      width: 900,
      height: 600,
    });
    await db.insert(schema.tokenDefinitions).values({
      id: definitionId,
      campaignId: ids.campaign,
      defaultAssetId: ids.token,
      name: "Visible stranger",
    });
    await db.insert(schema.tokens).values({
      id: placementId,
      definitionId,
      sceneId: ids.scene,
      ownerMembershipId: ids.gm,
      assetId: ids.token,
      layer: "PLAYER",
      name: "Visible stranger",
      x: 64,
      y: 64,
      visible: true,
    });
    const revealedArea = { x: 0, y: 0, width: 256, height: 256 };
    await db.insert(schema.fogReveals).values({
      sceneId: ids.scene,
      ...revealedArea,
      operation: "REVEAL",
      shape: "RECT",
      geometry: { type: "RECT", ...revealedArea },
      bbox: revealedArea,
      sequence: 1,
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/token-definitions/${definitionId}`,
      headers: headers(secrets.gm),
      payload: {
        actionId: crypto.randomUUID(),
        revision: 0,
        defaultAssetId: replacementAssetId,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);

    const storedDefinitions = await db.select().from(schema.tokenDefinitions);
    const storedPlacements = await db.select().from(schema.tokens);
    expect(
      storedDefinitions.find((definition) => definition.id === definitionId),
    ).toMatchObject({ defaultAssetId: replacementAssetId, revision: 1 });
    expect(
      storedPlacements.find((token) => token.id === placementId),
    ).toMatchObject({ assetId: replacementAssetId });

    // The current writer cascades the canonical asset (UIX-614). Recreate a
    // legacy row explicitly so the snapshot ACL regression remains independent
    // of that writer and still protects previously persisted placements.
    await db
      .update(schema.tokens)
      .set({ assetId: ids.token })
      .where(eq(schema.tokens.id, placementId));

    const playerBootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: headers(secrets.player),
    });
    expect(playerBootstrap.statusCode, playerBootstrap.body).toBe(200);
    const playerSnapshot = playerBootstrap.json() as {
      tokens: { id: string; assetId: string | null }[];
      assets: { id: string }[];
    };
    expect(
      playerSnapshot.tokens.find((token) => token.id === placementId),
    ).toMatchObject({ assetId: replacementAssetId });
    expect(playerSnapshot.assets.map((asset) => asset.id)).toContain(
      replacementAssetId,
    );
    expect(playerSnapshot.assets.map((asset) => asset.id)).not.toContain(
      ids.token,
    );

    const playerCurrent = await app.inject({
      method: "GET",
      url: contentUrl(replacementAssetId),
      headers: headers(secrets.player),
    });
    expect(playerCurrent.statusCode, playerCurrent.body).toBe(200);
    expect(playerCurrent.headers["content-type"]).toBe("image/webp");

    const safeNotFound = { error: "ASSET_NOT_FOUND" };
    const playerLegacy = await app.inject({
      method: "GET",
      url: contentUrl(ids.token),
      headers: headers(secrets.player),
    });
    expect(playerLegacy.statusCode).toBe(404);
    expect(playerLegacy.json()).toEqual(safeNotFound);

    for (const assetId of [ids.token, replacementAssetId]) {
      const gmResponse = await app.inject({
        method: "GET",
        url: contentUrl(assetId),
        headers: headers(secrets.gm),
      });
      expect(gmResponse.statusCode, gmResponse.body).toBe(200);

      const foreignResponse = await app.inject({
        method: "GET",
        url: contentUrl(assetId),
        headers: headers(foreignSecret),
      });
      expect(foreignResponse.statusCode).toBe(404);
      expect(foreignResponse.json()).toEqual(safeNotFound);
    }

    for (const secret of [secrets.gm, secrets.player]) {
      const unknownResponse = await app.inject({
        method: "GET",
        url: contentUrl(unknownAssetId),
        headers: headers(secret),
      });
      expect(unknownResponse.statusCode).toBe(404);
      expect(unknownResponse.json()).toEqual(safeNotFound);
    }
  });
});
