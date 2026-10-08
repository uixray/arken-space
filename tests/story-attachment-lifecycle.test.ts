import { readdir, readFile } from "node:fs/promises";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { join } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../packages/db/src/schema.js";
import { registerRoutes } from "../apps/server/src/routes.js";
import { env } from "../apps/server/src/env.js";
import { hashToken } from "../apps/server/src/security.js";
import { mediaRoot } from "../apps/server/src/storage.js";

const campaign = crypto.randomUUID();
const foreignCampaign = crypto.randomUUID();
const gm = crypto.randomUUID();
const player = crypto.randomUUID();
const foreignGm = crypto.randomUUID();
const peerGm = crypto.randomUUID();
const gmSecret = "g".repeat(40);
const playerSecret = "p".repeat(40);
const foreignSecret = "f".repeat(40);
const peerSecret = "h".repeat(40);
let pg: PGlite;
let app: ReturnType<typeof Fastify>;
const createdFiles: string[] = [];
const auth = (secret: string) => ({
  cookie: `${env.SESSION_COOKIE_NAME}=${secret}`,
});

beforeEach(async () => {
  pg = new PGlite();
  for (const file of (
    await readdir(new URL("../packages/db/drizzle/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await pg.exec(
      (
        await readFile(
          new URL(`../packages/db/drizzle/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("--> statement-breakpoint", ""),
    );
  }
  const db = drizzle(pg, { schema });
  await db.insert(schema.campaigns).values([
    { id: campaign, name: "Lifecycle" },
    { id: foreignCampaign, name: "Other" },
  ]);
  await db.insert(schema.memberships).values([
    { id: gm, campaignId: campaign, role: "GM", displayName: "GM" },
    { id: player, campaignId: campaign, role: "PLAYER", displayName: "Player" },
    { id: peerGm, campaignId: campaign, role: "GM", displayName: "Peer GM" },
    {
      id: foreignGm,
      campaignId: foreignCampaign,
      role: "GM",
      displayName: "Foreign GM",
    },
  ]);
  await db.insert(schema.sessions).values([
    {
      membershipId: gm,
      tokenHash: hashToken(gmSecret),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: player,
      tokenHash: hashToken(playerSecret),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: foreignGm,
      tokenHash: hashToken(foreignSecret),
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      membershipId: peerGm,
      tokenHash: hashToken(peerSecret),
      expiresAt: new Date(Date.now() + 60_000),
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
  await pg?.close();
  await Promise.all(
    createdFiles.splice(0).map((path) => unlink(path).catch(() => undefined)),
  );
});

describe("story attachment lifecycle", () => {
  it("scopes candidates and deletes to the authenticated GM's own campaign uploads", async () => {
    const peerContentId = crypto.randomUUID();
    const foreignContentId = crypto.randomUUID();
    const db = drizzle(pg, { schema });
    await db.insert(schema.chatAttachmentUploads).values([
      {
        campaignId: campaign,
        contentId: peerContentId,
        uploadedByMembershipId: peerGm,
        fileName: "peer.webp",
        storageKey: "peer.webp",
        mimeType: "image/webp",
        sizeBytes: 64,
        status: "STAGED",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        campaignId: foreignCampaign,
        contentId: foreignContentId,
        uploadedByMembershipId: foreignGm,
        fileName: "foreign.webp",
        storageKey: "foreign.webp",
        mimeType: "image/webp",
        sizeBytes: 64,
        status: "STAGED",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const list = await app.inject({
      method: "GET",
      url: "/api/story/attachments",
      headers: auth(gmSecret),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().attachments).toEqual([]);
    for (const contentId of [peerContentId, foreignContentId]) {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/story/attachments/${contentId}`,
        headers: auth(gmSecret),
        payload: { actionId: crypto.randomUUID() },
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("is GM-only and exposes no storage key; direct-reference count is opaque", async () => {
    const contentId = crypto.randomUUID();
    const db = drizzle(pg, { schema });
    await db.insert(schema.chatAttachmentUploads).values({
      campaignId: campaign,
      contentId,
      uploadedByMembershipId: gm,
      fileName: "private-dm.png",
      storageKey: "not-a-path.webp",
      mimeType: "image/webp",
      sizeBytes: 64,
      status: "STAGED",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const threadId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const pair = [gm, player].sort();
    await db.insert(schema.chatThreads).values({
      id: threadId,
      campaignId: campaign,
      type: "DIRECT",
      stream: null,
      participantAMembershipId: pair[0],
      participantBMembershipId: pair[1],
    });
    await db.insert(schema.chatMessages).values({
      id: messageId,
      campaignId: campaign,
      membershipId: gm,
      threadId,
      body: "private text",
      sequence: 1,
    });
    await db
      .insert(schema.chatAttachments)
      .values({ campaignId: campaign, contentId, threadId, messageId });
    const story = await app.inject({
      method: "POST",
      url: "/api/story/posts",
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        title: "Current story",
        body: "Draft",
        media: [{ contentId, order: 0, altText: "Cover", caption: "Caption" }],
      },
    });
    expect(story.statusCode).toBe(201);
    const published = await app.inject({
      method: "POST",
      url: `/api/story/posts/${story.json().id}/publish`,
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        revision: story.json().revision,
      },
    });
    expect(published.statusCode).toBe(200);
    const denied = await app.inject({
      method: "GET",
      url: "/api/story/attachments",
      headers: auth(playerSecret),
    });
    expect(denied.statusCode).toBe(403);
    const listed = await app.inject({
      method: "GET",
      url: "/api/story/attachments",
      headers: auth(gmSecret),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().attachments[0]).toMatchObject({
      contentId,
      storyRevisionCount: 2,
      directChatReferenceCount: 1,
    });
    expect(listed.json().attachments[0].storyReferences).toEqual([
      {
        postId: story.json().id,
        revision: 0,
        title: "Current story",
        lifecycle: "DRAFT",
        visibility: "GM_ONLY",
        isCurrent: false,
      },
      {
        postId: story.json().id,
        revision: 1,
        title: "Current story",
        lifecycle: "PUBLISHED",
        visibility: "PUBLIC",
        isCurrent: true,
      },
    ]);
    expect(JSON.stringify(listed.json())).not.toContain("not-a-path");
    expect(JSON.stringify(listed.json())).not.toContain("private text");
    expect(JSON.stringify(listed.json())).not.toContain(threadId);
    expect(JSON.stringify(listed.json())).not.toContain("body");
    expect(JSON.stringify(listed.json())).not.toContain("gmNotes");
    await db
      .delete(schema.storyPostMedia)
      .where(eq(schema.storyPostMedia.contentId, contentId));
    const directUsed = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: crypto.randomUUID() },
    });
    expect(directUsed.statusCode).toBe(409);
  });

  it("refuses deletion while any historical story revision references the upload", async () => {
    const contentId = crypto.randomUUID();
    const db = drizzle(pg, { schema });
    // Use the route to create a valid story thread/post/revision, then attach test media
    // to its immutable revision row to model a historical reference.
    const created = await app.inject({
      method: "POST",
      url: "/api/story/posts",
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        title: "Revision one",
        body: "Draft",
      },
    });
    expect(created.statusCode).toBe(201);
    const post = created.json();
    await db.insert(schema.chatAttachmentUploads).values({
      campaignId: campaign,
      contentId,
      uploadedByMembershipId: gm,
      fileName: "history.webp",
      storageKey: "historical.webp",
      mimeType: "image/webp",
      sizeBytes: 64,
      status: "CLAIMED",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(schema.storyPostMedia).values({
      campaignId: campaign,
      postId: post.id,
      revision: post.revision,
      contentId,
      sortOrder: 0,
      altText: "old version",
    });
    const corrected = await app.inject({
      method: "PATCH",
      url: `/api/story/posts/${post.id}`,
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        revision: post.revision,
        title: "Revision two",
        body: "Corrected body",
        media: [],
      },
    });
    expect(corrected.statusCode).toBe(200);
    const usage = await app.inject({
      method: "GET",
      url: "/api/story/attachments",
      headers: auth(gmSecret),
    });
    expect(usage.json().attachments[0].storyReferences).toEqual([
      {
        postId: post.id,
        revision: 0,
        title: "Revision one",
        lifecycle: "DRAFT",
        visibility: "GM_ONLY",
        isCurrent: false,
      },
    ]);
    const response = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "ATTACHMENT_IN_USE" });
  });

  it("replaces A with staged B as a new revision without mutating A or its bytes", async () => {
    const contentA = crypto.randomUUID();
    const contentB = crypto.randomUUID();
    const oldStorageKey = `story-attachment-old-${crypto.randomUUID()}.webp`;
    const oldFile = join(mediaRoot(), oldStorageKey);
    const oldBytes = Buffer.from("immutable original story attachment bytes");
    await mkdir(mediaRoot(), { recursive: true });
    await writeFile(oldFile, oldBytes, { flag: "wx" });
    createdFiles.push(oldFile);
    const db = drizzle(pg, { schema });
    await db.insert(schema.chatAttachmentUploads).values([
      {
        campaignId: campaign,
        contentId: contentA,
        uploadedByMembershipId: gm,
        fileName: "A.webp",
        storageKey: oldStorageKey,
        mimeType: "image/webp",
        sizeBytes: oldBytes.length,
        status: "STAGED",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        campaignId: campaign,
        contentId: contentB,
        uploadedByMembershipId: gm,
        fileName: "B.webp",
        storageKey: "story-attachment-new.webp",
        mimeType: "image/webp",
        sizeBytes: 64,
        status: "STAGED",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const created = await app.inject({
      method: "POST",
      url: "/api/story/posts",
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        title: "Original",
        body: "Story",
        media: [
          {
            contentId: contentA,
            order: 0,
            altText: "Original alt",
            caption: "Original caption",
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const replaced = await app.inject({
      method: "PATCH",
      url: `/api/story/posts/${created.json().id}`,
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        revision: created.json().revision,
        title: "Replaced",
        body: "Story",
        media: [
          {
            contentId: contentB,
            order: 0,
            altText: "Replacement alt",
            caption: "Replacement caption",
          },
        ],
      },
    });
    expect(replaced.statusCode).toBe(200);
    const revisions = await db
      .select()
      .from(schema.storyPostMedia)
      .where(eq(schema.storyPostMedia.postId, created.json().id));
    expect(revisions.map((media) => [media.revision, media.contentId])).toEqual(
      [
        [0, contentA],
        [1, contentB],
      ],
    );
    expect(revisions[0]).toMatchObject({
      altText: "Original alt",
      caption: "Original caption",
    });
    expect(revisions[1]).toMatchObject({
      altText: "Replacement alt",
      caption: "Replacement caption",
    });
    expect(await readFile(oldFile)).toEqual(oldBytes);
    const [original] = await db
      .select()
      .from(schema.chatAttachmentUploads)
      .where(eq(schema.chatAttachmentUploads.contentId, contentA));
    expect(original).toMatchObject({
      storageKey: oldStorageKey,
      status: "CLAIMED",
    });
    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentA}`,
      headers: auth(gmSecret),
      payload: { actionId: crypto.randomUUID() },
    });
    expect(blocked.statusCode).toBe(409);
    expect(await readFile(oldFile)).toEqual(oldBytes);
  });

  it("tombstones before blob cleanup and permits a later idempotent retry", async () => {
    const contentId = crypto.randomUUID();
    const db = drizzle(pg, { schema });
    await db.insert(schema.chatAttachmentUploads).values({
      campaignId: campaign,
      contentId,
      uploadedByMembershipId: gm,
      fileName: "candidate.webp",
      storageKey: "../unsafe",
      mimeType: "image/webp",
      sizeBytes: 64,
      status: "STAGED",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const firstAction = crypto.randomUUID();
    const first = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: firstAction },
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      deleted: false,
      cleanupPending: true,
    });
    const [tombstone] = await db
      .select()
      .from(schema.chatAttachmentUploads)
      .where(eq(schema.chatAttachmentUploads.contentId, contentId));
    expect(tombstone.status).toBe("EXPIRED");
    const expiredClaim = await app.inject({
      method: "POST",
      url: "/api/story/posts",
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        body: "Cannot reclaim",
        media: [{ contentId, order: 0, altText: "Expired" }],
      },
    });
    expect(expiredClaim.statusCode, expiredClaim.body).toBe(404);
    expect(expiredClaim.json()).toEqual({ error: "STORY_MEDIA_NOT_FOUND" });
    const replay = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: firstAction },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      deleted: false,
      cleanupPending: true,
      contentId,
    });
    const audit = await db
      .select()
      .from(schema.gameEvents)
      .where(eq(schema.gameEvents.actionId, firstAction));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].payload)).not.toContain("../unsafe");
    const conflictingContentId = crypto.randomUUID();
    await db.insert(schema.chatAttachmentUploads).values({
      campaignId: campaign,
      contentId: conflictingContentId,
      uploadedByMembershipId: gm,
      fileName: "other.webp",
      storageKey: "other.webp",
      mimeType: "image/webp",
      sizeBytes: 64,
      status: "STAGED",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const conflict = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${conflictingContentId}`,
      headers: auth(gmSecret),
      payload: { actionId: firstAction },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "ACTION_ID_CONFLICT" });
    await db
      .update(schema.chatAttachmentUploads)
      .set({ storageKey: "already-absent.webp" })
      .where(eq(schema.chatAttachmentUploads.contentId, contentId));
    const retry = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: firstAction },
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ deleted: true, contentId });
    const completedReplay = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: firstAction },
    });
    expect(completedReplay.statusCode).toBe(200);
    expect(completedReplay.json()).toEqual({ deleted: true, contentId });
    expect(
      await db
        .select()
        .from(schema.chatAttachmentUploads)
        .where(eq(schema.chatAttachmentUploads.contentId, contentId)),
    ).toHaveLength(0);
  });

  it("serializes concurrent identical actionId deletes without a generic server failure", async () => {
    const contentId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    const db = drizzle(pg, { schema });
    await db.insert(schema.chatAttachmentUploads).values({
      campaignId: campaign,
      contentId,
      uploadedByMembershipId: gm,
      fileName: "concurrent.webp",
      storageKey: "concurrent-already-absent.webp",
      mimeType: "image/webp",
      sizeBytes: 64,
      status: "STAGED",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const request = () =>
      app.inject({
        method: "DELETE",
        url: `/api/story/attachments/${contentId}`,
        headers: auth(gmSecret),
        payload: { actionId },
      });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect(responses.map((response) => response.json())).toEqual([
      { deleted: true, contentId },
      { deleted: true, contentId },
    ]);
    expect(
      await db
        .select()
        .from(schema.gameEvents)
        .where(eq(schema.gameEvents.actionId, actionId)),
    ).toHaveLength(1);
  });

  it("preserves both lock orders for direct-message claim and lifecycle delete", async () => {
    const threadId = crypto.randomUUID();
    const db = drizzle(pg, { schema });
    const [participantA, participantB] = [gm, player].sort();
    await db.insert(schema.chatThreads).values({
      id: threadId,
      campaignId: campaign,
      type: "DIRECT",
      stream: null,
      participantAMembershipId: participantA,
      participantBMembershipId: participantB,
    });
    await mkdir(mediaRoot(), { recursive: true });
    const seedUpload = async () => {
      const contentId = crypto.randomUUID();
      const storageKey = `race-${crypto.randomUUID()}.webp`;
      const storagePath = resolve(mediaRoot(), storageKey);
      await writeFile(storagePath, Buffer.from("test image bytes"));
      createdFiles.push(storagePath);
      await db.insert(schema.chatAttachmentUploads).values({
        campaignId: campaign,
        contentId,
        uploadedByMembershipId: gm,
        fileName: "racing.webp",
        storageKey,
        mimeType: "image/webp",
        sizeBytes: 64,
        status: "STAGED",
        expiresAt: new Date(Date.now() + 60_000),
      });
      return { contentId, storagePath };
    };

    // Positive completion barriers make the lock winner explicit without
    // timing sleeps or test-only hooks into production code.
    const claimFirst = await seedUpload();
    const claimedMessage = await app.inject({
      method: "POST",
      url: "/api/chat/direct/messages",
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        threadId,
        body: "claim first",
        attachmentContentIds: [claimFirst.contentId],
      },
    });
    expect(claimedMessage.statusCode).toBe(201);
    const [claimedUpload] = await db
      .select()
      .from(schema.chatAttachmentUploads)
      .where(eq(schema.chatAttachmentUploads.contentId, claimFirst.contentId));
    expect(claimedUpload.status).toBe("CLAIMED");
    const blockedDelete = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${claimFirst.contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: crypto.randomUUID() },
    });
    expect(blockedDelete.statusCode).toBe(409);
    expect(
      await db
        .select()
        .from(schema.chatAttachments)
        .where(eq(schema.chatAttachments.contentId, claimFirst.contentId)),
    ).toHaveLength(1);
    await expect(readFile(claimFirst.storagePath)).resolves.toEqual(
      Buffer.from("test image bytes"),
    );

    const deleteFirst = await seedUpload();
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/story/attachments/${deleteFirst.contentId}`,
      headers: auth(gmSecret),
      payload: { actionId: crypto.randomUUID() },
    });
    expect(deleted.statusCode).toBe(200);
    const rejectedMessage = await app.inject({
      method: "POST",
      url: "/api/chat/direct/messages",
      headers: auth(gmSecret),
      payload: {
        actionId: crypto.randomUUID(),
        threadId,
        body: "delete first",
        attachmentContentIds: [deleteFirst.contentId],
      },
    });
    expect(rejectedMessage.statusCode).toBe(404);
    expect(rejectedMessage.json()).toEqual({
      error: "CHAT_ATTACHMENT_NOT_FOUND",
    });
    expect(
      await db
        .select()
        .from(schema.chatAttachments)
        .where(eq(schema.chatAttachments.contentId, deleteFirst.contentId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.chatAttachmentUploads)
        .where(
          eq(schema.chatAttachmentUploads.contentId, deleteFirst.contentId),
        ),
    ).toHaveLength(0);
    await expect(readFile(deleteFirst.storagePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
