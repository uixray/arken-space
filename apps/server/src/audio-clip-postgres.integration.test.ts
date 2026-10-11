import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, mkdir, unlink, mkdtemp, rm } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type LightMyRequestResponse } from "fastify";
import { createDatabase } from "@arken/db";
import { assets, audioClipCandidates, audioClipProvenance, campaignMediaReservations, campaignSounds, campaignSoundPacks, campaigns, memberships } from "@arken/db";
import { and, eq, sum } from "drizzle-orm";
import * as audioCodec from "./audio-clip-codec.js";
import { assetContentVersion } from "./asset-lifecycle.js";
import { estimatePcmWavBytes } from "./audio-clip-lifecycle.js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "./auth.js";
import { cleanupExpiredAudioClipCandidates, registerAudioClipRoutes } from "./audio-clip-routes.js";
import { registerSoundpadRoutes } from "./soundpad-routes.js";
import { lockCampaignMediaQuota, reserveCampaignMediaBytes, requireLiveCampaignMediaReservation } from "./media-quota-reservations.js";
import { env } from "./env.js";

const pgUrl = process.env.AUDIO_CLIP_PG_URL;
const pgContainerId = process.env.AUDIO_CLIP_PG_CONTAINER_ID;
const pgDescribe = pgUrl ? describe : describe.skip;
const mediaDir = resolve(process.env.MEDIA_ROOT ?? "./media");
let resources: ReturnType<typeof createDatabase>;
let client: ReturnType<typeof createDatabase>["client"];
let db: ReturnType<typeof createDatabase>["db"];
let app: ReturnType<typeof Fastify>;
let campaignId: string;
let gmId: string;
let otherGmId: string;
let playerId: string;
let foreignCampaignId: string;
let foreignGmId: string;
let foreignPackId: string;
let packId: string;
let actor: AuthContext | null;
const fixtureKeys: string[] = [];

function requireDedicatedLoopback(value: string) {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!(parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") ||
      !name.startsWith("arken_audio_clip_qa_") || !parsed.username.startsWith("clipqa"))
    throw new Error("AUDIO_CLIP_PG_URL must use loopback and a dedicated arken_audio_clip_qa_ database with a synthetic clipqa role");
  return value;
}

function runPostgresContainerTool(containerId: string, args: string[], input?: Buffer): Buffer {
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("Recovery fixture requires an exact full container ID");
  try {
    return execFileSync("docker", ["exec", ...(input ? ["-i"] : []), containerId, ...args], {
      input,
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    }) as Buffer;
  } catch {
    throw new Error("Isolated PostgreSQL dump/restore fixture command failed");
  }
}

async function applyFreshMigrations() {
  const folder = new URL("../../../packages/db/drizzle/", import.meta.url);
  const files = (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const contents = await readFile(new URL(file, folder), "utf8");
    for (const statement of contents.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean))
      await client.unsafe(statement);
  }
}

