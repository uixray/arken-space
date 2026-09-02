import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignGm: crypto.randomUUID(),
  scene: crypto.randomUUID(),
  used: crypto.randomUUID(),
  unused: crypto.randomUUID(),
  foreign: crypto.randomUUID(),
};
const secrets = { gm: "g".repeat(40), player: "p".repeat(40) };
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "arken-asset-lifecycle-"));
  env.MEDIA_ROOT = mediaRoot;
  for (const key of ["used.webp", "unused.webp", "foreign.webp"])
    await writeFile(join(mediaRoot, key), Buffer.from(key));
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
      displayName: "Other",
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
  await db.insert(schema.assets).values([
    {
      id: ids.used,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "MAP",
      name: "Used",
      storageKey: "used.webp",
      mimeType: "image/webp",
      sizeBytes: 9,
    },
    {
      id: ids.unused,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      kind: "IMAGE",
      name: "Unused",
      storageKey: "unused.webp",
      mimeType: "image/webp",
      sizeBytes: 11,
    },
    {
      id: ids.foreign,
      campaignId: ids.foreignCampaign,
      uploadedByMembershipId: ids.foreignGm,
      kind: "IMAGE",
      name: "Foreign",
      storageKey: "foreign.webp",
      mimeType: "image/webp",
      sizeBytes: 12,
    },
  ]);
  await db.insert(schema.scenes).values({
    id: ids.scene,
    campaignId: ids.campaign,
    name: "Secret scene",
    mapAssetId: ids.used,
    grid: {
      enabled: true,
      size: 64,
      offsetX: 0,
      offsetY: 0,
      color: "#fff",
      opacity: 0.2,
    },
  });
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
});

describe("UIX-293 asset lifecycle HTTP", () => {
  it("returns GM usage, hides foreign assets, and rejects player deletion", async () => {
    const usage = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.used}/usage`,
      headers: headers(secrets.gm),
    });
    expect(usage.statusCode, usage.body).toBe(200);
    expect(usage.json()).toMatchObject({
      inUse: true,
      canDelete: false,
      usages: [{ kind: "SCENE_BACKGROUND", label: "Secret scene" }],
    });
    const foreign = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.foreign}/usage`,
      headers: headers(secrets.gm),
    });
    expect(foreign.statusCode).toBe(404);
    const denied = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.player),
    });
    expect(denied.statusCode).toBe(403);
  });

  it("returns 409 for used content and deletes unused metadata plus blob", async () => {
    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.used}`,
      headers: headers(secrets.gm),
    });
    expect(blocked.statusCode, blocked.body).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: "ASSET_IN_USE",
      usageCount: 1,
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.gm),
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({
      assetId: ids.unused,
      deleted: true,
      blobCleanupPending: false,
    });
    const repeated = await app.inject({
      method: "DELETE",
      url: `/api/assets/${ids.unused}`,
      headers: headers(secrets.gm),
    });
    expect(repeated.statusCode).toBe(404);
    const content = await app.inject({
      method: "GET",
      url: `/api/assets/${ids.unused}/content`,
      headers: headers(secrets.gm),
    });
    expect(content.statusCode).toBe(404);
    await expect(
      readFile(join(mediaRoot, "unused.webp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
