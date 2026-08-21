import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@arken/contracts";
import { activityReadTargets, feedForChatStream } from "./sidebar-feed";
import { normalizeCharacterControllerIds } from "./character-controller-access-state";

const snapshot = (messages: GameSnapshot["messages"]): GameSnapshot =>
  ({
    messages,
    chatThreads: (["TABLE", "STORY", "ROLLS"] as const).map((stream) => ({
      id: `${stream.toLowerCase()}-thread`,
      campaignId: "campaign",
      type: "STREAM",
      stream,
      createdAt: "2026-07-26T09:00:00.000Z",
      updatedAt: "2026-07-26T09:00:00.000Z",
    })),
  }) as GameSnapshot;

const message = (
  id: string,
  stream: "TABLE" | "STORY" | "ROLLS",
  sequence: number,
) =>
  ({
    id,
    threadId: `${stream.toLowerCase()}-thread`,
    stream,
    sequence,
  }) as GameSnapshot["messages"][number];

describe("unified activity feed routing", () => {
  it("maps TABLE notification and deep-link requests to the activity feed", () => {
    expect(feedForChatStream("TABLE")).toBe("ACTIVITY");
    expect(feedForChatStream("ROLLS")).toBe("ACTIVITY");
  });

  it("reads the latest visible sequence for every stream in Activity", () => {
    expect(
      activityReadTargets(
        snapshot([
          message("table-old", "TABLE", 3),
          message("roll", "ROLLS", 9),
          message("story", "STORY", 11),
          message("table-latest", "TABLE", 7),
        ]),
      ),
    ).toEqual([
      { threadId: "table-thread", sequence: 7 },
      { threadId: "story-thread", sequence: 11 },
      { threadId: "rolls-thread", sequence: 9 },
    ]);
    expect(activityReadTargets(snapshot([]))).toEqual([]);
  });

  it("does not mark streams hidden by the Activity filters as read", () => {
    const current = snapshot([
      message("table", "TABLE", 7),
      message("roll", "ROLLS", 9),
      message("story", "STORY", 11),
    ]);
    expect(activityReadTargets(current, new Set(["REFERENCE"]))).toEqual([
      { threadId: "table-thread", sequence: 7 },
    ]);
    expect(activityReadTargets(current, new Set(["STORY", "ROLLS"]))).toEqual([
      { threadId: "story-thread", sequence: 11 },
      { threadId: "rolls-thread", sequence: 9 },
    ]);
  });
});

describe("character controller access", () => {
  it("always includes the owner and removes duplicate assignments", () => {
    expect(
      normalizeCharacterControllerIds(
        ["player-2", "owner", "player-2"],
        "owner",
      ),
    ).toEqual(["owner", "player-2"]);
  });

  it("preserves assignments when the character has no owner", () => {
    expect(normalizeCharacterControllerIds(["player-2"], null)).toEqual([
      "player-2",
    ]);
  });
});
