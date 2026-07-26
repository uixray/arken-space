import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { activityTableReadTarget, feedForChatStream } from "./sidebar-feed";

const snapshot = (messages: GameSnapshot["messages"]): GameSnapshot =>
  ({
    messages,
    chatThreads: [
      {
        id: "table-thread",
        campaignId: "campaign",
        type: "STREAM",
        stream: "TABLE",
        createdAt: "2026-07-26T09:00:00.000Z",
        updatedAt: "2026-07-26T09:00:00.000Z",
      },
    ],
  }) as GameSnapshot;

const message = (id: string, stream: "TABLE" | "ROLLS", sequence: number) =>
  ({
    id,
    threadId: stream === "TABLE" ? "table-thread" : "rolls-thread",
    stream,
    sequence,
  }) as GameSnapshot["messages"][number];

describe("unified activity feed routing", () => {
  it("maps TABLE notification and deep-link requests to the activity feed", () => {
    expect(feedForChatStream("TABLE")).toBe("ACTIVITY");
    expect(feedForChatStream("ROLLS")).toBe("ROLLS");
  });

  it("reads the latest visible TABLE sequence while the activity feed is active", () => {
    expect(
      activityTableReadTarget(
        snapshot([
          message("table-old", "TABLE", 3),
          message("roll", "ROLLS", 9),
          message("table-latest", "TABLE", 7),
        ]),
      ),
    ).toEqual({ threadId: "table-thread", sequence: 7 });
    expect(activityTableReadTarget(snapshot([]))).toBeNull();
  });
});
