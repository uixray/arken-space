import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@arken/db";

const { requireAuthMock } = vi.hoisted(() => ({ requireAuthMock: vi.fn() }));
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  requireAuth: requireAuthMock,
}));

import { registerAssetLifecycleRoutes } from "./asset-usage.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const campaignId = "10000000-0000-4000-8000-000000000061";
const foreignCampaignId = "10000000-0000-4000-8000-000000000066";
const gmId = "10000000-0000-4000-8000-000000000062";
const playerId = "10000000-0000-4000-8000-000000000063";
const foreignGmId = "10000000-0000-4000-8000-000000000067";
const assetId = "10000000-0000-4000-8000-000000000064";
const imageId = "10000000-0000-4000-8000-000000000068";
const foreignAssetId = "10000000-0000-4000-8000-000000000069";
const concurrentAssetA = "10000000-0000-4000-8000-000000000070";
const concurrentAssetB = "10000000-0000-4000-8000-000000000071";

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: campaignId, name: "Audio purpose test" },
    { id: foreignCampaignId, name: "Other campaign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Player" },
    { id: foreignGmId, campaignId: foreignCampaignId, role: "GM", displayName: "Other GM" },
  ]);
  await db.insert(schema.assets).values([
    { id: assetId, campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC", name: "Track", storageKey: "test/audio-purpose.ogg", mimeType: "audio/ogg", sizeBytes: 12 },
    { id: imageId, campaignId, uploadedByMembershipId: gmId, kind: "IMAGE", audioPurpose: null, name: "Image", storageKey: "test/audio-purpose.png", mimeType: "image/png", sizeBytes: 12 },
    { id: foreignAssetId, campaignId: foreignCampaignId, uploadedByMembershipId: foreignGmId, kind: "AUDIO", audioPurpose: "MUSIC", name: "Other track", storageKey: "other/audio-purpose.ogg", mimeType: "audio/ogg", sizeBytes: 12 },
    { id: concurrentAssetA, campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC", name: "Concurrent A", storageKey: "test/concurrent-a.ogg", mimeType: "audio/ogg", sizeBytes: 12 },
    { id: concurrentAssetB, campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC", name: "Concurrent B", storageKey: "test/concurrent-b.ogg", mimeType: "audio/ogg", sizeBytes: 12 },
  ]);
  await db.insert(schema.campaignAudioTracks).values({ campaignId, assetId });
  requireAuthMock.mockImplementation(async (request: { headers: Record<string, string> }) => {
    const role = request.headers["x-test-role"];
    if (role !== "GM" && role !== "PLAYER") return null;
    return { campaignId, membershipId: role === "GM" ? gmId : playerId, role, displayName: role };
  });
  app = Fastify();
  registerAssetLifecycleRoutes(app, db as never, {} as never, vi.fn(async () => {}));
});

afterEach(async () => {
  await app.close();
  await database.close();
  requireAuthMock.mockReset();
});

describe("asset audio purpose metadata route", () => {
  it("is GM-only, rejects incompatible downgrade, and audits an explicit BOTH change", async () => {
    const body = { actionId: "10000000-0000-4000-8000-000000000065", audioPurpose: "SOUND_EFFECT" };
    const playerResponse = await app.inject({ method: "PATCH", url: `/api/assets/${assetId}/audio-purpose`, headers: { "x-test-role": "PLAYER" }, payload: body });
    expect(playerResponse.statusCode).toBe(403);

    const rejected = await app.inject({ method: "PATCH", url: `/api/assets/${assetId}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: body });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({ error: "AUDIO_PURPOSE_IN_USE" });
    expect((await db.select({ audioPurpose: schema.assets.audioPurpose }).from(schema.assets).where(eq(schema.assets.id, assetId)))[0]?.audioPurpose).toBe("MUSIC");

    const foreign = await app.inject({ method: "PATCH", url: `/api/assets/${foreignAssetId}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { ...body, audioPurpose: "BOTH" } });
    expect(foreign.statusCode).toBe(404);
    const nonAudio = await app.inject({ method: "PATCH", url: `/api/assets/${imageId}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { ...body, audioPurpose: "BOTH" } });
    expect(nonAudio.statusCode).toBe(400);

    const updated = await app.inject({ method: "PATCH", url: `/api/assets/${assetId}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { ...body, audioPurpose: "BOTH" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().audioPurpose).toBe("BOTH");
    const events = await db.select().from(schema.gameEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("asset.audio_purpose_changed");
    expect(events[0]?.payload).toMatchObject({ assetId, audioPurpose: "BOTH" });

    const replay = await app.inject({ method: "PATCH", url: `/api/assets/${assetId}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { ...body, audioPurpose: "BOTH" } });
    expect(replay.statusCode).toBe(200);
    const reusedAction = await app.inject({ method: "PATCH", url: `/api/assets/${assetId}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { ...body, audioPurpose: "MUSIC" } });
    expect(reusedAction.statusCode).toBe(409);
    expect(reusedAction.json()).toEqual({ error: "ACTION_ID_CONFLICT" });

    const concurrentActionId = "10000000-0000-4000-8000-000000000072";
    const [concurrentA, concurrentB] = await Promise.all([
      app.inject({ method: "PATCH", url: `/api/assets/${concurrentAssetA}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { actionId: concurrentActionId, audioPurpose: "BOTH" } }),
      app.inject({ method: "PATCH", url: `/api/assets/${concurrentAssetB}/audio-purpose`, headers: { "x-test-role": "GM" }, payload: { actionId: concurrentActionId, audioPurpose: "SOUND_EFFECT" } }),
    ]);
    expect([concurrentA.statusCode, concurrentB.statusCode].sort()).toEqual([200, 409]);
    const concurrentEvents = await db.select().from(schema.gameEvents).where(eq(schema.gameEvents.actionId, concurrentActionId));
    expect(concurrentEvents).toHaveLength(1);
  });
});
