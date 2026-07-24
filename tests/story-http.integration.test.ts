import { readdir, readFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";

let database: PGlite;
let app: FastifyInstance;
const ids = {
  campaign: crypto.randomUUID(),
  foreignCampaign: crypto.randomUUID(),
  gm: crypto.randomUUID(),
  player: crypto.randomUUID(),
  foreignPlayer: crypto.randomUUID(),
};
const secrets = {
  gm: "g".repeat(40),
  player: "p".repeat(40),
  foreignPlayer: "f".repeat(40),
};
const headers = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});
const action = () => crypto.randomUUID();

beforeEach(async () => {
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
  const db = drizzle(database, { schema });
  await db.insert(schema.campaigns).values([
    { id: ids.campaign, name: "Story campaign" },
    { id: ids.foreignCampaign, name: "Foreign campaign" },
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
      id: ids.foreignPlayer,
      campaignId: ids.foreignCampaign,
      role: "PLAYER",
      displayName: "Foreign",
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
    {
      membershipId: ids.foreignPlayer,
      tokenHash: hashToken(secrets.foreignPlayer),
      expiresAt: new Date(Date.now() + 60_000),
    },
  ]);
  app = Fastify();
  await app.register(cookie);
  const io = {
    in: () => ({ fetchSockets: async () => [] }),
    to: () => ({ emit() {} }),
  };
  registerRoutes(app, db as never, io as never);
  await app.ready();
});

afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function createDraft(overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/api/story/posts",
    headers: headers(secrets.gm),
    payload: { actionId: action(), body: "The gate opens.", ...overrides },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; revision: number };
}

