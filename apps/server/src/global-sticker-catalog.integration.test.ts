import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as schema from "@arken/db";
import type { AuthContext } from "./auth.js";
import { registerGlobalStickerRoutes } from "./global-sticker-catalog.js";
import { mediaRoot } from "./storage.js";
import { env } from "./env.js";
import { createHash } from "node:crypto";

let pg: PGlite;
let app: ReturnType<typeof Fastify>;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mediaPaths: string[] = [];
const priorMediaQuota = env.MIN_FREE_DISK_BYTES;
const priorOperatorIds = env.OPERATOR_MEMBERSHIP_IDS;
const ids = { campaignA: crypto.randomUUID(), campaignB: crypto.randomUUID(), gmA: crypto.randomUUID(), gmB: crypto.randomUUID(), playerB: crypto.randomUUID() };
const contexts: Record<string, AuthContext> = {
  gmA: { campaignId: ids.campaignA, membershipId: ids.gmA, role: "GM", displayName: "A" },
  gmB: { campaignId: ids.campaignB, membershipId: ids.gmB, role: "GM", displayName: "B" },
  playerB: { campaignId: ids.campaignB, membershipId: ids.playerB, role: "PLAYER", displayName: "Player" },
};

beforeEach(async () => {
  pg = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await pg.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(pg, { schema });
  await db.insert(schema.campaigns).values([{ id: ids.campaignA, name: "A" }, { id: ids.campaignB, name: "B" }]);
  await db.insert(schema.memberships).values([
    { id: ids.gmA, campaignId: ids.campaignA, role: "GM", displayName: "A" },
    { id: ids.gmB, campaignId: ids.campaignB, role: "GM", displayName: "B" },
    { id: ids.playerB, campaignId: ids.campaignB, role: "PLAYER", displayName: "Player" },
  ]);
  app = Fastify();
  await app.register(cookie);
  await app.register(multipart, { limits: { files: 1, fileSize: 5 * 1024 * 1024 } });
  registerGlobalStickerRoutes(app, db as never, (async (request: FastifyRequest, reply: FastifyReply) => {
    const key = request.headers["x-test-auth"];
    if (typeof key === "string") return contexts[key] ?? null;
    reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }) as never);
}, 120_000);

afterEach(async () => { await app.close(); await pg.close(); await Promise.all(mediaPaths.splice(0).map((path) => unlink(path).catch(() => undefined))); (env as { MIN_FREE_DISK_BYTES: number }).MIN_FREE_DISK_BYTES = priorMediaQuota; (env as { OPERATOR_MEMBERSHIP_IDS: string }).OPERATOR_MEMBERSHIP_IDS = priorOperatorIds; });

