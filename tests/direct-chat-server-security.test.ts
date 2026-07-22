import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const routesUrl = new URL("../apps/server/src/routes.ts", import.meta.url);
const snapshotUrl = new URL("../apps/server/src/snapshot.ts", import.meta.url);

describe("direct chat server security invariants", () => {
  it("bounds multipart before buffering and accounts for every media owner", async () => {
    const source = await readFile(routesUrl, "utf8");
    const upload = source.slice(
      source.indexOf('app.post("/api/chat/attachments"'),
    );
    expect(upload).toContain(
      "limits: { files: 1, fileSize: env.MAX_IMAGE_BYTES }",
    );
    expect(upload.indexOf("limits:")).toBeLessThan(
      upload.indexOf("toBuffer()"),
    );
    expect(upload).toContain("file.file.truncated");
    expect(upload).toContain("sum(assets.sizeBytes)");
    expect(upload).toContain("sum(feedbackAttachments.sizeBytes)");
    expect(upload).toContain("sum(chatAttachmentUploads.sizeBytes)");
    expect(upload).toContain(".limit(25)");
    expect(upload).toContain("removeStoredUpload(item.storageKey)");
  });

  it("restores attachment metadata only for messages already authorized in snapshot", async () => {
    const source = await readFile(snapshotUrl, "utf8");
    expect(source).toContain("attachmentsByMessage");
    expect(source).toContain(
      "inArray(chatAttachments.messageId, visibleMessageIds)",
    );
    expect(source).toContain("contentId: upload.contentId");
    expect(source).not.toContain("storageKey: upload.storageKey");
  });

  it("accepts idempotent replay only for the same actor, event type and thread", async () => {
    const source = await readFile(routesUrl, "utf8");
    const direct = source.slice(
      source.indexOf('app.post("/api/chat/direct/messages"'),
      source.indexOf('app.post("/api/chat"'),
    );
    expect(direct).toContain("duplicate.membershipId === auth.membershipId");
    expect(direct).toContain('duplicate.type === "chat.created"');
    expect(direct).toContain("duplicate.payload.threadId === thread.id");
    expect(direct).toContain('error: "ACTION_ID_CONFLICT"');
    expect(direct).toContain("replay?.membershipId === auth.membershipId");
    expect(direct).toContain("send(duplicate.payload)");
    expect(direct).toContain("send(replay.payload)");
    expect(direct).not.toContain("send({ duplicate: true })");
  });

  it("delivers a brand-new direct thread only to its two member rooms", async () => {
    const source = await readFile(routesUrl, "utf8");
    const create = source.slice(
      source.indexOf('app.post("/api/chat/direct"'),
      source.indexOf('app.post("/api/chat/direct/messages"'),
    );
    expect(create).toContain('emit("chat:thread_created", event)');
    expect(create).toContain("for (const membershipId of participantIds)");
    expect(create).toContain("thread: dto");
    expect(create).toContain("stream: null");
    expect(create).not.toContain("campaignRoom(");
    expect(create).not.toContain("gmRoom(");
  });
});
