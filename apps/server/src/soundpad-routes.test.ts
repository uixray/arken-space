import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@arken/db";
import type { AuthContext } from "./auth.js";
import { resolveAssetUsages } from "./asset-usage.js";
import { registerSoundpadRoutes } from "./soundpad-routes.js";

let database: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
let campaignId: string;
let gmId: string;
let playerId: string;
let audioId: string;
let musicAudioId: string;
let imageId: string;
let foreignAudioId: string;
let gm: AuthContext;
let player: AuthContext;
let identity: "gm" | "player" | null;
let emit: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  campaignId = crypto.randomUUID();
  const foreignCampaignId = crypto.randomUUID();
  gmId = crypto.randomUUID();
  playerId = crypto.randomUUID();
  const foreignMembershipId = crypto.randomUUID();
  audioId = crypto.randomUUID();
  musicAudioId = crypto.randomUUID();
  imageId = crypto.randomUUID();
  foreignAudioId = crypto.randomUUID();
  gm = { campaignId, membershipId: gmId, role: "GM", displayName: "GM" };
  player = { campaignId, membershipId: playerId, role: "PLAYER", displayName: "Player" };
  identity = null;
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: campaignId, name: "Soundpad test" },
    { id: foreignCampaignId, name: "Other campaign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Player" },
    { id: foreignMembershipId, campaignId: foreignCampaignId, role: "GM", displayName: "Other GM" },
  ]);
  await db.insert(schema.assets).values([
    { id: audioId, campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "clip.ogg", storageKey: "soundpad/audio.ogg", mimeType: "audio/ogg", sizeBytes: 12, durationSeconds: 2 },
    { id: musicAudioId, campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC", name: "music.ogg", storageKey: "soundpad/music.ogg", mimeType: "audio/ogg", sizeBytes: 12, durationSeconds: 80 },
    { id: imageId, campaignId, uploadedByMembershipId: gmId, kind: "IMAGE", name: "image.png", storageKey: "soundpad/image.png", mimeType: "image/png", sizeBytes: 12 },
    { id: foreignAudioId, campaignId: foreignCampaignId, uploadedByMembershipId: foreignMembershipId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "foreign.ogg", storageKey: "soundpad/foreign.ogg", mimeType: "audio/ogg", sizeBytes: 12, durationSeconds: 2 },
  ]);
  app = Fastify();
  const getSession = async () => identity === "gm" ? gm : identity === "player" ? player : null;
  emit = vi.fn();
  const io = { to: () => ({ emit }) } as never;
  registerSoundpadRoutes(app, db as never, io, getSession as never);
});

afterEach(async () => {
  if (app) await app.close();
  if (database) await database.close();
});

describe("Soundpad routes", () => {
  it("requires authentication and enforces GM, campaign, media type, and duration boundaries", async () => {
    const unauthenticated = await app.inject({ method: "POST", url: "/api/soundpad/packs", payload: { name: "Pack" } });
    expect(unauthenticated.statusCode).toBe(401);
    identity = "player";
    const playerMutation = await app.inject({ method: "POST", url: "/api/soundpad/packs", payload: { name: "Pack" } });
    expect(playerMutation.statusCode).toBe(403);
    identity = "gm";
    const pack = await app.inject({ method: "POST", url: "/api/soundpad/packs", payload: { name: "Pack" } });
    expect(pack.statusCode).toBe(201);
    expect(emit).toHaveBeenCalledWith("soundpad:catalog:changed");
    const packId = pack.json().packId as string;
    const body = { assetId: audioId, label: "Laugh" };
    const sound = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/sounds`, payload: body });
    expect(sound.statusCode).toBe(201);
    const wrongPurpose = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/sounds`, payload: { ...body, assetId: musicAudioId } });
    expect(wrongPurpose.statusCode).toBe(400);
    expect(wrongPurpose.json()).toEqual({ error: "SOUND_EFFECT_PURPOSE_REQUIRED" });
    expect((await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/sounds`, payload: { ...body, assetId: imageId } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/sounds`, payload: { ...body, assetId: foreignAudioId } })).statusCode).toBe(400);
    const [longAudio] = await db.insert(schema.assets).values({ campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "SOUND_EFFECT", name: "long.ogg", storageKey: "soundpad/long.ogg", mimeType: "audio/ogg", sizeBytes: 12, durationSeconds: 10.1 }).returning();
    if (!longAudio) throw new Error("fixture asset insert failed");
    expect((await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/sounds`, payload: { ...body, assetId: longAudio.id } })).statusCode).toBe(400);
  });

  it("filters unpublished and GM-only content for players and blocks deletion of referenced audio", async () => {
    identity = "gm";
    const response = await app.inject({ method: "POST", url: "/api/soundpad/packs", payload: { name: "Private sounds" } });
    const packId = response.json().packId as string;
    await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/sounds`, payload: { assetId: audioId, label: "GM laugh", audience: "GM_ONLY" } });
    identity = "player";
    const hidden = await app.inject({ method: "GET", url: "/api/soundpad" });
    expect(hidden.json().packs).toHaveLength(0);
    identity = "gm";
    await app.inject({ method: "PATCH", url: `/api/soundpad/packs/${packId}`, payload: { published: true } });
    identity = "player";
    const visiblePack = await app.inject({ method: "GET", url: "/api/soundpad" });
    expect(visiblePack.json().packs).toHaveLength(1);
    expect(visiblePack.json().packs[0].sounds).toHaveLength(0);
    const usages = await resolveAssetUsages(db as never, campaignId, audioId);
    expect(usages).toEqual([expect.objectContaining({ kind: "CAMPAIGN_SOUND", deletionPolicy: "BLOCK" })]);
  });
});
