import { describe, expect, it, vi } from "vitest";
import {
  filterActivityEvents,
  formulaBonus,
  physicalRollBonus,
  physicalRollChatRequest,
  physicalRollMessage,
  readRollLogCollapsed,
  rollLogCollapsedStorageKey,
  rollLogHistoryPresentation,
  writeRollLogCollapsed,
} from "./activity-roll-controls";
import type { ActivityEvent } from "./activity-feed";

const message = (stream: "TABLE" | "STORY" | "ROLLS", kind = "TEXT") =>
  ({
    type: "MESSAGE",
    id: stream,
    occurredAt: "2026-07-26T10:00:00Z",
    stream,
    message: {
      id: stream,
      threadId: "t",
      sequence: 1,
      stream,
      kind,
      body: stream,
      displayName: "A",
      visibility: "PUBLIC",
      createdAt: "2026-07-26T10:00:00Z",
    },
  }) as ActivityEvent;

describe("activity roll controls", () => {
  it("filters roll, story and reference events independently", () => {
    const events = [
      message("ROLLS", "DICE"),
      message("STORY"),
      message("TABLE"),
    ];
    expect(
      filterActivityEvents(events, new Set(["ROLLS", "REFERENCE"])).map(
        (event) => event.id,
      ),
    ).toEqual(["ROLLS", "TABLE"]);
  });
  it("calculates the shown physical bonus from stats and constants", () => {
    expect(formulaBonus("1d20 + agility + 2", { agility: 3 })).toBe(5);
    expect(formulaBonus("1d20 - strength", { strength: 1 })).toBe(-1);
  });
  it("describes a physical roll without generating a result", () => {
    expect(physicalRollMessage("Ловкость", 3)).toContain("прибавьте +3");
    expect(physicalRollMessage("Сила", -1)).toContain("бонус -1");
  });
  it("extracts the physical bonus for prominent rendering", () => {
    expect(physicalRollBonus(physicalRollMessage("Сила воли", 4))).toBe("+4");
    expect(physicalRollBonus("Обычное сообщение · бонус +4.")).toBeNull();
  });

  it("keeps the GM-selected character attribution for a physical roll", () => {
    expect(
      physicalRollChatRequest("Сила", 2, "selected-character"),
    ).toMatchObject({
      characterId: "selected-character",
      body: expect.stringContaining("+2"),
    });
  });

  it("scopes the roll-log collapse preference to the membership", () => {
    expect(rollLogCollapsedStorageKey("member:b")).toBe(
      "arken:roll-log-collapsed:member:b",
    );
  });

  it("defaults the roll-log to expanded and only accepts the explicit true value", () => {
    expect(readRollLogCollapsed({ getItem: () => null }, "member")).toBe(false);
    expect(readRollLogCollapsed({ getItem: () => "false" }, "member")).toBe(
      false,
    );
    expect(readRollLogCollapsed({ getItem: () => "true" }, "member")).toBe(
      true,
    );
  });

  it("survives unavailable storage for the roll-log preference", () => {
    expect(
      readRollLogCollapsed(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        "member",
      ),
    ).toBe(false);

    expect(() =>
      writeRollLogCollapsed(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "member",
        true,
      ),
    ).not.toThrow();
  });

  it("persists a boolean string under the scoped roll-log key", () => {
    const setItem = vi.fn();
    writeRollLogCollapsed({ setItem }, "member", true);
    expect(setItem).toHaveBeenCalledWith(
      "arken:roll-log-collapsed:member",
      "true",
    );
  });

  it("describes a collapsed history without hiding how much was truncated", () => {
    expect(rollLogHistoryPresentation(14, true)).toEqual({
      actionLabel: "Показать больше",
      showControl: true,
      truncatedLabel: "Показаны последние 8 из 14.",
      visibleEntryCount: 8,
    });
  });

  it("describes an expanded history with the opposite explicit action", () => {
    expect(rollLogHistoryPresentation(14, false)).toEqual({
      actionLabel: "Показать меньше",
      showControl: true,
      truncatedLabel: null,
      visibleEntryCount: 14,
    });
  });

  it("does not offer a history action when every entry already fits", () => {
    expect(rollLogHistoryPresentation(8, true)).toEqual({
      actionLabel: "Показать больше",
      showControl: false,
      truncatedLabel: null,
      visibleEntryCount: 8,
    });
  });
});
