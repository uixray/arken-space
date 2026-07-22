import { describe, expect, it } from "vitest";
import {
  chatAttachmentMetadataSchema,
  chatThreadTypeSchema,
  createChatMessageSchema,
  createDirectChatMessageSchema,
  createOrGetDirectChatThreadSchema,
  type ServerToClientEvents,
} from "../packages/contracts/src/index.js";

const uuid = (suffix: string) =>
  `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("direct chat contracts", () => {
  it("accepts a recipient membership and requires direct sends to name a thread", () => {
    expect(chatThreadTypeSchema.options).toEqual(["STREAM", "DIRECT"]);
    expect(
      createOrGetDirectChatThreadSchema.parse({
        participantMembershipId: uuid("1"),
      }),
    ).toEqual({ participantMembershipId: uuid("1") });
    expect(
      createOrGetDirectChatThreadSchema.safeParse({
        participantMembershipId: "self",
      }).success,
    ).toBe(false);
    expect(
      createDirectChatMessageSchema.parse({
        actionId: uuid("2"),
        threadId: uuid("3"),
        body: "private",
      }),
    ).toMatchObject({ threadId: uuid("3"), attachmentContentIds: [] });
    expect(
      createDirectChatMessageSchema.safeParse({
        actionId: uuid("2"),
        body: "missing thread",
      }).success,
    ).toBe(false);
    expect(
      createDirectChatMessageSchema.safeParse({
        actionId: uuid("2"),
        threadId: uuid("3"),
        body: "private",
        visibility: "GM_ONLY",
      }).success,
    ).toBe(false);
    expect(
      createChatMessageSchema.safeParse({
        actionId: uuid("2"),
        threadId: uuid("3"),
        stream: "TABLE",
        body: "ambiguous",
      }).success,
    ).toBe(false);
  });

  it("leaves same-campaign participant authorization to the server boundary", () => {
    // A UUID-shaped recipient/thread is not proof of participation. Routes must
    // resolve campaign membership and direct-thread ACL before returning data.
    expect(
      createOrGetDirectChatThreadSchema.safeParse({
        participantMembershipId: uuid("999"),
      }).success,
    ).toBe(true);
    expect(
      createDirectChatMessageSchema.safeParse({
        actionId: uuid("2"),
        threadId: uuid("999"),
        body: "requires server ACL",
      }).success,
    ).toBe(true);
  });

  it("contracts participant-scoped direct thread realtime state", () => {
    const listener: ServerToClientEvents["chat:thread_created"] = (event) => {
      expect(event.thread.type).toBe("DIRECT");
      expect(event.thread.participants).toHaveLength(2);
      expect(event.state.threadId).toBe(event.thread.id);
      expect(event.state.stream).toBeNull();
    };
    listener({
      thread: {
        id: uuid("10"),
        campaignId: uuid("11"),
        type: "DIRECT",
        stream: null,
        participants: [
          { membershipId: uuid("1"), displayName: "A" },
          { membershipId: uuid("2"), displayName: "B" },
        ],
        createdAt: "2026-07-22T12:00:00.000Z",
        updatedAt: "2026-07-22T12:00:00.000Z",
      },
      state: {
        threadId: uuid("10"),
        stream: null,
        lastReadSequence: 0,
        latestSequence: 0,
        unreadCount: 0,
      },
    });
  });

  it("exposes attachment metadata by opaque content ID without storage details", () => {
    const publicMetadata = {
      contentId: uuid("5"),
      fileName: "map.webp",
      mimeType: "image/webp",
      sizeBytes: 42,
      width: 10,
      height: 20,
      createdAt: "2026-07-22T12:00:00.000Z",
    };
    expect(chatAttachmentMetadataSchema.parse(publicMetadata)).toEqual(
      publicMetadata,
    );
    expect(
      chatAttachmentMetadataSchema.safeParse({
        ...publicMetadata,
        storageKey: "private/path",
      }).success,
    ).toBe(false);
    expect(
      createChatMessageSchema.safeParse({
        actionId: uuid("2"),
        threadId: uuid("3"),
        body: "x",
        attachmentContentIds: [uuid("5"), uuid("5")],
      }).success,
    ).toBe(false);
  });
});
