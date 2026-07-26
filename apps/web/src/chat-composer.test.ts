import { describe, expect, it } from "vitest";
import {
  getSlashCommandSuggestions,
  parseComposerInput,
} from "./chat-composer";

describe("parseComposerInput", () => {
  it("keeps ordinary text separate from explicit roll syntax", () => {
    expect(parseComposerInput("  Привет, группа!  ")).toEqual({
      kind: "TEXT",
      body: "Привет, группа!",
    });
    expect(parseComposerInput("/roll 1d20 + agility")).toEqual({
      kind: "ROLL",
      formula: "1d20 + agility",
    });
    expect(parseComposerInput("d20")).toEqual({
      kind: "ROLL",
      formula: "d20",
    });
    expect(parseComposerInput(" 2D6 + 3 ")).toEqual({
      kind: "ROLL",
      formula: "2d6+3",
    });
    expect(parseComposerInput("Бросаю d20")).toEqual({
      kind: "TEXT",
      body: "Бросаю d20",
    });
  });

  it("turns an available characteristic slash command into a d20 check", () => {
    const stats = { agility: 3, strength: 1 };
    expect(parseComposerInput("/agility", stats)).toEqual({
      kind: "ROLL",
      formula: "1d20 + agility",
      label:
        "Проверка: Ловкость",
    });
    expect(parseComposerInput("/knowledge", stats)).toEqual({
      kind: "TEXT",
      body: "/knowledge",
    });
  });

  it("turns the dedicated d20 command into an ordinary roll", () => {
    expect(parseComposerInput("/d20")).toEqual({
      kind: "ROLL",
      formula: "1d20",
      label: "d20",
    });
  });

  it("does not treat incomplete or arbitrary slash text as dice", () => {
    expect(parseComposerInput("/roll").kind).toBe("INVALID");
    expect(parseComposerInput("/roll-call")).toEqual({
      kind: "TEXT",
      body: "/roll-call",
    });
  });
});

describe("getSlashCommandSuggestions", () => {
  it("offers supported commands while a slash command is being typed", () => {
    expect(getSlashCommandSuggestions("/")).toEqual([
      expect.objectContaining({
        command: "/d20",
        insertion: "/d20",
      }),
      expect.objectContaining({
        command: "/roll",
        example: "/roll 1d20 + agility",
        insertion: "/roll ",
      }),
    ]);
    expect(getSlashCommandSuggestions("/d")).toEqual([
      expect.objectContaining({ command: "/d20" }),
    ]);
    expect(getSlashCommandSuggestions("/ro")).toHaveLength(1);
    expect(getSlashCommandSuggestions("/ag", { agility: 4 })).toEqual([
      expect.objectContaining({
        command: "/agility",
        description:
          "Ловкость: бросок 1d20 + 4",
        insertion: "/agility",
      }),
    ]);
  });

  it("hides suggestions for messages and completed command arguments", () => {
    expect(getSlashCommandSuggestions("hello")).toEqual([]);
    expect(getSlashCommandSuggestions("/roll 1d20")).toEqual([]);
    expect(getSlashCommandSuggestions("/unknown")).toEqual([]);
  });
});
