import { readdir, readFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@arken/db";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { registerRoutes } from "./routes.js";
import { mediaRoot } from "./storage.js";

const id = () => crypto.randomUUID();
const ids: { campaignA: string; campaignB: string; gmA: string; gmB: string; playerB: string; tableA: string; tableB: string; pack: string; media: string; sticker: string } = { campaignA: id(), campaignB: id(), gmA: id(), gmB: id(), playerB: id(), tableA: id(), tableB: id(), pack: id(), media: id(), sticker: id() };
const tokens = { gmA: "gm-a-" + "a".repeat(40), gmB: "gm-b-" + "b".repeat(40), playerB: "player-b-" + "c".repeat(40) };
let pg: PGlite;
let app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mediaFiles: string[] = [];
const session = (token: string) => ({ cookie: `${env.SESSION_COOKIE_NAME}=${token}` });
const previousFeatureFlag = env.GLOBAL_STICKERS_ENABLED;

async function applyMigrations(database: PGlite, through?: string) {
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  const files = (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    if (through && name > through) continue;
    await database.exec((await readFile(new URL(name, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
}

beforeEach(async () => {
  (env as { GLOBAL_STICKERS_ENABLED: boolean }).GLOBAL_STICKERS_ENABLED = true;
  pg = new PGlite();
  await applyMigrations(pg);
  db = drizzle(pg, { schema });
  await db.insert(schema.campaigns).values([{ id: ids.campaignA, name: "A" }, { id: ids.campaignB, name: "B" }]);
  await db.insert(schema.memberships).values([
    { id: ids.gmA, campaignId: ids.campaignA, role: "GM", displayName: "GM A" },
    { id: ids.gmB, campaignId: ids.campaignB, role: "GM", displayName: "GM B" },
    { id: ids.playerB, campaignId: ids.campaignB, role: "PLAYER", displayName: "Player B" },
  ]);
  for (const token of Object.values(tokens)) {
    const membershipId = token === tokens.gmA ? ids.gmA : token === tokens.gmB ? ids.gmB : ids.playerB;
    await db.insert(schema.sessions).values({ membershipId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) });
  }
  await db.insert(schema.chatThreads).values([
    { id: ids.tableA, campaignId: ids.campaignA, type: "STREAM", stream: "TABLE" },
    { id: ids.tableB, campaignId: ids.campaignB, type: "STREAM", stream: "TABLE" },
  ]).onConflictDoNothing();
  const [threadB] = await db.select().from(schema.chatThreads).where(and(eq(schema.chatThreads.campaignId, ids.campaignB), eq(schema.chatThreads.stream, "TABLE"))).limit(1);
  if (!threadB) throw new Error("TABLE_THREAD_MISSING");
  ids.tableB = threadB.id;
  const storageKey = `global-route-${id()}.webp`;
  const file = join(mediaRoot(), storageKey);
  mediaFiles.push(file);
  await mkdir(mediaRoot(), { recursive: true });
  const bytes = Buffer.from("global-cross-campaign-media");
  await writeFile(file, bytes);
  await db.insert(schema.globalStickerPacks).values({ id: ids.pack, name: "Shared", creatorMembershipId: ids.gmA, createActionId: id(), lifecycle: "ACTIVE" });
  await db.insert(schema.globalStickerMedia).values({ id: ids.media, uploadedByMembershipId: ids.gmA, storageKey, mimeType: "image/webp", sizeBytes: bytes.length, width: 12, height: 12, sha256: "a".repeat(64) });
  await db.insert(schema.globalStickers).values({ id: ids.sticker, packId: ids.pack, actionId: id(), mediaId: ids.media, name: "Star", altText: "A star" });
  app = Fastify();
  await app.register(cookie);
  const io = { in: () => ({ fetchSockets: async () => [] }), to: () => ({ emit() {} }) };
  registerRoutes(app, db as never, io as never);
  await app.ready();
}, 120_000);

afterEach(async () => {
  if (app) await app.close();
  if (pg) await pg.close();
  await Promise.all(mediaFiles.splice(0).map((file) => unlink(file).catch(() => undefined)));
  (env as { GLOBAL_STICKERS_ENABLED: boolean }).GLOBAL_STICKERS_ENABLED = previousFeatureFlag;
}, 120_000);

describe("global sticker full routes", () => {
  it("lists and sends the same service-wide media cross-campaign, replays once, and preserves history when discovery is disabled", async () => {
    const listing = await app.inject({ method: "GET", url: "/api/stickers", headers: session(tokens.gmB) });
    expect(listing.statusCode, listing.body).toBe(200);
    const global = listing.json().find((pack: { scope?: string; id: string }) => pack.scope === "GLOBAL_PUBLIC" && pack.id === ids.pack);
    expect(global?.stickers[0]?.url).toBe(`/api/global-stickers/${ids.sticker}/content`);

    const actionId = id();
    const payload = { actionId, scope: "GLOBAL", globalStickerId: ids.sticker, threadId: ids.tableB };
    const concurrent = await Promise.all([
      app.inject({ method: "POST", url: "/api/chat/stickers", headers: session(tokens.playerB), payload }),
      app.inject({ method: "POST", url: "/api/chat/stickers", headers: session(tokens.playerB), payload }),
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const sent = concurrent.find((response) => response.statusCode === 201)!;
    expect(sent.json().globalStickerId).toBe(ids.sticker);
    const replay = await app.inject({ method: "POST", url: "/api/chat/stickers", headers: session(tokens.playerB), payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(sent.json().id);
    const history = await app.inject({ method: "GET", url: `/api/chat/threads/${ids.tableB}/messages?limit=10`, headers: session(tokens.playerB) });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().messages).toHaveLength(1);
    expect(history.json().messages[0].globalStickerId).toBe(ids.sticker);

    const anonymous = await app.inject({ method: "GET", url: "/api/stickers" });
    expect(anonymous.statusCode).toBe(401);
    (env as { GLOBAL_STICKERS_ENABLED: boolean }).GLOBAL_STICKERS_ENABLED = false;
    const disabledListing = await app.inject({ method: "GET", url: "/api/stickers", headers: session(tokens.playerB) });
    expect(disabledListing.statusCode).toBe(200);
    expect(disabledListing.json().some((pack: { id: string }) => pack.id === ids.pack)).toBe(false);
    const newSend = await app.inject({ method: "POST", url: "/api/chat/stickers", headers: session(tokens.playerB), payload: { ...payload, actionId: id() } });
    expect(newSend.statusCode).toBe(404);
    const retainedHistory = await app.inject({ method: "GET", url: `/api/chat/threads/${ids.tableB}/messages?limit=10`, headers: session(tokens.playerB) });
    expect(retainedHistory.json().messages[0].globalStickerId).toBe(ids.sticker);
    const retainedMedia = await app.inject({ method: "GET", url: `/api/global-stickers/${ids.sticker}/content`, headers: session(tokens.playerB) });
    expect(retainedMedia.statusCode).toBe(200);
  });

  it("keeps legacy campaign private packs out of another campaign's catalog", async () => {
    const privatePack = id();
    const privateMedia = id();
    const privateSticker = id();
    await db.insert(schema.stickerPacks).values({ id: privatePack, campaignId: ids.campaignA, name: "Private A", subject: "NPC", subjectLabel: "A", lifecycle: "ACTIVE" });
    await db.insert(schema.stickerMedia).values({ id: privateMedia, campaignId: ids.campaignA, uploadedByMembershipId: ids.gmA, storageKey: `unused-${id()}.webp`, mimeType: "image/webp", sizeBytes: 2, width: 1, height: 1, sha256: "b".repeat(64) });
    await db.insert(schema.stickers).values({ id: privateSticker, campaignId: ids.campaignA, packId: privatePack, mediaId: privateMedia, name: "Secret", altText: "Secret", provenanceType: "ORIGINAL" });
    const listing = await app.inject({ method: "GET", url: "/api/stickers", headers: session(tokens.playerB) });
    expect(listing.statusCode).toBe(200);
    expect(listing.json().some((pack: { id: string }) => pack.id === privatePack)).toBe(false);
    const crossCampaignPrivateSend = await app.inject({ method: "POST", url: "/api/chat/stickers", headers: session(tokens.playerB), payload: { actionId: id(), stickerId: privateSticker, threadId: ids.tableB } });
    expect(crossCampaignPrivateSend.statusCode).toBe(404);
  });
});

describe("global sticker additive migration", () => {
  it("preserves an existing campaign sticker message when 0047 adds global references", async () => {
    const legacy = new PGlite();
    try {
      await applyMigrations(legacy, "0046_public_roadmap_votes.sql");
      const legacyDb = drizzle(legacy, { schema });
      const campaignId = id(); const membershipId = id(); const threadId = id();
      const packId = id(); const mediaId = id(); const stickerId = id(); const messageId = id();
      await legacyDb.insert(schema.campaigns).values({ id: campaignId, name: "Legacy" });
      await legacyDb.insert(schema.memberships).values({ id: membershipId, campaignId, role: "PLAYER", displayName: "Old player" });
      await legacyDb.insert(schema.chatThreads).values({ id: threadId, campaignId, type: "STREAM", stream: "TABLE" }).onConflictDoNothing();
      const [legacyThread] = await legacyDb.select().from(schema.chatThreads).where(and(eq(schema.chatThreads.campaignId, campaignId), eq(schema.chatThreads.stream, "TABLE"))).limit(1);
      if (!legacyThread) throw new Error("LEGACY_TABLE_THREAD_MISSING");
      await legacyDb.insert(schema.stickerPacks).values({ id: packId, campaignId, name: "Old pack", subject: "NPC", subjectLabel: "NPC", lifecycle: "ACTIVE" });
      await legacyDb.insert(schema.stickerMedia).values({ id: mediaId, campaignId, uploadedByMembershipId: membershipId, storageKey: `legacy-${id()}.webp`, mimeType: "image/webp", sizeBytes: 2, width: 1, height: 1, sha256: "c".repeat(64) });
      await legacyDb.insert(schema.stickers).values({ id: stickerId, campaignId, packId, mediaId, name: "Old", altText: "Old", provenanceType: "ORIGINAL" });
      await legacy.query("INSERT INTO chat_messages (id,campaign_id,membership_id,thread_id,kind,visibility,body,sticker_id,sticker_presentation) VALUES ($1,$2,$3,$4,'TEXT','PUBLIC','',$5,$6::jsonb)", [messageId, campaignId, membershipId, legacyThread.id, stickerId, JSON.stringify({ name: "Old", altText: "Old", assetUrl: `/api/stickers/${stickerId}/content`, width: 1, height: 1 })]);
      const migration = await readFile(new URL("../../../packages/db/drizzle/0047_global_sticker_catalog.sql", import.meta.url), "utf8");
      await legacy.exec(migration.replaceAll("--> statement-breakpoint", ""));
      const rows = await legacy.query("SELECT sticker_id, global_sticker_id, sticker_presentation FROM chat_messages WHERE id=$1", [messageId]) as { rows: Array<{ sticker_id: string | null; global_sticker_id: string | null; sticker_presentation: { name: string; altText: string } }> };
      expect(rows.rows[0]?.sticker_id).toBe(stickerId);
      expect(rows.rows[0]?.global_sticker_id).toBeNull();
      expect(rows.rows[0]?.sticker_presentation).toMatchObject({ name: "Old", altText: "Old" });
    } finally { await legacy.close(); }
  });
});
