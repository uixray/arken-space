import { describe, expect, it } from "vitest";
import type {
  ChatMessageDto,
  DirectChatThreadDto,
  GameSnapshot,
  MembershipDto,
} from "@arken/contracts";
import {
  directThreadLabel,
  directThreadPeer,
  eligibleDirectRecipients,
  appendDirectMessageResponse,
  upsertDirectThread,
} from "./direct-chat-state";

const thread: DirectChatThreadDto = {
  id: "thread",
  campaignId: "campaign",
  type: "DIRECT",
  stream: null,
  participants: [
    { membershipId: "a", displayName: "Ираклий" },
    { membershipId: "b", displayName: "Даша" },
  ],
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
};

describe("direct chat presentation", () => {
  it("uses the exact other participant rather than implying GM access", () => {
    expect(directThreadPeer(thread, "a")).toEqual(thread.participants[1]);
    expect(directThreadLabel(thread, "a")).toBe("Даша");
    expect(directThreadLabel(thread, "b")).toBe("Ираклий");
  });

  it("offers every other campaign membership, including GM as an explicit peer", () => {
    const members = [
      { id: "a", displayName: "Я", role: "PLAYER", characterId: null },
      { id: "gm", displayName: "Семён", role: "GM", characterId: null },
      { id: "b", displayName: "Даша", role: "PLAYER", characterId: null },
    ] satisfies MembershipDto[];
    expect(
      eligibleDirectRecipients(members, "a").map((item) => item.id),
    ).toEqual(["b", "gm"]);
  });

  it("upserts a participant-scoped brand-new thread with initial unread state", () => {
    const snapshot = {
      chatThreads: [],
      chatThreadStates: [],
      messages: [],
      snapshotVersion: 4,
    } as unknown as GameSnapshot;
    const result = upsertDirectThread(snapshot, thread);
    expect(result.chatThreads).toEqual([thread]);
    expect(result.chatThreadStates).toEqual([
      {
        threadId: "thread",
        stream: null,
        lastReadSequence: 0,
        latestSequence: 0,
        unreadCount: 0,
      },
    ]);
    expect(upsertDirectThread(result, thread)).toBe(result);
  });

  it("appends an HTTP replay DTO when socket delivery was lost and deduplicates a late socket", () => {
    const snapshot = upsertDirectThread(
      {
        chatThreads: [],
        chatThreadStates: [],
        messages: [],
        snapshotVersion: 4,
      } as unknown as GameSnapshot,
      thread,
    );
    const message = {
      id: "message",
      sequence: 9,
      membershipId: "b",
      displayName: "Даша",
      characterId: null,
      body: "Тихо",
      visibility: "PUBLIC",
      kind: "TEXT",
      threadId: thread.id,
      stream: null,
      dice: null,
      createdAt: "2026-07-22T10:01:00.000Z",
    } satisfies ChatMessageDto;
    const result = appendDirectMessageResponse(snapshot, message, {
      ownMembershipId: "a",
      activeThreadId: null,
    });
    expect(result.messages).toEqual([message]);
    expect(result.chatThreadStates[0]).toMatchObject({
      latestSequence: 9,
      unreadCount: 1,
    });
    expect(
      appendDirectMessageResponse(result, message, { ownMembershipId: "a" }),
    ).toBe(result);
  });
});