function multipartFile(name: string, type: string, bytes: Buffer) {
  const boundary = `----arken-${crypto.randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { boundary, body };
}

describe("global sticker catalog routes", () => {
  it("allows any GM to create a global pack but keeps management creator-owned across campaigns", async () => {
    const actionId = crypto.randomUUID();
    const created = await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId, name: "Shared" } });
    expect(created.statusCode, created.body).toBe(201);
    const pack = created.json();
    expect(pack.creatorMembershipId).toBe(ids.gmA);
    expect(pack.lifecycle).toBe("DRAFT");
    const retry = await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId, name: "Shared" } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(pack.id);
    const createConflict = await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId, name: "Changed name" } });
    expect(createConflict.statusCode).toBe(409);
    const foreignEdit = await app.inject({ method: "PATCH", url: `/api/gm/global-sticker-packs/${pack.id}`, headers: { "x-test-auth": "gmB" }, payload: { revision: 0, name: "Hijack" } });
    expect(foreignEdit.statusCode).toBe(404);
    const playerCreate = await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "playerB" }, payload: { actionId: crypto.randomUUID(), name: "No" } });
    expect(playerCreate.statusCode).toBe(403);
    const ownEdit = await app.inject({ method: "PATCH", url: `/api/gm/global-sticker-packs/${pack.id}`, headers: { "x-test-auth": "gmA" }, payload: { revision: 0, name: "Updated" } });
    expect(ownEdit.statusCode).toBe(200);
    expect(ownEdit.json().name).toBe("Updated");
  });

  it("requires authentication for global media endpoints", async () => {
    const noSession = await app.inject({ method: "GET", url: `/api/global-stickers/${crypto.randomUUID()}/content` });
    expect(noSession.statusCode).toBe(401);
  });

  it("accepts original PNG bytes, binds retries to declared source SHA and metadata, and permits same bytes in separate packs", async () => {
    (env as { MIN_FREE_DISK_BYTES: number }).MIN_FREE_DISK_BYTES = 1;
    const source = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 180, g: 70, b: 10, alpha: 0.5 } } }).png().toBuffer();
    const sourceSha256 = createHash("sha256").update(source).digest("hex");
    const firstPack = (await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId: crypto.randomUUID(), name: "First" } })).json();
    const uploadUrl = (packId: string, actionId: string, altText = "Transparent test") => `/api/gm/global-sticker-packs/${packId}/stickers?${new URLSearchParams({ actionId, sourceSha256, name: "Sample", altText })}`;
    const actionId = crypto.randomUUID();
    const fixture = multipartFile("source.png", "image/png", source);
    const uploaded = await app.inject({ method: "POST", url: uploadUrl(firstPack.id, actionId), headers: { "x-test-auth": "gmA", "content-type": `multipart/form-data; boundary=${fixture.boundary}` }, payload: fixture.body });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const mediaRows = await pg.query("SELECT storage_key,mime_type,sha256 FROM global_sticker_media WHERE id=(SELECT media_id FROM global_stickers WHERE id=$1)", [uploaded.json().id]) as { rows: Array<{ storage_key: string; mime_type: string; sha256: string }> };
    const storedFile = join(mediaRoot(), String(mediaRows.rows[0]?.storage_key));
    mediaPaths.push(storedFile);
    expect(mediaRows.rows[0]?.mime_type).toBe("image/webp");
    expect(mediaRows.rows[0]?.sha256).toBe(sourceSha256);
    expect((await readFile(storedFile)).subarray(0, 4).toString("ascii")).toBe("RIFF");

    const replay = await app.inject({ method: "POST", url: uploadUrl(firstPack.id, actionId), headers: { "x-test-auth": "gmA" } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(uploaded.json().id);
    const changedIntent = await app.inject({ method: "POST", url: uploadUrl(firstPack.id, actionId, "Changed metadata"), headers: { "x-test-auth": "gmA" } });
    expect(changedIntent.statusCode).toBe(409);
    const changedSource = await app.inject({ method: "POST", url: `/api/gm/global-sticker-packs/${firstPack.id}/stickers?${new URLSearchParams({ actionId, sourceSha256: "0".repeat(64), name: "Sample", altText: "Transparent test" })}`, headers: { "x-test-auth": "gmA" } });
    expect(changedSource.statusCode).toBe(409);
    const wrongDeclaration = multipartFile("source.png", "image/png", source);
    const wrongShaUrl = `/api/gm/global-sticker-packs/${firstPack.id}/stickers?${new URLSearchParams({ actionId: crypto.randomUUID(), sourceSha256: "0".repeat(64), name: "Sample", altText: "Transparent test" })}`;
    const mismatch = await app.inject({ method: "POST", url: wrongShaUrl, headers: { "x-test-auth": "gmA", "content-type": `multipart/form-data; boundary=${wrongDeclaration.boundary}` }, payload: wrongDeclaration.body });
    expect(mismatch.statusCode).toBe(400);

    const secondPack = (await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmB" }, payload: { actionId: crypto.randomUUID(), name: "Second" } })).json();
    const secondAction = crypto.randomUUID();
    const secondFixture = multipartFile("source.png", "image/png", source);
    const duplicateAcrossPacks = await app.inject({ method: "POST", url: uploadUrl(secondPack.id, secondAction), headers: { "x-test-auth": "gmB", "content-type": `multipart/form-data; boundary=${secondFixture.boundary}` }, payload: secondFixture.body });
    expect(duplicateAcrossPacks.statusCode, duplicateAcrossPacks.body).toBe(201);
    const secondMedia = await pg.query("SELECT storage_key FROM global_sticker_media WHERE id=(SELECT media_id FROM global_stickers WHERE id=$1)", [duplicateAcrossPacks.json().id]) as { rows: Array<{ storage_key: string }> };
    mediaPaths.push(join(mediaRoot(), String(secondMedia.rows[0]?.storage_key)));
    const samePackFixture = multipartFile("source.png", "image/png", source);
    const samePackDuplicate = await app.inject({ method: "POST", url: uploadUrl(firstPack.id, crypto.randomUUID()), headers: { "x-test-auth": "gmA", "content-type": `multipart/form-data; boundary=${samePackFixture.boundary}` }, payload: samePackFixture.body });
    expect(samePackDuplicate.statusCode).toBe(409);

    const ambiguousPack = (await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId: crypto.randomUUID(), name: "Ambiguous commit" } })).json();
    const ambiguousAction = crypto.randomUUID();
    const ambiguousFixture = multipartFile("source.png", "image/png", source);
    const mutableDb = db as unknown as { transaction: (work: (...args: any[]) => Promise<unknown>) => Promise<unknown> };
    const hadOwnTransaction = Object.prototype.hasOwnProperty.call(db, "transaction");
    const originalDescriptor = Object.getOwnPropertyDescriptor(db, "transaction");
    const realTransaction = mutableDb.transaction.bind(db);
    Object.defineProperty(db, "transaction", { configurable: true, writable: true, value: async (work: (...args: any[]) => Promise<unknown>) => { await realTransaction(work); throw new Error("AMBIGUOUS_COMMIT_TEST"); } });
    let ambiguousResponse;
    try {
      ambiguousResponse = await app.inject({ method: "POST", url: uploadUrl(ambiguousPack.id, ambiguousAction), headers: { "x-test-auth": "gmA", "content-type": `multipart/form-data; boundary=${ambiguousFixture.boundary}` }, payload: ambiguousFixture.body });
    } finally {
      if (hadOwnTransaction && originalDescriptor) Object.defineProperty(db, "transaction", originalDescriptor);
      else delete (mutableDb as unknown as { transaction?: unknown }).transaction;
    }
    expect(ambiguousResponse!.statusCode).toBe(200);
    const ambiguousMedia = await pg.query("SELECT storage_key FROM global_sticker_media WHERE id=(SELECT media_id FROM global_stickers WHERE action_id=$1)", [ambiguousAction]) as { rows: Array<{ storage_key: string }> };
    const preservedFile = join(mediaRoot(), String(ambiguousMedia.rows[0]?.storage_key));
    mediaPaths.push(preservedFile);
    expect((await readFile(preservedFile)).subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("serializes upload against publish: publish-first rejects and cleans a staged upload; upload-first publishes committed media", async () => {
    (env as { MIN_FREE_DISK_BYTES: number }).MIN_FREE_DISK_BYTES = 1;
    const png = async (r: number, g: number, b: number) => sharp({ create: { width: 2, height: 2, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
    const makePack = async (name: string) => (await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId: crypto.randomUUID(), name } })).json();
    const upload = async (packId: string, bytes: Buffer, altText: string) => {
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      const actionId = crypto.randomUUID();
      const file = multipartFile("race.png", "image/png", bytes);
      const response = await app.inject({ method: "POST", url: `/api/gm/global-sticker-packs/${packId}/stickers?${new URLSearchParams({ actionId, sourceSha256, name: "Race", altText })}`, headers: { "x-test-auth": "gmA", "content-type": `multipart/form-data; boundary=${file.boundary}` }, payload: file.body });
      if (response.statusCode === 201) {
        const media = await pg.query("SELECT storage_key FROM global_sticker_media WHERE id=(SELECT media_id FROM global_stickers WHERE action_id=$1)", [actionId]) as { rows: Array<{ storage_key: string }> };
        if (media.rows[0]) mediaPaths.push(join(mediaRoot(), media.rows[0].storage_key));
      }
      return { response, actionId };
    };

    const publishFirst = await makePack("Publish wins");
    const initial = await upload(publishFirst.id, await png(200, 20, 20), "Seed");
    expect(initial.response.statusCode).toBe(201);
    const existingFiles = new Set(await readdir(mediaRoot()));
    const stagedBytes = await png(20, 200, 20);
    const stagedSha = createHash("sha256").update(stagedBytes).digest("hex");
    const stagedAction = crypto.randomUUID();
    const stagedFile = multipartFile("staged.png", "image/png", stagedBytes);
    const stagedUrl = `/api/gm/global-sticker-packs/${publishFirst.id}/stickers?${new URLSearchParams({ actionId: stagedAction, sourceSha256: stagedSha, name: "Race", altText: "Staged" })}`;

    let signalEntered!: () => void;
    let releaseTransaction!: () => void;
    const transactionEntered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const transactionGate = new Promise<void>((resolve) => { releaseTransaction = resolve; });
    const mutableDb = db as unknown as { transaction: (work: (...args: any[]) => Promise<unknown>) => Promise<unknown> };
    const hadOwnTransaction = Object.prototype.hasOwnProperty.call(db, "transaction");
    const originalDescriptor = Object.getOwnPropertyDescriptor(db, "transaction");
    const realTransaction = mutableDb.transaction.bind(db);
    let interceptNext = true;
    Object.defineProperty(db, "transaction", { configurable: true, writable: true, value: async (work: (...args: any[]) => Promise<unknown>) => {
      if (interceptNext) { interceptNext = false; signalEntered(); await transactionGate; }
      return realTransaction(work);
    } });
    try {
      const stagedRequest = app.inject({ method: "POST", url: stagedUrl, headers: { "x-test-auth": "gmA", "content-type": `multipart/form-data; boundary=${stagedFile.boundary}` }, payload: stagedFile.body });
      await transactionEntered;
      const published = await app.inject({ method: "POST", url: `/api/gm/global-sticker-packs/${publishFirst.id}/publish`, headers: { "x-test-auth": "gmA" }, payload: { revision: 0 } });
      expect(published.statusCode, published.body).toBe(200);
      releaseTransaction();
      const stagedResponse = await stagedRequest;
      expect(stagedResponse.statusCode, stagedResponse.body).toBe(409);
    } finally {
      releaseTransaction();
      if (hadOwnTransaction && originalDescriptor) Object.defineProperty(db, "transaction", originalDescriptor);
      else delete (mutableDb as unknown as { transaction?: unknown }).transaction;
    }
    const packAfterRace = await db.select().from(schema.globalStickerPacks).where(eq(schema.globalStickerPacks.id, publishFirst.id));
    expect(packAfterRace[0]).toMatchObject({ lifecycle: "ACTIVE", revision: 1 });
    const stickersAfterRace = await db.select().from(schema.globalStickers).where(eq(schema.globalStickers.packId, publishFirst.id));
    expect(stickersAfterRace).toHaveLength(1);
    expect(new Set(await readdir(mediaRoot()))).toEqual(existingFiles);

    const uploadFirst = await makePack("Upload wins");
    const completed = await upload(uploadFirst.id, await png(20, 20, 200), "Committed");
    expect(completed.response.statusCode).toBe(201);
    const publishedAfterUpload = await app.inject({ method: "POST", url: `/api/gm/global-sticker-packs/${uploadFirst.id}/publish`, headers: { "x-test-auth": "gmA" }, payload: { revision: 0 } });
    expect(publishedAfterUpload.statusCode, publishedAfterUpload.body).toBe(200);
    const uploadFirstDetail = await app.inject({ method: "GET", url: `/api/gm/global-sticker-packs/${uploadFirst.id}`, headers: { "x-test-auth": "gmA" } });
    expect(uploadFirstDetail.json().stickers).toHaveLength(1);
  });

  it("allows only an existing operator to manage creator-orphaned packs without deleting history", async () => {
    (env as { OPERATOR_MEMBERSHIP_IDS: string }).OPERATOR_MEMBERSHIP_IDS = ids.gmA;
    const created = await app.inject({ method: "POST", url: "/api/gm/global-sticker-packs", headers: { "x-test-auth": "gmA" }, payload: { actionId: crypto.randomUUID(), name: "Orphan" } });
    expect(created.statusCode).toBe(201);
    await db.update(schema.globalStickerPacks).set({ lifecycle: "ACTIVE" }).where(eq(schema.globalStickerPacks.id, created.json().id));
    await pg.exec(`DELETE FROM memberships WHERE id='${ids.gmA}'`);
    const operatorDetail = await app.inject({ method: "GET", url: `/api/gm/global-sticker-packs/${created.json().id}`, headers: { "x-test-auth": "gmA" } });
    expect(operatorDetail.statusCode).toBe(200);
    const foreignManager = await app.inject({ method: "GET", url: `/api/gm/global-sticker-packs/${created.json().id}`, headers: { "x-test-auth": "gmB" } });
    expect(foreignManager.statusCode).toBe(404);
    const deprecated = await app.inject({ method: "POST", url: `/api/gm/global-sticker-packs/${created.json().id}/deprecate`, headers: { "x-test-auth": "gmA" } });
    expect(deprecated.statusCode, deprecated.body).toBe(204);
    const rows = await pg.query("SELECT creator_membership_id,lifecycle FROM global_sticker_packs WHERE id=$1", [created.json().id]) as { rows: Array<{ creator_membership_id: string | null; lifecycle: string }> };
    expect(rows.rows[0]).toMatchObject({ creator_membership_id: null, lifecycle: "DEPRECATED" });
  });

  it("serves the same active global media to an authenticated member in another campaign, without blocking creator removal", async () => {
    const key = `global-test-${crypto.randomUUID()}.webp`;
    const path = join(mediaRoot(), key);
    mediaPaths.push(path);
    await mkdir(mediaRoot(), { recursive: true });
    const bytes = Buffer.from("isolated-global-media-proof");
    await writeFile(path, bytes);
    const packId = crypto.randomUUID();
    const stickerId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    await pg.exec(`INSERT INTO global_sticker_packs (id,name,creator_membership_id,create_action_id,lifecycle) VALUES ('${packId}','Shared','${ids.gmA}','${crypto.randomUUID()}','ACTIVE')`);
    await pg.exec(`INSERT INTO global_sticker_media (id,uploaded_by_membership_id,storage_key,mime_type,size_bytes,width,height,sha256) VALUES ('${mediaId}','${ids.gmA}','${key}','image/webp',${bytes.length},1,1,'${crypto.randomUUID()}')`);
    await pg.exec(`INSERT INTO global_stickers (id,pack_id,action_id,media_id,name,alt_text) VALUES ('${stickerId}','${packId}','${crypto.randomUUID()}','${mediaId}','Hi','Hi')`);
    const response = await app.inject({ method: "GET", url: `/api/global-stickers/${stickerId}/content`, headers: { "x-test-auth": "playerB" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toBe(bytes.toString());
    await pg.exec(`DELETE FROM memberships WHERE id='${ids.gmA}'`);
    const remains = await pg.query(`SELECT id,creator_membership_id FROM global_sticker_packs WHERE id='${packId}'`) as { rows: Array<{ id: string; creator_membership_id: string | null }> };
    expect(remains.rows).toHaveLength(1);
    expect(remains.rows[0]?.creator_membership_id).toBeNull();
  });
});
