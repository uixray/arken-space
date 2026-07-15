import { describe, expect, it } from "vitest";
import type { ChatMessageDto, GameSnapshot } from "@arken/contracts";
import { appendChatMessage } from "./chat-state";

describe("appendChatMessage", () => {
  const messageAt = (id: string, sequence: number) =>
    ({
      id,
      sequence,
      kind: "DICE",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as ChatMessageDto;
  const message = messageAt("roll-1", 1);
  const snapshot = {
    snapshotVersion: 20,
    messages: [],
  } as unknown as GameSnapshot;

  it("keeps an append-only chat event that arrives behind the entity sequence", () => {
    const result = appendChatMessage(snapshot, message, 19);
    expect(result.messages).toEqual([message]);
    expect(result.snapshotVersion).toBe(20);
  });

  it("deduplicates messages by id", () => {
    const once = appendChatMessage(snapshot, message, 21);
    expect(appendChatMessage(once, message, 22)).toBe(once);
  });

  it("keeps only the accepted 200-message window", () => {
    const messages = Array.from({ length: 200 }, (_, index) =>
      messageAt(`m-${String(index).padStart(3, "0")}`, index + 1),
    );
    const newest = messageAt("newest", 201);
    const result = appendChatMessage({ ...snapshot, messages }, newest, 21);
    expect(result.messages).toHaveLength(200);
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
    const messages = Array.from({ length: 200 }, (_, index) =>
      messageAt(`m-${index}`, index + 2),
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
});
