import { describe, expect, it } from "vitest";
import type { ChatMessageDto } from "@arken/contracts";
import { buildChatTimeline } from "./chat-date";

const messageAt = (id: string, createdAt: string) =>
  ({ id, createdAt }) as ChatMessageDto;

describe("buildChatTimeline", () => {
  it("inserts one date divider before the first message on each day", () => {
    const timeline = buildChatTimeline(
      [
        messageAt("first", "2026-07-21T08:00:00.000Z"),
        messageAt("second", "2026-07-21T20:00:00.000Z"),
        messageAt("third", "2026-07-22T08:00:00.000Z"),
      ],
      { timeZone: "UTC" },
    );

    expect(timeline.map((item) => item.type)).toEqual([
      "DATE",
      "MESSAGE",
      "MESSAGE",
      "DATE",
      "MESSAGE",
    ]);
    expect(timeline.filter((item) => item.type === "DATE")).toEqual([
      expect.objectContaining({
        key: "2026-07-21:first",
        label: "21 июля 2026 г.",
      }),
      expect.objectContaining({
        key: "2026-07-22:third",
        label: "22 июля 2026 г.",
      }),
    ]);
  });

  it("uses the chosen display time zone at a calendar boundary", () => {
    const timeline = buildChatTimeline(
      [
        messageAt("late", "2026-07-21T20:30:00.000Z"),
        messageAt("next", "2026-07-21T21:30:00.000Z"),
      ],
      { timeZone: "Europe/Moscow" },
    );

    expect(timeline.filter((item) => item.type === "DATE")).toHaveLength(2);
  });

  it("keeps supplied authoritative message order and handles invalid timestamps", () => {
    const first = messageAt("first", "not-a-date");
    const second = messageAt("second", "2026-07-21T08:00:00.000Z");
    const timeline = buildChatTimeline([first, second], { timeZone: "UTC" });

    expect(timeline.filter((item) => item.type === "MESSAGE")).toEqual([
      { type: "MESSAGE", message: first },
      { type: "MESSAGE", message: second },
    ]);
    expect(timeline[0]).toEqual(
      expect.objectContaining({ type: "DATE", label: "Неизвестная дата" }),
    );
  });
  it("uses unique divider keys when authoritative order returns to a prior day", () => {
    const messages = [
      messageAt("first", "2026-07-21T08:00:00.000Z"),
      messageAt("second", "2026-07-22T08:00:00.000Z"),
      messageAt("third", "2026-07-21T09:00:00.000Z"),
    ];
    const timeline = buildChatTimeline(messages, { timeZone: "UTC" });
    const dividers = timeline.filter((item) => item.type === "DATE");

    expect(new Set(dividers.map((item) => item.key)).size).toBe(3);
    expect(timeline.filter((item) => item.type === "MESSAGE")).toEqual(
      messages.map((message) => ({ type: "MESSAGE", message })),
    );
  });
});
