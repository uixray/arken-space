import { describe, expect, it } from "vitest";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import {
  appendChatMessage,
  applyChatCreated,
  MAX_AUTO_THREAD_MESSAGES,
  messagesForStream,
  streamForMessage,
  reconcileChatRead,
  retainChatApplicationCancellations,
  threadForStream,
  unreadCountForStream,
} from "./chat-state";

describe("appendChatMessage", () => {
  const messageAt = (id: string, sequence: number) =>
    ({
      id,
      sequence,
      kind: "DICE",
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: "table-thread",
      stream: "TABLE",
    }) as ChatMessageDto;
  const message = messageAt("roll-1", 1);
  const snapshot = {
    snapshotVersion: 20,
    messages: [],
    me: { id: "me" },
    chatThreadStates: [
      {
        threadId: "table-thread",
        stream: "TABLE",
        lastReadSequence: 0,
        latestSequence: 0,
        unreadCount: 0,
      },
      {
        threadId: "rolls-thread",
        stream: "ROLLS",
        lastReadSequence: 0,
        latestSequence: 0,
        unreadCount: 0,
      },
    ],
  } as unknown as GameSnapshot;

  it("keeps an append-only chat event that arrives behind the entity sequence", () => {
    const result = appendChatMessage(snapshot, message, 19);
    expect(result.messages).toEqual([message]);
    expect(result.snapshotVersion).toBe(20);
  });

  it("LOCAL-505: never inflates snapshotVersion from chat sequence", () => {
    const result = appendChatMessage(snapshot, message, 9999);
    expect(result.messages).toEqual([message]);
    expect(result.snapshotVersion).toBe(20);
  });

  it("deduplicates messages by id", () => {
    const once = appendChatMessage(snapshot, message, 21);
    expect(appendChatMessage(once, message, 22)).toBe(once);
  });

  it("applies a terminal marker only to a present original in the notice's thread", () => {
    const original = { ...message, applicationUndo: { cancelled: false } };
    const unrelated = { ...original, id: "elsewhere", threadId: "rolls-thread" };
    const current = { ...snapshot, messages: [original, unrelated] };
    const notice = {
      data: { ...messageAt("notice", 3), kind: "TEXT" as const, membershipId: "author" },
      sequence: 18,
      actionId: "undo",
      emittedAt: message.createdAt,
      cancelledApplicationMessageId: original.id,
    };
    const next = applyChatCreated(current, notice, {});
    expect(next.messages.find((row) => row.id === original.id)?.applicationUndo)
      .toEqual({ cancelled: true });
    expect(next.messages).toContain(unrelated);
    expect(next.snapshotVersion).toBe(snapshot.snapshotVersion);
    expect(next.chatThreadStates[0]?.unreadCount).toBe(1);
    expect(applyChatCreated(next, notice, {})).toBe(next);
    const baseline = { ...notice, cancelledApplicationMessageId: undefined };
    for (const id of ["missing", unrelated.id]) {
      expect(applyChatCreated(current, { ...notice, cancelledApplicationMessageId: id }, {}))
        .toEqual(applyChatCreated(current, baseline, {}));
    }
  });

  it("preserves cancellation through a stale projection without reviving hidden rows", () => {
    const pending = { ...message, applicationUndo: { cancelled: false } };
    const cancelled = { ...message, applicationUndo: { cancelled: true } };
    const incoming = [pending];
    expect(retainChatApplicationCancellations([cancelled], incoming))
      .toEqual([cancelled]);
    expect(pending.applicationUndo.cancelled).toBe(false);
    const empty: ChatMessageDto[] = [];
    expect(retainChatApplicationCancellations([cancelled], empty)).toBe(empty);
    const crossThread = [{ ...pending, threadId: "other" }];
    expect(retainChatApplicationCancellations([cancelled], crossThread)).toBe(crossThread);
  });

  it("держит окно автоматического пополнения, не выбрасывая подгруженное", () => {
    const messages = Array.from(
      { length: MAX_AUTO_THREAD_MESSAGES },
      (_, index) => messageAt(`m-${String(index).padStart(3, "0")}`, index + 1),
    );
    // Номер строго больше последнего в окне: сообщение приходит новым, а не
    // задним числом.
    const newest = messageAt("newest", MAX_AUTO_THREAD_MESSAGES + 1);
    const result = appendChatMessage({ ...snapshot, messages }, newest, 21);
    expect(result.messages).toHaveLength(MAX_AUTO_THREAD_MESSAGES);
    // Самое старое вытеснено, самое новое на месте: окно едет вперёд.
    expect(result.messages[0]?.id).toBe("m-001");
    expect(result.messages.at(-1)?.id).toBe("newest");
  });

  it("places a delayed middle message by authoritative sequence", () => {
    const current = {
      ...snapshot,
      messages: [messageAt("first", 1), messageAt("third", 3)],
    };
    const result = appendChatMessage(current, messageAt("second", 2), 21);
    expect(result.messages.map((item) => item.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("excludes an unseen message older than the retained window", () => {
    const messages = Array.from(
      { length: MAX_AUTO_THREAD_MESSAGES },
      (_, index) => messageAt(`m-${index}`, index + 2),
    );
    const current = { ...snapshot, messages };
    expect(appendChatMessage(current, messageAt("too-old", 1), 21)).toBe(
      current,
    );
  });

  it("ignores createdAt and follows authoritative sequence", () => {
    const later = {
      ...messageAt("later", 2),
      createdAt: "2020-01-01T00:00:00Z",
    };
    const result = appendChatMessage(
      { ...snapshot, messages: [later] },
      { ...messageAt("earlier", 1), createdAt: "2030-01-01T00:00:00Z" },
      21,
    );
    expect(result.messages.map((item) => item.id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("держит окно независимо для каждого потока", () => {
    const table = Array.from({ length: MAX_AUTO_THREAD_MESSAGES }, (_, index) =>
      messageAt(`table-${index}`, index + 1),
    );
    const rolls = Array.from(
      { length: MAX_AUTO_THREAD_MESSAGES },
      (_, index) => ({
        ...messageAt(`roll-${index}`, index + MAX_AUTO_THREAD_MESSAGES + 1),
        threadId: "rolls-thread",
        stream: "ROLLS" as const,
      }),
    );
    const result = appendChatMessage(
      { ...snapshot, messages: [...table, ...rolls] },
      messageAt("table-new", MAX_AUTO_THREAD_MESSAGES * 2 + 1),
      MAX_AUTO_THREAD_MESSAGES * 2 + 1,
    );
    // Окно считается по потоку, а не по всей ленте: два полных потока и одно
    // новое сообщение дают два окна, а вытесняется только самое старое в том
    // потоке, куда сообщение пришло.
    expect(result.messages).toHaveLength(MAX_AUTO_THREAD_MESSAGES * 2);
    expect(result.messages.some((item) => item.id === "roll-0")).toBe(true);
    expect(result.messages.some((item) => item.id === "table-0")).toBe(false);
    expect(result.messages.some((item) => item.id === "table-new")).toBe(true);
  });

  it("selects and resolves the authoritative stream", () => {
    const table = messageAt("table", 2);
    const rolls = {
      ...messageAt("roll", 1),
      threadId: "rolls-thread",
      stream: "ROLLS" as const,
    };
    expect(messagesForStream([table, rolls], "ROLLS")).toEqual([rolls]);
    expect(streamForMessage([table, rolls], "roll")).toBe("ROLLS");
    expect(streamForMessage([table, rolls], "missing")).toBeNull();
  });

  it("never projects DIRECT stream:null messages into TABLE", () => {
    const direct = {
      ...messageAt("private", 3),
      threadId: "direct-thread",
      stream: null,
    };
    const threads = [
      { id: "direct-thread", type: "DIRECT", stream: null },
    ] as unknown as GameSnapshot["chatThreads"];
    expect(messagesForStream([message, direct], "TABLE", threads)).toEqual([
      message,
    ]);
    expect(streamForMessage([direct], direct.id, threads)).toBeNull();
  });

  it("increments unread only for another member in an inactive thread", () => {
    const incoming = { ...messageAt("incoming", 4), membershipId: "other" };
    const unread = appendChatMessage(snapshot, incoming, 21, {
      activeThreadId: "rolls-thread",
      ownMembershipId: "me",
    });
    expect(unread.chatThreadStates[0]).toMatchObject({
      latestSequence: 4,
      unreadCount: 1,
    });
    const active = appendChatMessage(snapshot, incoming, 21, {
      activeThreadId: "table-thread",
      ownMembershipId: "me",
    });
    expect(active.chatThreadStates[0]?.unreadCount).toBe(0);
    const own = appendChatMessage(
      snapshot,
      { ...incoming, membershipId: "me" },
      21,
      { activeThreadId: "rolls-thread", ownMembershipId: "me" },
    );
    expect(own.chatThreadStates[0]?.unreadCount).toBe(0);
  });

  it("reconciles a durable read cursor immediately", () => {
    const current = {
      ...snapshot,
      chatThreadStates: [
        {
          ...snapshot.chatThreadStates[0]!,
          latestSequence: 8,
          unreadCount: 5,
          lastReadSequence: 3,
        },
      ],
    };
    const result = reconcileChatRead(current, {
      campaignId: "campaign",
      threadId: "table-thread",
      lastReadSequence: 8,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.chatThreadStates[0]).toMatchObject({
      lastReadSequence: 8,
      unreadCount: 0,
    });
  });

  it("treats legacy snapshots without chat threads as having no stream thread", () => {
    const legacySnapshot = {
      ...snapshot,
      chatThreads: undefined,
    } as unknown as GameSnapshot;

    expect(threadForStream(legacySnapshot, "TABLE")).toBeNull();
    expect(unreadCountForStream(legacySnapshot, "TABLE")).toBe(0);
  });
});