describe("UIX-246 story HTTP integration", () => {
  it("enforces GM write access and projects only safe public content to players", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/story/posts",
      headers: headers(secrets.player),
      payload: { actionId: action(), body: "Player cannot publish" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "GM_REQUIRED" });

    const draft = await createDraft({ gmNotes: "Private editorial note" });
    const playerDrafts = await app.inject({
      method: "GET",
      url: "/api/story/posts",
      headers: headers(secrets.player),
    });
    expect(playerDrafts.json().posts).toEqual([]);

    const published = await app.inject({
      method: "POST",
      url: `/api/story/posts/${draft.id}/publish`,
      headers: headers(secrets.gm),
      payload: { actionId: action(), revision: draft.revision },
    });
    expect(published.statusCode).toBe(200);

    const playerPosts = await app.inject({
      method: "GET",
      url: "/api/story/posts",
      headers: headers(secrets.player),
    });
    expect(playerPosts.statusCode).toBe(200);
    expect(playerPosts.json().posts).toHaveLength(1);
    expect(playerPosts.json().posts[0]).toMatchObject({
      id: draft.id,
      lifecycle: "PUBLISHED",
      body: "The gate opens.",
    });
    expect(playerPosts.json().posts[0]).not.toHaveProperty("gmNotes");
    expect(playerPosts.json().posts[0]).not.toHaveProperty("importProvenance");
  });

  it("uses revision CAS for publish/archive and hides archived posts from players", async () => {
    const draft = await createDraft();
    const stalePublish = await app.inject({
      method: "POST",
      url: `/api/story/posts/${draft.id}/publish`,
      headers: headers(secrets.gm),
      payload: { actionId: action(), revision: draft.revision + 1 },
    });
    expect(stalePublish.statusCode).toBe(409);
    expect(stalePublish.json()).toEqual({ error: "STORY_POST_CONFLICT" });

    const publishAction = action();
    const published = await app.inject({
      method: "POST",
      url: `/api/story/posts/${draft.id}/publish`,
      headers: headers(secrets.gm),
      payload: { actionId: publishAction, revision: draft.revision },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().revision).toBe(1);

    const replay = await app.inject({
      method: "POST",
      url: `/api/story/posts/${draft.id}/publish`,
      headers: headers(secrets.gm),
      payload: { actionId: publishAction, revision: draft.revision },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ id: draft.id, revision: 1 });

    const archived = await app.inject({
      method: "POST",
      url: `/api/story/posts/${draft.id}/archive`,
      headers: headers(secrets.gm),
      payload: { actionId: action(), revision: 1 },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      lifecycle: "ARCHIVED",
      revision: 2,
    });

    const playerPosts = await app.inject({
      method: "GET",
      url: "/api/story/posts",
      headers: headers(secrets.player),
    });
    expect(playerPosts.json().posts).toEqual([]);
  });

  it("does not expose draft media to players", async () => {
    const db = drizzle(database, { schema });
    const contentId = crypto.randomUUID();
    await db.insert(schema.chatAttachmentUploads).values({
      contentId,
      campaignId: ids.campaign,
      uploadedByMembershipId: ids.gm,
      fileName: "secret.png",
      storageKey: crypto.randomUUID(),
      mimeType: "image/png",
      sizeBytes: 1,
      status: "STAGED",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await createDraft({
      media: [{ contentId, order: 0, altText: "Secret map", caption: "" }],
    });

    const playerMedia = await app.inject({
      method: "GET",
      url: `/api/story/media/${contentId}`,
      headers: headers(secrets.player),
    });
    expect(playerMedia.statusCode).toBe(404);
    expect(playerMedia.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("keeps export-driven Telegram imports idempotent and GM-only", async () => {
    const record = {
      sourceMessageId: "telegram-42",
      sourceAuthor: "Ed",
      sourceTimestamp: "2026-07-24T05:00:00.000Z",
      body: "Imported story entry",
      media: [],
    };
    const playerDryRun = await app.inject({
      method: "POST",
      url: "/api/story/imports/telegram/dry-run",
      headers: headers(secrets.player),
      payload: { actionId: action(), records: [record] },
    });
    expect(playerDryRun.statusCode).toBe(403);

    const reviewed = await app.inject({
      method: "POST",
      url: "/api/story/imports/telegram/dry-run",
      headers: headers(secrets.gm),
      payload: { actionId: action(), records: [record] },
    });
    expect(reviewed.statusCode).toBe(200);
    const payload = {
      actionId: action(),
      importBatchId: reviewed.json().importBatchId as string,
      records: [record],
      rights: [{ sourceMessageId: record.sourceMessageId, status: "PENDING" }],
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/story/imports/telegram/commit",
      headers: headers(secrets.gm),
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstJson = first.json();
    expect(firstJson).toMatchObject({ imported: 1 });

    const replay = await app.inject({
      method: "POST",
      url: "/api/story/imports/telegram/commit",
      headers: headers(secrets.gm),
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(firstJson);

    const dryRun = await app.inject({
      method: "POST",
      url: "/api/story/imports/telegram/dry-run",
      headers: headers(secrets.gm),
      payload: { actionId: action(), records: [record] },
    });
    expect(dryRun.statusCode).toBe(200);
    expect(dryRun.json().items).toEqual([
      expect.objectContaining({
        sourceMessageId: record.sourceMessageId,
        action: "ALREADY_IMPORTED",
        existingPostId: firstJson.postIds[0],
        rightsStatus: "PENDING",
      }),
    ]);
  });

  it("rejects action-id reuse for a different command", async () => {
    const actionId = action();
    const created = await app.inject({ method: "POST", url: "/api/story/posts", headers: headers(secrets.gm), payload: { actionId, body: "Original" } });
    expect(created.statusCode).toBe(201);
    const conflict = await app.inject({ method: "PATCH", url: `/api/story/posts/${created.json().id}`, headers: headers(secrets.gm), payload: { actionId, revision: 0, body: "Different command" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "ACTION_ID_CONFLICT" });
  });

  it("atomically claims staged story media", async () => {
    const db = drizzle(database, { schema });
    const contentId = crypto.randomUUID();
    await db.insert(schema.chatAttachmentUploads).values({ contentId, campaignId: ids.campaign, uploadedByMembershipId: ids.gm, fileName: "once.png", storageKey: crypto.randomUUID(), mimeType: "image/png", sizeBytes: 1, status: "STAGED", expiresAt: new Date(Date.now() + 60_000) });
    await createDraft({ media: [{ contentId, order: 0, altText: "Once" }] });
    const duplicate = await app.inject({ method: "POST", url: "/api/story/posts", headers: headers(secrets.gm), payload: { actionId: action(), body: "Cannot reuse claimed upload", media: [{ contentId, order: 0, altText: "Again" }] } });
    expect(duplicate.statusCode).toBe(404);
    expect(duplicate.json()).toEqual({ error: "STORY_MEDIA_NOT_FOUND" });
  });

  it("uses an opaque composite cursor without gaps at equal updatedAt", async () => {
    const first = await createDraft({ body: "First" });
    const second = await createDraft({ body: "Second" });
    const third = await createDraft({ body: "Third" });
    const db = drizzle(database, { schema });
    const sameTime = new Date("2026-07-24T12:00:00.000Z");
    await db.update(schema.storyPosts).set({ updatedAt: sameTime }).where(inArray(schema.storyPosts.id, [first.id, second.id, third.id]));
    const pageOne = await app.inject({ method: "GET", url: "/api/story/posts?limit=1", headers: headers(secrets.gm) });
    expect(pageOne.statusCode).toBe(200);
    const one = pageOne.json();
    expect(one.nextCursor).toEqual(expect.any(String));
    const pageTwo = await app.inject({ method: "GET", url: `/api/story/posts?limit=10&cursor=${encodeURIComponent(one.nextCursor)}`, headers: headers(secrets.gm) });
    expect(pageTwo.statusCode).toBe(200);
    expect([one.posts[0].id, ...pageTwo.json().posts.map((post: { id: string }) => post.id)].sort()).toEqual([first.id, second.id, third.id].sort());
  });

  it("binds commit to the reviewed export and permits a later reviewed rights decision", async () => {
    const record = { sourceMessageId: "telegram-rights", sourceAuthor: "Ed", sourceTimestamp: "2026-07-24T05:00:00.000Z", body: "Rights review", media: [] };
    const reviewed = await app.inject({ method: "POST", url: "/api/story/imports/telegram/dry-run", headers: headers(secrets.gm), payload: { actionId: action(), records: [record] } });
    const batchId = reviewed.json().importBatchId as string;
    const mismatch = await app.inject({ method: "POST", url: "/api/story/imports/telegram/commit", headers: headers(secrets.gm), payload: { actionId: action(), importBatchId: batchId, records: [{ ...record, body: "Tampered" }], rights: [{ sourceMessageId: record.sourceMessageId, status: "APPROVED" }] } });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toEqual({ error: "STORY_IMPORT_BATCH_MISMATCH" });
    const imported = await app.inject({ method: "POST", url: "/api/story/imports/telegram/commit", headers: headers(secrets.gm), payload: { actionId: action(), importBatchId: batchId, records: [record], rights: [{ sourceMessageId: record.sourceMessageId, status: "PENDING" }] } });
    expect(imported.statusCode).toBe(201);
    const postId = imported.json().postIds[0] as string;
    const secondReview = await app.inject({ method: "POST", url: "/api/story/imports/telegram/dry-run", headers: headers(secrets.gm), payload: { actionId: action(), records: [record] } });
    const approved = await app.inject({ method: "POST", url: "/api/story/imports/telegram/commit", headers: headers(secrets.gm), payload: { actionId: action(), importBatchId: secondReview.json().importBatchId, records: [record], rights: [{ sourceMessageId: record.sourceMessageId, status: "APPROVED" }] } });
    expect(approved.statusCode).toBe(201);
    const publish = await app.inject({ method: "POST", url: `/api/story/posts/${postId}/publish`, headers: headers(secrets.gm), payload: { actionId: action(), revision: 0 } });
    expect(publish.statusCode).toBe(200);
  });});
