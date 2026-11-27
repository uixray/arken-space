import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Chat routes moved out of routes.ts unchanged; the invariants are read
// from their new module.
const routesUrl = new URL("../apps/server/src/chat-routes.ts", import.meta.url);
// UIX-450: проекция сообщений переехала из `snapshot.ts` в отдельный модуль,
// чтобы маршрут истории отдавал ровно её же, а не свою копию. Инвариант тот
// же, проверяется в новом месте.
const chatHistoryUrl = new URL(
  "../apps/server/src/chat-history.ts",
  import.meta.url,
);

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
    const staging=await readFile(new URL("../apps/server/src/chat-attachment-upload.ts",import.meta.url),"utf8");
    expect(upload).toContain("stageChatAttachment(db,auth,buffer,file.filename)");
    expect(staging).toContain("sum(assets.sizeBytes)");
    expect(staging).toContain("sum(feedbackAttachments.sizeBytes)");
    expect(staging).toContain("sum(chatAttachmentUploads.sizeBytes)");
    expect(staging).toContain("buffer.length > env.MAX_IMAGE_BYTES");
    expect(staging).toContain("reconcileChatUploadFile(db, auth.campaignId, stored.storageKey)");
    const cleanup=await readFile(new URL("../apps/server/src/chat-upload-reconcile.ts",import.meta.url),"utf8");
    expect(cleanup).toContain("FOR UPDATE");expect(cleanup).toContain('isolationLevel: "read committed"');expect(cleanup).toContain('if (reference) return "REFERENCED"');
    expect(upload).toContain(".limit(25)");
    expect(upload).toContain("removeStoredUpload(item.storageKey)");
  });

  it("restores attachment metadata only for messages already authorized in snapshot", async () => {
    const source = await readFile(chatHistoryUrl, "utf8");
    expect(source).toContain("attachmentsByMessage");
    // Идентификаторы для запроса вложений берутся из `rows` — набора, уже
    // прошедшего проверки видимости выше. Возьми их из непроверенного
    // источника, и вложения приедут к тому, кому само сообщение не видно.
    expect(source).toContain("const messageIds = rows.map");
    expect(source).toContain("inArray(chatAttachments.messageId, messageIds)");
    expect(source).toContain("contentId: upload.contentId");
    expect(source).not.toContain("storageKey: upload.storageKey");
  });

  it("accepts idempotent replay only for the same actor, event type and thread", async () => {
    const source = await readFile(routesUrl, "utf8");
    const direct = source.slice(
      source.indexOf('app.post("/api/chat/direct/messages"'),
      source.indexOf('app.post("/api/chat"'),
    );
    const command=await readFile(new URL("../apps/server/src/direct-chat-command.ts",import.meta.url),"utf8");
    expect(command).toContain("event.membershipId === auth.membershipId");
    expect(command).toContain('event.type === "chat.created"');
    expect(command).toContain("dto?.threadId === body.threadId");
    expect(command).toContain("dto.body === body.body");
    expect(command).toContain("body.attachmentContentIds");
    expect(command).toContain('new DirectChatError(409, "ACTION_ID_CONFLICT")');
    expect(command).toContain("FOR UPDATE");
    expect(direct).toContain("submitDirectChat(db,auth,body)");
    expect(direct).toContain("if(saved.duplicate)return reply.code(200).send(saved.dto)");
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
