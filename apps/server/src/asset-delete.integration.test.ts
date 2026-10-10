import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@arken/db";

const { requireAuthMock, removeStoredUploadMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  removeStoredUploadMock: vi.fn(),
}));
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  requireAuth: requireAuthMock,
}));
vi.mock("./storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./storage.js")>()),
  removeStoredUpload: removeStoredUploadMock,
}));

import { registerAssetLifecycleRoutes } from "./asset-usage.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const campaignId = "20000000-0000-4000-8000-000000000001";
const foreignCampaignId = "20000000-0000-4000-8000-000000000002";
const gmId = "20000000-0000-4000-8000-000000000003";
const playerId = "20000000-0000-4000-8000-000000000004";
const foreignGmId = "20000000-0000-4000-8000-000000000005";
const assetId = "20000000-0000-4000-8000-000000000006";
const foreignAssetId = "20000000-0000-4000-8000-000000000007";
const contentId = "20000000-0000-4000-8000-000000000008";
const mediaId = "20000000-0000-4000-8000-000000000009";
const mapId = "20000000-0000-4000-8000-000000000010";

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: campaignId, name: "Delete test" },
    { id: foreignCampaignId, name: "Other campaign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Player" },
    { id: foreignGmId, campaignId: foreignCampaignId, role: "GM", displayName: "Other GM" },
  ]);
  await db.insert(schema.assets).values([
    { id: assetId, campaignId, uploadedByMembershipId: gmId, kind: "IMAGE", name: "Shared cover", storageKey: "delete-test/shared.webp", mimeType: "image/webp", sizeBytes: 12 },
    { id: foreignAssetId, campaignId: foreignCampaignId, uploadedByMembershipId: foreignGmId, kind: "IMAGE", name: "Foreign", storageKey: "delete-test/foreign.webp", mimeType: "image/webp", sizeBytes: 12 },
  ]);
  await db.insert(schema.worldContent).values({
    id: contentId, slug: "delete-test-content", type: "LOCATION", name: "Canon location", coverAssetId: assetId,
  });
  await db.insert(schema.worldContentMedia).values({
    id: mediaId, worldContentId: contentId, assetId, caption: "Gallery image",
  });
  await db.insert(schema.worldMaps).values({
    id: mapId,
    campaignId,
    name: "Shared map",
    lifecycle: "PUBLISHED",
    visibility: "CAMPAIGN",
    backgroundAssetId: assetId,
    backgroundAssetApprovedByMembershipId: gmId,
    backgroundAssetApprovedAt: new Date("2026-10-10T00:00:00.000Z"),
    publishedAt: new Date("2026-10-10T00:00:00.000Z"),
  });
  requireAuthMock.mockImplementation(async (request: { headers: Record<string, string> }) => {
    const role = request.headers["x-test-role"];
    if (role === "GM") return { campaignId, membershipId: gmId, role, displayName: role };
    if (role === "PLAYER") return { campaignId, membershipId: playerId, role, displayName: role };
    return null;
  });
  removeStoredUploadMock.mockReset().mockResolvedValue(undefined);
  app = Fastify();
  registerAssetLifecycleRoutes(app, db as never, {} as never, vi.fn(async () => {}));
});

afterEach(async () => {
  await app.close();
  await database.close();
  requireAuthMock.mockReset();
  removeStoredUploadMock.mockReset();
});

describe("authorized asset detach and delete", () => {
  it("cleans only dangling legacy world-content pointers before installing FKs", async () => {
    const legacy = new PGlite();
    try {
      const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
      for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql") && !name.startsWith("0057_")).sort())
        await legacy.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
      const legacyDb = drizzle(legacy, { schema });
      await legacyDb.insert(schema.campaigns).values({ id: campaignId, name: "Legacy campaign" });
      await legacyDb.insert(schema.memberships).values({ id: gmId, campaignId, role: "GM", displayName: "GM" });
      await legacyDb.insert(schema.worldContent).values({
        id: contentId, slug: "legacy-dangling-pointer", type: "LOCATION", name: "Legacy location", coverAssetId: assetId,
      });
      await legacyDb.insert(schema.worldContentInstances).values({
        id: foreignAssetId, campaignId, worldContentId: contentId, portraitAssetId: assetId,
      });
      await legacyDb.insert(schema.worldContentMedia).values({
        id: mediaId, worldContentId: contentId, assetId, caption: "Legacy orphan",
      });
      await legacy.exec((await readFile(new URL("0057_watery_jetstream.sql", migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
      const [content] = await legacyDb.select().from(schema.worldContent).where(eq(schema.worldContent.id, contentId));
      expect(content?.coverAssetId).toBeNull();
      const [instance] = await legacyDb.select().from(schema.worldContentInstances).where(eq(schema.worldContentInstances.id, foreignAssetId));
      expect(instance?.portraitAssetId).toBeNull();
      expect(await legacyDb.select().from(schema.worldContentMedia).where(eq(schema.worldContentMedia.id, mediaId))).toHaveLength(0);
      await expect(legacyDb.insert(schema.worldContentMedia).values({ worldContentId: contentId, assetId })).rejects.toThrow();
    } finally {
      await legacy.close();
    }
  });

  it("keeps global world content while atomically detaching cover and gallery references", async () => {
    const player = await app.inject({ method: "DELETE", url: `/api/assets/${assetId}`, headers: { "x-test-role": "PLAYER" } });
    expect(player.statusCode).toBe(403);
    const foreign = await app.inject({ method: "DELETE", url: `/api/assets/${foreignAssetId}`, headers: { "x-test-role": "GM" } });
    expect(foreign.statusCode).toBe(404);

    removeStoredUploadMock.mockImplementation(async () => {
      expect(await db.select().from(schema.assets).where(eq(schema.assets.id, assetId))).toHaveLength(0);
    });
    const response = await app.inject({ method: "DELETE", url: `/api/assets/${assetId}`, headers: { "x-test-role": "GM" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ assetId, deleted: true, blobCleanupPending: false });
    expect(removeStoredUploadMock).toHaveBeenCalledOnce();

    const [content] = await db.select().from(schema.worldContent).where(eq(schema.worldContent.id, contentId));
    expect(content).toMatchObject({ id: contentId, name: "Canon location", coverAssetId: null, revision: 1 });
    const [map] = await db.select().from(schema.worldMaps).where(eq(schema.worldMaps.id, mapId));
    expect(map).toMatchObject({ lifecycle: "DRAFT", backgroundAssetId: null, backgroundAssetApprovedByMembershipId: null, publishedAt: null, archivedAt: null, revision: 1 });
    expect(await db.select().from(schema.worldContentMedia).where(eq(schema.worldContentMedia.id, mediaId))).toHaveLength(0);
    const actions = await db.select().from(schema.worldContentActions).where(eq(schema.worldContentActions.entityId, contentId));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("world_content.asset_detached");
    const [deleted] = await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.type, "asset.deleted"));
    expect(deleted?.payload).toMatchObject({ assetId, detachedWorldContentCount: 1 });
  });

  it("enforces the database-level world gallery FK after the campaign asset disappears", async () => {
    const response = await app.inject({ method: "DELETE", url: `/api/assets/${assetId}`, headers: { "x-test-role": "GM" } });
    expect(response.statusCode).toBe(200);
    await expect(db.insert(schema.worldContentMedia).values({ worldContentId: contentId, assetId })).rejects.toThrow();
  });
});
