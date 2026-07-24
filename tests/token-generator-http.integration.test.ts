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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let mediaRoot: string;
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
      in: () => ({ fetchSockets: async () => [] }),
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
