import { describe, expect, it } from "vitest";
import { parseComposerInput } from "./chat-composer";

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
  });

  it("does not treat incomplete or arbitrary slash text as dice", () => {
    expect(parseComposerInput("/roll").kind).toBe("INVALID");
    expect(parseComposerInput("/roll-call")).toEqual({
      kind: "TEXT",
      body: "/roll-call",
    });
  });
});
