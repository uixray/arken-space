import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@arken/db";

const { requireAuthMock, storeUploadMock, readStoredImageMock, removeStoredUploadMock, openStoredFileMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  storeUploadMock: vi.fn(),
  readStoredImageMock: vi.fn(),
  removeStoredUploadMock: vi.fn(),
  openStoredFileMock: vi.fn(),
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  requireAuth: requireAuthMock,
}));
vi.mock("./storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./storage.js")>()),
  assertStorageCapacity: vi.fn(async () => undefined),
  readStoredImage: readStoredImageMock,
  removeStoredUpload: removeStoredUploadMock,
  storeUpload: storeUploadMock,
  openStoredFile: openStoredFileMock,
}));

import { registerGalleryChatShareRoutes } from "./gallery-chat-share.js";
import { registerChatAttachmentContentRoute } from "./chat-attachment-content.js";

const campaignId = "10000000-0000-4000-8000-000000000081";
const foreignCampaignId = "10000000-0000-4000-8000-000000000082";
const gmId = "10000000-0000-4000-8000-000000000083";
const playerId = "10000000-0000-4000-8000-000000000084";
const otherPlayerId = "10000000-0000-4000-8000-000000000085";
const foreignGmId = "10000000-0000-4000-8000-000000000086";
const characterId = "10000000-0000-4000-8000-000000000087";
const foreignCharacterId = "10000000-0000-4000-8000-000000000088";
const imageAssetId = "10000000-0000-4000-8000-000000000089";
const hiddenImageAssetId = "10000000-0000-4000-8000-000000000090";
const audioAssetId = "10000000-0000-4000-8000-000000000091";
const foreignImageAssetId = "10000000-0000-4000-8000-000000000092";
const galleryId = "10000000-0000-4000-8000-000000000093";
const hiddenGalleryId = "10000000-0000-4000-8000-000000000094";
const audioGalleryId = "10000000-0000-4000-8000-000000000095";
const foreignGalleryId = "10000000-0000-4000-8000-000000000096";

let database: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let emits: ReturnType<typeof vi.fn>;

function expectStatus(response: { statusCode: number; json: () => unknown }, expected: number) {
  expect(response.statusCode).toBe(expected);
}

beforeEach(async () => {
  database = new PGlite();
  const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort())
    await database.exec((await readFile(new URL(file, migrations), "utf8")).replaceAll("--> statement-breakpoint", ""));
  db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: campaignId, name: "Share test" },
    { id: foreignCampaignId, name: "Foreign campaign" },
  ]);
  await db.insert(schema.memberships).values([
    { id: gmId, campaignId, role: "GM", displayName: "GM" },
    { id: playerId, campaignId, role: "PLAYER", displayName: "Owner" },
    { id: otherPlayerId, campaignId, role: "PLAYER", displayName: "Other" },
    { id: foreignGmId, campaignId: foreignCampaignId, role: "GM", displayName: "Foreign GM" },
  ]);
  await db.insert(schema.characters).values([
    { id: characterId, campaignId, ownerMembershipId: playerId, name: "Owner character" },
    { id: foreignCharacterId, campaignId: foreignCampaignId, ownerMembershipId: foreignGmId, name: "Foreign character" },
  ]);
  await db.insert(schema.assets).values([
    { id: imageAssetId, campaignId, uploadedByMembershipId: gmId, kind: "IMAGE", name: "Image", storageKey: "original-image.webp", mimeType: "image/webp", sizeBytes: 20, width: 4, height: 4 },
    { id: hiddenImageAssetId, campaignId, uploadedByMembershipId: gmId, kind: "IMAGE", name: "Hidden image", storageKey: "hidden-image.webp", mimeType: "image/webp", sizeBytes: 20, width: 4, height: 4 },
    { id: audioAssetId, campaignId, uploadedByMembershipId: gmId, kind: "AUDIO", audioPurpose: "MUSIC", name: "Audio", storageKey: "audio.ogg", mimeType: "audio/ogg", sizeBytes: 20, durationSeconds: 2 },
    { id: foreignImageAssetId, campaignId: foreignCampaignId, uploadedByMembershipId: foreignGmId, kind: "IMAGE", name: "Foreign image", storageKey: "foreign-image.webp", mimeType: "image/webp", sizeBytes: 20, width: 4, height: 4 },
  ]);
  await db.insert(schema.characterMedia).values([
    { id: galleryId, campaignId, characterId, assetId: imageAssetId, uploadedByMembershipId: playerId, category: "CHARACTER_ART", visibility: "PARTY", caption: "  A stable caption  " },
    { id: hiddenGalleryId, campaignId, characterId, assetId: hiddenImageAssetId, uploadedByMembershipId: gmId, category: "CHARACTER_ART", visibility: "GM_ONLY", caption: "Private caption" },
    { id: audioGalleryId, campaignId, characterId, assetId: audioAssetId, uploadedByMembershipId: gmId, category: "CHARACTER_ART", visibility: "PARTY" },
    { id: foreignGalleryId, campaignId: foreignCampaignId, characterId: foreignCharacterId, assetId: foreignImageAssetId, uploadedByMembershipId: foreignGmId, category: "CHARACTER_ART", visibility: "PARTY" },
  ]);
  requireAuthMock.mockImplementation(async (request: { headers: Record<string, string> }) => {
    const role = request.headers["x-test-role"];
    if (role !== "GM" && role !== "PLAYER") return null;
    const membershipId = request.headers["x-test-member"] ?? (role === "GM" ? gmId : otherPlayerId);
    return { campaignId, membershipId, role, displayName: role };
  });
  let storedIndex = 0;
  storeUploadMock.mockImplementation(async () => ({ storageKey: `chat-copy-${++storedIndex}.webp`, mimeType: "image/webp", sizeBytes: 10, width: 4, height: 4, durationSeconds: null }));
  readStoredImageMock.mockResolvedValue(Buffer.from("synthetic image bytes"));
  emits = vi.fn();
  app = Fastify();
  registerGalleryChatShareRoutes(app, db as never, { to: vi.fn(() => ({ emit: emits })) } as never);
  registerChatAttachmentContentRoute(app, db as never);
});

