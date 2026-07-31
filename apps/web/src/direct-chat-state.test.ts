import { describe, expect, it } from "vitest";
import type {
  ChatMessageDto,
  DirectChatThreadDto,
  GameSnapshot,
  MembershipDto,
} from "@arken/contracts";
import {
  directChatContacts,
  directThreadForPeer,
  directThreadLabel,
  directThreads,
  directUnreadCount,
  directThreadPeer,
  eligibleDirectRecipients,
  appendDirectMessageResponse,
  messagesForDirectThread,
  persistDirectSelection,
  restoreDirectSelection,
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

  it("resolves an existing thread by peer and keeps histories isolated", () => {
    const second = {
      ...thread,
      id: "thread-2",
      participants: [
        thread.participants[0],
        { membershipId: "c", displayName: "Мария" },
      ],
    } satisfies DirectChatThreadDto;
    const snapshot = {
      me: { id: "a" },
      chatThreads: [thread, second],
      messages: [
        { id: "one", threadId: thread.id, stream: null, sequence: 1 },
        { id: "two", threadId: second.id, stream: null, sequence: 2 },
      ],
    } as unknown as GameSnapshot;
    expect(directThreadForPeer(snapshot, "c")?.id).toBe("thread-2");
    expect(
      messagesForDirectThread(snapshot, thread.id).map(({ id }) => id),
    ).toEqual(["one"]);
    expect(
      messagesForDirectThread(snapshot, second.id).map(({ id }) => id),
    ).toEqual(["two"]);
  });

  it("restores only an authorized peer and repairs a stale thread id", () => {
    const snapshot = {
      campaign: { id: "campaign" },
      me: { id: "a" },
      directChatContacts: [
        { membershipId: "b", displayName: "Даша" },
        { membershipId: "c", displayName: "Мария" },
      ],
      chatThreads: [thread],
    } as unknown as GameSnapshot;
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    expect(
      directChatContacts(snapshot).map(({ membershipId }) => membershipId),
    ).toEqual(["b", "c"]);
    persistDirectSelection(storage, snapshot, {
      peerMembershipId: "b",
      threadId: "stale",
    });
    expect(restoreDirectSelection(storage, snapshot)).toEqual({
      peerMembershipId: "b",
      threadId: thread.id,
    });
    persistDirectSelection(storage, snapshot, {
      peerMembershipId: "outsider",
      threadId: null,
    });
    expect(restoreDirectSelection(storage, snapshot)).toBeNull();
  });

  it("treats legacy snapshots without direct chat projections as empty", () => {
    const legacySnapshot = {
      messages: [],
      snapshotVersion: 4,
    } as unknown as GameSnapshot;

    expect(directThreads(legacySnapshot)).toEqual([]);
    expect(directUnreadCount(legacySnapshot, thread.id)).toBe(0);
    const result = upsertDirectThread(legacySnapshot, thread);
    expect(result.chatThreads).toEqual([thread]);
    expect(result.chatThreadStates).toHaveLength(1);
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