function wavFixture(sampleRate = 44_100, frames = 4410) {
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 0.1) * 12_000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForAdvisoryLockWaiter(campaignId: string) {
  const deadline = Date.now() + 5_000;
  const [keyRow] = await client`SELECT hashtext(${campaignId}) AS lock_key`;
  const key64 = BigInt.asUintN(64, BigInt(keyRow!.lock_key));
  const classId = Number((key64 >> 32n) & 0xffff_ffffn);
  const objectId = Number(key64 & 0xffff_ffffn);
  while (Date.now() < deadline) {
    const [row] = await client`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = ${classId}::oid AND objid = ${objectId}::oid AND objsubid = 1`;
    if (Number(row?.count ?? 0) > 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("Timed out waiting for the campaign-scoped PostgreSQL advisory-lock waiter");
}

async function waitForTransactionLockWaiter() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await client`SELECT count(*)::int AS count FROM pg_locks AS locks
      JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
      WHERE locks.locktype = 'transactionid' AND NOT locks.granted AND activity.datname = current_database()
      AND lower(activity.query) LIKE 'update "audio_clip_candidates" set "status"%'`;
    if (Number(row?.count ?? 0) > 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error("Timed out waiting for the PostgreSQL row-update transaction lock");
}

async function seed() {
  const [campaign] = await db.insert(campaigns).values({ name: `clip qa ${randomUUID()}` }).returning({ id: campaigns.id });
  campaignId = campaign!.id;
  const rows = await db.insert(memberships).values([
    { campaignId, role: "GM", displayName: "QA GM" },
    { campaignId, role: "GM", displayName: "Other QA GM" },
    { campaignId, role: "PLAYER", displayName: "QA Player" },
  ]).returning({ id: memberships.id });
  gmId = rows[0]!.id; otherGmId = rows[1]!.id; playerId = rows[2]!.id;
  const [pack] = await db.insert(campaignSoundPacks).values({ campaignId, name: `qa-${randomUUID().slice(0, 8)}` }).returning({ id: campaignSoundPacks.id });
  packId = pack!.id;
  const [foreignCampaign] = await db.insert(campaigns).values({ name: `foreign clip qa ${randomUUID()}` }).returning({ id: campaigns.id });
  foreignCampaignId = foreignCampaign!.id;
  const [foreignMembership] = await db.insert(memberships).values({ campaignId: foreignCampaignId, role: "GM", displayName: "Foreign QA GM" }).returning({ id: memberships.id });
  foreignGmId = foreignMembership!.id;
  const [foreignPack] = await db.insert(campaignSoundPacks).values({ campaignId: foreignCampaignId, name: `foreign-${randomUUID().slice(0, 8)}` }).returning({ id: campaignSoundPacks.id });
  foreignPackId = foreignPack!.id;
  actor = { campaignId, membershipId: gmId, role: "GM", displayName: "QA GM" };
}

async function insertCandidate(status: "READY" = "READY") {
  const storageKey = `uix512-${randomUUID()}.wav`;
  const bytes = wavFixture();
  await mkdir(mediaDir, { recursive: true });
  await writeFile(resolve(mediaDir, storageKey), bytes, { flag: "wx" });
  fixtureKeys.push(storageKey);
  const sourceKey = `uix512-source-${randomUUID()}.wav`;
  await writeFile(resolve(mediaDir, sourceKey), bytes, { flag: "wx" });
  fixtureKeys.push(sourceKey);
  const [source] = await db.insert(assets).values({
    campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC",
    name: "QA original", storageKey: sourceKey, mimeType: "audio/wav", sizeBytes: bytes.length, durationSeconds: 0.1,
  }).returning({ id: assets.id });
  const actionId = randomUUID();
  const [candidate] = await db.insert(audioClipCandidates).values({
    campaignId, creatorMembershipId: gmId, sourceAssetId: source!.id, actionId,
    intentHash: "qa-intent", sourceVersion: "sha256:qa", startMs: 0, endMs: 50,
    status, reservedBytes: bytes.length, storageKey, sizeBytes: bytes.length,
    sampleRate: 44_100, channels: 1, frames: 2_205, actualStartFrame: 0, actualEndFrame: 2_205,
    actualStartMs: 0, actualEndMs: 50, expiresAt: new Date(Date.now() + 60_000),
  }).returning();
  await db.insert(campaignMediaReservations).values({ campaignId, requestKey: `audio-clip:${actionId}`, reservedBytes: bytes.length, expiresAt: new Date(Date.now() + 60_000) });
  return { sourceId: source!.id, candidate: candidate!, bytes };
}

pgDescribe("audio clips — bounded PostgreSQL gate", () => {
  beforeAll(async () => {
    resources = createDatabase(requireDedicatedLoopback(pgUrl!));
    client = resources.client; db = resources.db;
    await applyFreshMigrations();
  }, 60_000);

  beforeEach(async () => {
    await seed();
    app = Fastify({ logger: false });
    const getSession = async (request: { headers: Record<string, string | string[] | undefined> }) => {
      const requestedCampaign = request.headers["x-qa-campaign"];
      if (requestedCampaign === foreignCampaignId) {
        actor = { campaignId: foreignCampaignId, membershipId: foreignGmId, role: "GM", displayName: "Foreign QA GM" };
      } else {
      const requested = request.headers["x-qa-membership"];
      if (requested === otherGmId) actor = { campaignId, membershipId: otherGmId, role: "GM", displayName: "Other QA GM" };
      else if (requested === playerId) actor = { campaignId, membershipId: playerId, role: "PLAYER", displayName: "QA Player" };
      else actor = { campaignId, membershipId: gmId, role: "GM", displayName: "QA GM" };
      }
      return actor;
    };
    registerAudioClipRoutes(app as never, db as never, { to: () => ({ emit() {} }) } as never, getSession as never);
    registerSoundpadRoutes(app as never, db as never, { to: () => ({ emit() {} }) } as never, getSession as never);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await client?.end({ timeout: 2 });
  });

  afterEach(async () => {
    await app?.close();
    if (campaignId) await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    if (foreignCampaignId) await db.delete(campaigns).where(eq(campaigns.id, foreignCampaignId));
    await Promise.all(fixtureKeys.splice(0).map((key) => unlink(resolve(mediaDir, key)).catch(() => undefined)));
  });

  it("returns PROCESSING_OUTPUT_LIMIT and releases the reservation when mocked codec output exceeds its bound", async () => {
    const sourceKey = `uix512-oversize-source-${randomUUID()}.wav`;
    const sourceBytes = wavFixture(48_000, 144_000);
    await mkdir(mediaDir, { recursive: true });
    await writeFile(resolve(mediaDir, sourceKey), sourceBytes, { flag: "wx" });
    fixtureKeys.push(sourceKey);
    const [source] = await db.insert(assets).values({
      campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC",
      name: "QA oversize source", storageKey: sourceKey, mimeType: "audio/wav", sizeBytes: sourceBytes.length, durationSeconds: 3,
    }).returning({ id: assets.id });

    const profile = { sampleRate: 48_000, channels: 1, frames: 0, durationMs: 0, sampleFormat: "s16" as const };
    const decoded = { frames: 144_000, durationMs: 3_000, peaks: Array.from({ length: 64 }, () => 0) };
    const reservedBytes = estimatePcmWavBytes({ ...profile, ...decoded }, 300, 1_300);
    const overReservation = Buffer.alloc(reservedBytes + 1);
    const inspectSpy = vi.spyOn(audioCodec, "inspectAudioSource").mockImplementation(async (input) => { input.destroy(); return profile; });
    const decodeSpy = vi.spyOn(audioCodec, "decodeWaveform").mockImplementation(async (input) => { input.destroy(); return decoded; });
    const renderSpy = vi.spyOn(audioCodec, "renderPcmClip").mockImplementation(async (input) => {
      input.destroy();
      return { buffer: overReservation, range: {
        startMs: 300, endMs: 1_300, actualStartMs: 300, actualEndMs: 1_300,
        actualStartFrame: 14_400, actualEndFrame: 62_400, sampleRate: 48_000, channels: 1, frames: 48_000,
      } };
    });
    const actionId = randomUUID();
    try {
      const response = await app.inject({
        method: "POST", url: `/api/assets/${source!.id}/audio-clip-preview`,
        payload: { actionId, sourceVersion: assetContentVersion(sourceKey), startMs: 300, endMs: 1_300 },
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toEqual({ error: "PROCESSING_OUTPUT_LIMIT" });
      expect(renderSpy).toHaveBeenCalledOnce();
      const [candidate] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.actionId, actionId)).limit(1);
      expect(candidate?.status).toBe("FAILED");
      expect(candidate?.reservedBytes).toBe(0);
      const [reservation] = await db.select().from(campaignMediaReservations).where(and(
        eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, `audio-clip:${actionId}`),
      )).limit(1);
      expect(reservation).toBeUndefined();
    } finally {
      inspectSpy.mockRestore(); decodeSpy.mockRestore(); renderSpy.mockRestore();
    }
  }, 30_000);
  it("preserves cancellation when the in-flight codec fails after DELETE", async () => {
    const fixture = await insertCandidate();
    await db.delete(audioClipCandidates).where(eq(audioClipCandidates.id, fixture.candidate.id));
    await db.delete(campaignMediaReservations).where(eq(campaignMediaReservations.campaignId, campaignId));
    const [source] = await db.select().from(assets).where(eq(assets.id, fixture.sourceId));
    const entered = deferred();
    const finishCodec = deferred();
    const inspectSpy = vi.spyOn(audioCodec, "inspectAudioSource").mockImplementation(async (input) => {
      input.destroy();
      return { sampleRate: 44_100, channels: 1, frames: 0, durationMs: 0, sampleFormat: "s16" };
    });
    const decodeSpy = vi.spyOn(audioCodec, "decodeWaveform").mockImplementation(async (input) => {
      input.destroy(); return { frames: 4410, durationMs: 100, peaks: [0] };
    });
    const renderSpy = vi.spyOn(audioCodec, "renderPcmClip").mockImplementation(async (input) => {
      input.destroy(); entered.resolve(); await finishCodec.promise;
      throw new Error("PROCESSING_OUTPUT_LIMIT");
    });
    const actionId = randomUUID();
    const pending = app.inject({ method: "POST", url: `/api/assets/${fixture.sourceId}/audio-clip-preview`,
      payload: { actionId, sourceVersion: assetContentVersion(source!.storageKey), startMs: 0, endMs: 50 },
    }).then((response: LightMyRequestResponse) => response);
    try {
      await entered.promise;
      const [processing] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.actionId, actionId));
      expect(processing?.status).toBe("PROCESSING");
      const cancelled = await app.inject({ method: "DELETE", url: `/api/audio-clip-previews/${processing!.id}` });
      expect(cancelled.statusCode).toBe(204);
      finishCodec.resolve();
      const response = await pending;
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "CANDIDATE_EXPIRED" });
      const [terminal] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.id, processing!.id));
      expect(terminal?.status).toBe("CANCELLED");
      expect(terminal?.reservedBytes).toBe(0);
      expect(terminal?.storageKey).toBeNull();
      expect(await db.select().from(campaignMediaReservations).where(and(
        eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, `audio-clip:${actionId}`),
      ))).toHaveLength(0);
    } finally {
      finishCodec.resolve(); await pending;
      inspectSpy.mockRestore(); decodeSpy.mockRestore(); renderSpy.mockRestore();
    }
  }, 30_000);

  it("serializes two quota reservations and never commits an expired lease", async () => {
    const quota = Number(process.env.MEDIA_QUOTA_BYTES);
    expect(Number.isInteger(quota) && quota > 2 && quota <= 1_048_576).toBe(true);
    const [usageRow] = await db.select({ bytes: sum(assets.sizeBytes) }).from(assets).where(eq(assets.campaignId, campaignId));
    const [reservationRow] = await db.select({ bytes: sum(campaignMediaReservations.reservedBytes) })
      .from(campaignMediaReservations).where(eq(campaignMediaReservations.campaignId, campaignId));
    const usedBytes = Number(usageRow?.bytes ?? 0);
    const reservedBytes = Number(reservationRow?.bytes ?? 0);
    expect({ usedBytes, reservedBytes, quotaBytes: quota }).toEqual({ usedBytes: 0, reservedBytes: 0, quotaBytes: 1_048_576 });
    const actionKeys = [randomUUID(), randomUUID()];
    const outcomes = await Promise.allSettled([
      reserveCampaignMediaBytes(db, campaignId, `qa:${actionKeys[0]}`, quota - 1),
      reserveCampaignMediaBytes(db, campaignId, `qa:${actionKeys[1]}`, 2),
    ]);
    const fulfilled = outcomes.filter((result) => result.status === "fulfilled");
    const rejected = outcomes.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect({ usedBytes, reservedBytes, quotaBytes: quota, fulfilled: fulfilled.length,
      rejectionCodes: rejected.map(({ reason }) => reason instanceof Error ? reason.message : "unknown") })
      .toEqual({ usedBytes: 0, reservedBytes: 0, quotaBytes: 1_048_576, fulfilled: 1, rejectionCodes: ["MEDIA_QUOTA_EXCEEDED"] });
    const winnerIndex = outcomes.findIndex((result) => result.status === "fulfilled");
    if (winnerIndex >= 0) {
      const requestKey = `qa:${actionKeys[winnerIndex]}`;
      await db.update(campaignMediaReservations).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, requestKey)));
      await expect(db.transaction(async (tx) => {
        await lockCampaignMediaQuota(tx, campaignId);
        await requireLiveCampaignMediaReservation(tx, campaignId, requestKey);
      })).rejects.toThrow("MEDIA_QUOTA_EXCEEDED");
    }
  }, 30_000);

  it("rejects a final commit larger than its live reservation in the real database", async () => {
    const requestKey = `qa:oversize:${randomUUID()}`;
    await reserveCampaignMediaBytes(db, campaignId, requestKey, 100);
    await expect(db.transaction(async (tx) => {
      await lockCampaignMediaQuota(tx, campaignId);
      await requireLiveCampaignMediaReservation(tx, campaignId, requestKey, 101);
    })).rejects.toThrow("MEDIA_QUOTA_EXCEEDED");
    const [reservation] = await db.select().from(campaignMediaReservations).where(and(
      eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, requestKey),
    ));
    expect(reservation?.reservedBytes).toBe(100);
  }, 30_000);

  it("serializes replacement credit against competing replacements and uploads", async () => {
    const { sourceId } = await insertCandidate();
    await db.delete(campaignMediaReservations).where(eq(campaignMediaReservations.campaignId, campaignId));
    const [source] = await db.select().from(assets).where(eq(assets.id, sourceId));
    await db.insert(assets).values({ campaignId, uploadedByMembershipId: gmId, kind: "IMAGE", name: "Quota filler",
      storageKey: `quota-filler-${randomUUID()}`, mimeType: "image/webp", sizeBytes: env.MEDIA_QUOTA_BYTES - source!.sizeBytes });
    const results = await Promise.allSettled(["a", "b"].map((key) => reserveCampaignMediaBytes(
      db, campaignId, `replacement-credit:${key}`, source!.sizeBytes, { assetId: sourceId, storageKey: source!.storageKey },
    )));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(reserveCampaignMediaBytes(db, campaignId, "competing-upload", 1)).rejects.toThrow("MEDIA_QUOTA_EXCEEDED");
    await expect(reserveCampaignMediaBytes(db, campaignId, "stale-credit", 1,
      { assetId: sourceId, storageKey: "stale-source" })).rejects.toThrow("ASSET_VERSION_CONFLICT");
    expect(await db.select().from(campaignMediaReservations).where(eq(campaignMediaReservations.campaignId, campaignId))).toHaveLength(1);
  }, 30_000);

  it("hides preview and save replay from a different GM in the same campaign", async () => {
    const { candidate } = await insertCandidate();
    const preview = await app.inject({ url: `/api/audio-clip-previews/${candidate.id}`, headers: { "x-qa-membership": otherGmId } });
    expect(preview.statusCode).toBe(404);
    const request = { actionId: randomUUID(), candidateId: candidate.id, label: "QA clip", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" };
    await db.update(audioClipCandidates).set({ saveActionId: request.actionId, saveIntentHash: "prior-save" }).where(eq(audioClipCandidates.id, candidate.id));
    const save = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request, headers: { "x-qa-membership": otherGmId } });
    expect(save.statusCode).toBe(404);
  }, 30_000);

  it("denies PLAYER preview status/content/delete/save access without mutating the candidate", async () => {
    const { sourceId, candidate } = await insertCandidate();
    const headers = { "x-qa-membership": playerId };
    const previewCreate = await app.inject({ method: "POST", url: `/api/assets/${sourceId}/audio-clip-preview`, headers,
      payload: { actionId: randomUUID(), sourceVersion: "sha256:qa", startMs: 0, endMs: 50 } });
    expect(previewCreate.statusCode).toBe(403);
    expect((await app.inject({ url: `/api/audio-clip-previews/${candidate.id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/audio-clip-previews/${candidate.id}/content`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/audio-clip-previews/${candidate.id}`, headers })).statusCode).toBe(404);
    const save = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, headers,
      payload: { actionId: randomUUID(), candidateId: candidate.id, label: "Player forbidden", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" } });
    expect(save.statusCode).toBe(403);
    const [unchanged] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.id, candidate.id));
    expect(unchanged?.status).toBe("READY");
  }, 30_000);

  it("does not disclose preview or save action replays across campaigns", async () => {
    const { sourceId, candidate, bytes } = await insertCandidate();
    const saveActionId = randomUUID();
    await db.update(audioClipCandidates).set({ saveActionId, saveIntentHash: "prior-save" }).where(eq(audioClipCandidates.id, candidate.id));
    const headers = { "x-qa-campaign": foreignCampaignId };
    expect((await app.inject({ url: `/api/assets/${sourceId}/audio-analysis`, headers })).statusCode).toBe(404);
    for (const [method, suffix] of [["GET", ""], ["GET", "/content"], ["DELETE", ""]] as const) {
      const denied = await app.inject({ method, url: `/api/audio-clip-previews/${candidate.id}${suffix}`, headers });
      expect(denied.statusCode).toBe(404);
      expect(denied.json()).toEqual({ error: "CANDIDATE_NOT_FOUND" });
    }
    const [afterForeign] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.id, candidate.id));
    expect(afterForeign?.status).toBe("READY");
    expect(afterForeign?.storageKey).toBe(candidate.storageKey);
    expect((await app.inject({ url: `/api/audio-clip-previews/${candidate.id}` })).statusCode).toBe(200);
    const ownContent = await app.inject({ url: `/api/audio-clip-previews/${candidate.id}/content` });
    expect(ownContent.statusCode).toBe(200);
    expect(ownContent.rawPayload).toEqual(bytes);
    const preview = await app.inject({ method: "POST", url: `/api/assets/${sourceId}/audio-clip-preview`, headers,
      payload: { actionId: candidate.actionId, sourceVersion: "sha256:qa", startMs: 0, endMs: 50 } });
    expect(preview.statusCode).toBe(404);
    expect(preview.json()).toEqual({ error: "SOURCE_NOT_FOUND" });
    const save = await app.inject({ method: "POST", url: `/api/soundpad/packs/${foreignPackId}/clips`, headers,
      payload: { actionId: saveActionId, candidateId: candidate.id, label: "Foreign probe", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" } });
    expect(save.statusCode).toBe(410);
    expect(save.json()).toEqual({ error: "CANDIDATE_EXPIRED" });
    expect(JSON.stringify([preview.json(), save.json()])).not.toContain("candidateId");
  }, 30_000);

  it("projects GM_ONLY sound and pack out of the PLAYER soundpad response", async () => {
    const { candidate } = await insertCandidate();
    await db.update(campaignSoundPacks).set({ published: true, audience: "ALL_MEMBERS" }).where(eq(campaignSoundPacks.id, packId));
    const saved = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: {
      actionId: randomUUID(), candidateId: candidate.id, label: "GM-only projection", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY",
    } });
    expect(saved.statusCode).toBe(201);
    const [hiddenPack] = await db.insert(campaignSoundPacks).values({ campaignId, name: `gm-only-${randomUUID().slice(0, 8)}`, published: true, audience: "GM_ONLY" }).returning({ id: campaignSoundPacks.id });
    const gm = await app.inject({ url: "/api/soundpad" });
    expect(gm.statusCode).toBe(200);
    expect(gm.json().packs.flatMap((pack: { sounds: Array<{ id: string }> }) => pack.sounds).some((sound: { id: string }) => sound.id === saved.json().sound.id)).toBe(true);
    expect(gm.json().packs.some((pack: { id: string }) => pack.id === hiddenPack!.id)).toBe(true);
    const player = await app.inject({ url: "/api/soundpad", headers: { "x-qa-membership": playerId } });
    expect(player.statusCode).toBe(200);
    expect(player.json().packs.some((pack: { id: string }) => pack.id === hiddenPack!.id)).toBe(false);
    const visiblePack = player.json().packs.find((pack: { id: string }) => pack.id === packId);
    expect(visiblePack).toBeTruthy();
    expect(visiblePack.sounds).toEqual([]);
  }, 30_000);

  it("rejects save for an already-expired candidate during cleanup and reclaims its lease/blob", async () => {
    const { candidate } = await insertCandidate();
    await db.update(audioClipCandidates).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(audioClipCandidates.id, candidate.id));
    const save = app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: {
      actionId: randomUUID(), candidateId: candidate.id, label: "Expired attempt", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY",
    } });
    const cleanup = cleanupExpiredAudioClipCandidates(db);
    const [saveResponse, cleaned] = await Promise.all([save, cleanup]);
    expect(saveResponse.statusCode).toBe(410);
    expect(cleaned).toBeGreaterThanOrEqual(1);
    const [expired] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.id, candidate.id));
    expect(expired?.status).toBe("EXPIRED");
    expect(expired?.reservedBytes).toBe(0);
    expect(expired?.storageKey).toBe(candidate.storageKey);
    const [reservation] = await db.select().from(campaignMediaReservations).where(and(
      eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, `audio-clip:${candidate.actionId}`),
    ));
    expect(reservation).toBeUndefined();
    await expect(readFile(resolve(mediaDir, candidate.storageKey!))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await app.inject({ url: `/api/audio-clip-previews/${candidate.id}/content` })).toMatchObject({ statusCode: 404 });
  }, 30_000);

  it("denies save after committed expiry while cleanup waits behind the campaign lock", async () => {
    const { candidate } = await insertCandidate();
    const request = { actionId: randomUUID(), candidateId: candidate.id, label: "Expiry wins", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" };
    expect(candidate.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const expiredAt = new Date(Date.now() - 1_000);
    await db.update(audioClipCandidates).set({ expiresAt: expiredAt }).where(eq(audioClipCandidates.id, candidate.id));
    const [committedExpiry] = await db.select({ expiresAt: audioClipCandidates.expiresAt }).from(audioClipCandidates).where(eq(audioClipCandidates.id, candidate.id));
    expect(committedExpiry!.expiresAt.getTime()).toBeLessThan(Date.now());
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const lockHolder = client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${campaignId}))`;
      await tx`SELECT id FROM audio_clip_candidates WHERE id = ${candidate.id} FOR UPDATE`;
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;
    let cleanupPromise: Promise<number> | undefined;
    let savePromise: ReturnType<typeof app.inject> | undefined;
    try {
      cleanupPromise = cleanupExpiredAudioClipCandidates(db);
      await waitForTransactionLockWaiter();
      savePromise = app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request });
      await waitForAdvisoryLockWaiter(campaignId);
    } finally {
      releaseLock.resolve();
      await lockHolder;
      await Promise.allSettled([cleanupPromise, savePromise].filter((promise): promise is Promise<unknown> => Boolean(promise)));
    }
    const [cleaned, response] = await Promise.all([cleanupPromise!, savePromise!]);
    expect(cleaned).toBe(1);
    expect(response.statusCode).toBe(410);
    const [expired] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.id, candidate.id));
    expect(expired?.status).toBe("EXPIRED");
    expect(expired?.reservedBytes).toBe(0);
    expect(await app.inject({ url: `/api/audio-clip-previews/${candidate.id}/content` })).toMatchObject({ statusCode: 404 });
    const [reservation] = await db.select().from(campaignMediaReservations).where(and(
      eq(campaignMediaReservations.campaignId, campaignId), eq(campaignMediaReservations.requestKey, `audio-clip:${candidate.actionId}`),
    ));
    expect(reservation).toBeUndefined();
    await expect(readFile(resolve(mediaDir, candidate.storageKey!))).rejects.toMatchObject({ code: "ENOENT" });
    const sounds = await db.select().from(campaignSounds).where(eq(campaignSounds.campaignId, campaignId));
    expect(sounds).toHaveLength(0);
  }, 30_000);

  it("lets a live save win the campaign lock before cleanup and preserves its receipt/blob", async () => {
    const { candidate, bytes } = await insertCandidate();
    const request = { actionId: randomUUID(), candidateId: candidate.id, label: "Save wins cleanup", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" };
    const lockAcquired = deferred();
    const releaseLock = deferred();
    const lockHolder = client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${campaignId}))`;
      lockAcquired.resolve();
      await releaseLock.promise;
    });
    await lockAcquired.promise;
    let savePromise: ReturnType<typeof app.inject> | undefined;
    try {
      savePromise = app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request });
      await waitForAdvisoryLockWaiter(campaignId);
      expect(await cleanupExpiredAudioClipCandidates(db)).toBe(0);
      await expect(readFile(resolve(mediaDir, candidate.storageKey!))).resolves.toEqual(bytes);
    } finally {
      releaseLock.resolve();
      await lockHolder;
      await Promise.allSettled([savePromise].filter((promise): promise is Promise<unknown> => Boolean(promise)));
    }
    const response = await savePromise!;
    expect(response.statusCode).toBe(201);
    const savedAssetId = response.json().sound.assetId as string;
    const [savedCandidate] = await db.select().from(audioClipCandidates).where(eq(audioClipCandidates.id, candidate.id));
    expect(savedCandidate?.status).toBe("SAVED");
    expect(savedCandidate?.saveActionId).toBe(request.actionId);
    await db.update(audioClipCandidates).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(audioClipCandidates.id, candidate.id));
    expect(await cleanupExpiredAudioClipCandidates(db)).toBe(0);
    const replay = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().sound.assetId).toBe(savedAssetId);
    const [asset] = await db.select().from(assets).where(eq(assets.id, savedAssetId));
    expect(asset?.audioPurpose).toBe("SOUND_EFFECT");
    expect(await readFile(resolve(mediaDir, candidate.storageKey!))).toEqual(bytes);
  }, 30_000);

  it("saves a separate SOUND_EFFECT derivative and keeps it after source deletion", async () => {
    const { sourceId, candidate, bytes } = await insertCandidate();
    const request = { actionId: randomUUID(), candidateId: candidate.id, label: "Saved QA clip", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" };
    const response = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request });
    expect(response.statusCode).toBe(201);
    const result = response.json();
    const [derivative] = await db.select().from(assets).where(eq(assets.id, result.sound.assetId));
    expect(derivative).toMatchObject({ kind: "AUDIO", audioPurpose: "SOUND_EFFECT", sizeBytes: bytes.length });
    const replay = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().sound.assetId).toBe(derivative!.id);
    const [original] = await db.select().from(assets).where(eq(assets.id, sourceId));
    expect(original?.audioPurpose).toBe("MUSIC");
    expect(await readFile(resolve(mediaDir, original!.storageKey))).toEqual(bytes);
    await db.delete(assets).where(eq(assets.id, sourceId));
    const [survivor] = await db.select().from(assets).where(eq(assets.id, derivative!.id));
    const [provenance] = await db.select().from(audioClipProvenance).where(eq(audioClipProvenance.assetId, derivative!.id));
    expect(survivor).toBeTruthy();
    expect(provenance?.sourceAssetId).toBeNull();
  }, 30_000);

  it.skipIf(!pgContainerId)("restores saved clip provenance after source deletion from a custom-format database dump and independent media copy", async () => {
    const parsed = new URL(pgUrl!);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    const username = decodeURIComponent(parsed.username);
    const restoreDatabase = `arken_audio_restore_qa_${randomUUID().replaceAll("-", "")}`;
    const restoredMediaRoot = await mkdtemp(join(tmpdir(), "uix512-audio-restored-media-"));
    let restoredResources: ReturnType<typeof createDatabase> | undefined;
    let databaseCreated = false;
    try {
      const { sourceId, candidate, bytes } = await insertCandidate();
      const request = { actionId: randomUUID(), candidateId: candidate.id, label: "Recovery fixture", icon: "🔊", category: "Другое", defaultGain: 0.5, audience: "GM_ONLY" };
      const saved = await app.inject({ method: "POST", url: `/api/soundpad/packs/${packId}/clips`, payload: request });
      expect(saved.statusCode).toBe(201);
      const assetId = saved.json().sound.assetId as string;
      const [derivative] = await db.select().from(assets).where(eq(assets.id, assetId));
      expect(derivative?.storageKey).toBeTruthy();
      expect(derivative?.audioPurpose).toBe("SOUND_EFFECT");
      await db.delete(assets).where(eq(assets.id, sourceId));
      const [detached] = await db.select().from(audioClipProvenance).where(eq(audioClipProvenance.assetId, assetId));
      expect(detached?.sourceAssetId).toBeNull();

      const mediaSource = resolve(mediaDir, derivative!.storageKey);
      const copiedBlob = await readFile(mediaSource);
      expect(copiedBlob).toEqual(bytes);
      const restoredBlobPath = resolve(restoredMediaRoot, derivative!.storageKey);
      expect(restoredBlobPath.startsWith(`${restoredMediaRoot}/`) || restoredBlobPath.startsWith(`${restoredMediaRoot}\\`)).toBe(true);
      await mkdir(dirname(restoredBlobPath), { recursive: true });
      await writeFile(restoredBlobPath, copiedBlob, { flag: "wx" });

      const dump = runPostgresContainerTool(pgContainerId!, ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--username", username, "--dbname", databaseName]);
      expect(dump.length).toBeGreaterThan(0);
      runPostgresContainerTool(pgContainerId!, ["createdb", "--username", username, restoreDatabase]);
      databaseCreated = true;
      runPostgresContainerTool(pgContainerId!, ["pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "--username", username, "--dbname", restoreDatabase], dump);

      const restoredUrl = new URL(pgUrl!);
      restoredUrl.pathname = `/${restoreDatabase}`;
      restoredResources = createDatabase(restoredUrl.toString());
      const [restoredAsset] = await restoredResources.db.select().from(assets).where(eq(assets.id, assetId));
      const [restoredProvenance] = await restoredResources.db.select().from(audioClipProvenance).where(eq(audioClipProvenance.assetId, assetId));
      const [restoredSound] = await restoredResources.db.select().from(campaignSounds).where(eq(campaignSounds.assetId, assetId));
      expect(restoredAsset).toMatchObject({ audioPurpose: "SOUND_EFFECT", storageKey: derivative!.storageKey, sizeBytes: bytes.length });
      expect(restoredProvenance).toMatchObject({ assetId, sourceAssetId: null });
      expect(restoredSound?.assetId).toBe(assetId);
      const restoredBytes = await readFile(restoredBlobPath);
      expect(createHash("sha256").update(restoredBytes).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
    } finally {
      try {
        await restoredResources?.client.end({ timeout: 2 });
      } finally {
        try {
          if (databaseCreated) runPostgresContainerTool(pgContainerId!, ["dropdb", "--if-exists", "--username", username, restoreDatabase]);
        } finally {
          await rm(restoredMediaRoot, { recursive: true, force: true });
        }
      }
    }
  }, 60_000);
});