afterEach(async () => {
  await app.close();
  await database.close();
  requireAuthMock.mockReset();
  storeUploadMock.mockReset();
  readStoredImageMock.mockReset();
  removeStoredUploadMock.mockReset();
  openStoredFileMock.mockReset();
});

describe("public gallery chat share", () => {
  it("serves the copied image to public-chat recipients while preserving message visibility", async () => {
    openStoredFileMock.mockResolvedValue({ stream: Buffer.from("copied image"), size: 12 });
    const shared = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload: { actionId: "20000000-0000-4000-8000-000000000088", characterMediaId: galleryId } });
    expectStatus(shared, 201);
    const message = shared.json();
    const contentId = message.attachments[0].contentId;

    // The recipient fetches the immutable chat copy, not the mutable gallery source.
    await db.update(schema.characterMedia).set({ detachedAt: new Date(), detachedByMembershipId: playerId }).where(eq(schema.characterMedia.id, galleryId));
    await db.update(schema.assets).set({ storageKey: "replacement-source.webp" }).where(eq(schema.assets.id, imageAssetId));
    const recipient = await app.inject({ method: "GET", url: `/api/chat/attachments/${contentId}/content`, headers: { "x-test-role": "PLAYER", "x-test-member": otherPlayerId } });
    expectStatus(recipient, 200);
    expect(openStoredFileMock).toHaveBeenCalledWith("chat-copy-1.webp", undefined);

    const [row] = await db.select().from(schema.chatMessages);
    await db.update(schema.chatMessages).set({ visibility: "GM_ONLY" }).where(eq(schema.chatMessages.id, row!.id));
    const hidden = await app.inject({ method: "GET", url: `/api/chat/attachments/${contentId}/content`, headers: { "x-test-role": "PLAYER", "x-test-member": otherPlayerId } });
    expectStatus(hidden, 404);
    const gm = await app.inject({ method: "GET", url: `/api/chat/attachments/${contentId}/content`, headers: { "x-test-role": "GM" } });
    expectStatus(gm, 200);
  });

  it("creates a public chat attachment copy from a visible gallery item and replays idempotently", async () => {
    const payload = { actionId: "20000000-0000-4000-8000-000000000081", characterMediaId: galleryId };
    const response = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload });
    expectStatus(response, 201);
    const message = response.json();
    expect(message).toMatchObject({ body: "A stable caption", visibility: "PUBLIC", stream: "TABLE" });
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({ fileName: "gallery-image.webp", mimeType: "image/webp", sizeBytes: 10 });
    expect(JSON.stringify(message)).not.toContain("original-image.webp");
    expect(message.galleryShareSourceMediaId).toBeUndefined();
    expect(readStoredImageMock).toHaveBeenCalledWith("original-image.webp");
    expect(storeUploadMock).toHaveBeenCalledOnce();
    expect(emits).toHaveBeenCalledWith("chat:created", expect.objectContaining({ data: expect.objectContaining({ id: message.id }) }));

    const replay = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload });
    expectStatus(replay, 200);
    expect(replay.json().id).toBe(message.id);
    expect(storeUploadMock).toHaveBeenCalledOnce();
    expect(await db.select().from(schema.chatAttachments)).toHaveLength(1);
    expect((await db.select().from(schema.chatAttachmentUploads))[0]?.status).toBe("CLAIMED");
    expect((await db.select().from(schema.chatMessages))[0]?.body).toBe("A stable caption");
  });

  it("blocks inaccessible, detached, cross-campaign, and non-image sources", async () => {
    const privateAttempt = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": otherPlayerId }, payload: { actionId: "20000000-0000-4000-8000-000000000082", characterMediaId: hiddenGalleryId } });
    expectStatus(privateAttempt, 404);
    const foreignAttempt = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": otherPlayerId }, payload: { actionId: "20000000-0000-4000-8000-000000000083", characterMediaId: foreignGalleryId } });
    expectStatus(foreignAttempt, 404);
    const nonImageAttempt = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "GM" }, payload: { actionId: "20000000-0000-4000-8000-000000000084", characterMediaId: audioGalleryId } });
    expectStatus(nonImageAttempt, 415);
    await db.update(schema.characterMedia).set({ detachedAt: new Date(), detachedByMembershipId: playerId }).where(eq(schema.characterMedia.id, galleryId));
    const detachedAttempt = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload: { actionId: "20000000-0000-4000-8000-000000000085", characterMediaId: galleryId } });
    expectStatus(detachedAttempt, 404);
    expect(storeUploadMock).not.toHaveBeenCalled();
    expect(await db.select().from(schema.chatMessages)).toHaveLength(0);
  });

  it("lets a user override the snapshot caption and rejects action reuse for another source", async () => {
    const payload = { actionId: "20000000-0000-4000-8000-000000000086", characterMediaId: galleryId, caption: " New public caption " };
    const response = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload });
    expectStatus(response, 201);
    expect(response.json().body).toBe("New public caption");
    const changedCaption = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload: { ...payload, caption: "Different caption" } });
    expectStatus(changedCaption, 409);
    expect(changedCaption.json()).toEqual({ error: "ACTION_ID_CONFLICT" });
    const changedSource = await app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload: { ...payload, characterMediaId: hiddenGalleryId } });
    expectStatus(changedSource, 409);
    expect(changedSource.json()).toEqual({ error: "ACTION_ID_CONFLICT" });
  });

  it("resolves concurrent duplicate submissions to one attachment and one replay", async () => {
    const payload = { actionId: "20000000-0000-4000-8000-000000000087", characterMediaId: galleryId };
    const submit = () => app.inject({ method: "POST", url: "/api/chat/gallery-shares", headers: { "x-test-role": "PLAYER", "x-test-member": playerId }, payload });
    const [first, second] = await Promise.all([submit(), submit()]);
    expectStatus(first, [200, 201].includes(first.statusCode) ? first.statusCode : 200);
    expectStatus(second, [200, 201].includes(second.statusCode) ? second.statusCode : 201);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 201]);
    expect(first.json().id).toBe(second.json().id);
    // Depending on the database scheduler, the second request either replays
    // before copying or loses the action-id race and removes its speculative copy.
    // In both cases exactly one copied blob remains owned by the one durable row.
    expect(storeUploadMock.mock.calls.length - removeStoredUploadMock.mock.calls.length).toBe(1);
    expect(await db.select().from(schema.chatAttachments)).toHaveLength(1);
    expect(await db.select().from(schema.chatMessages)).toHaveLength(1);
  });
});
