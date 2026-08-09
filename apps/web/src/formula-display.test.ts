import { describe, expect, it } from "vitest";
import { humanizeFormula } from "./formula-display";

describe("humanizeFormula", () => {
  it("replaces a single stat key with its localized label", () => {
    expect(humanizeFormula("1d20 + agility")).toBe("1d20 + Ловкость");
  });

  it("replaces every stat key when a formula references several", () => {
    expect(humanizeFormula("1d20 + strength + agility")).toBe(
      "1d20 + Сила + Ловкость",
    );
  });

  it("replaces the same key when it repeats", () => {
    expect(humanizeFormula("agility + agility")).toBe(
      "Ловкость + Ловкость",
    );
  });

  it("returns formulas with no stat tokens unchanged", () => {
    expect(humanizeFormula("1d20")).toBe("1d20");
    expect(humanizeFormula("1d20 + 3")).toBe("1d20 + 3");
    expect(humanizeFormula("2d6kh1")).toBe("2d6kh1");
  });

  it("returns an empty string unchanged", () => {
    expect(humanizeFormula("")).toBe("");
  });

  it("leaves unknown/unrecognized tokens untouched instead of crashing", () => {
    expect(humanizeFormula("1d20 + luck")).toBe("1d20 + luck");
    expect(humanizeFormula("1d20 + strength + luck")).toBe(
      "1d20 + Сила + luck",
    );
  });

  it("is word-boundary safe: a key that is a substring of another word is left alone", () => {
    // "agility" must not be humanized inside an unrelated longer identifier.
    expect(humanizeFormula("1d20 + agilityBonus")).toBe(
      "1d20 + agilityBonus",
    );
    expect(humanizeFormula("1d20 + superstrength")).toBe(
      "1d20 + superstrength",
    );
    // and a real key still matches when it's a standalone token even if
    // another key is a prefix of it in spelling terms.
    expect(humanizeFormula("1d20 + reaction")).toBe("1d20 + Реакция");
  });

  it("handles every fixed stat key from the system definition", () => {
    expect(humanizeFormula("1d20 + strength")).toBe("1d20 + Сила");
    expect(humanizeFormula("1d20 + endurance")).toBe("1d20 + Выносливость");
    expect(humanizeFormula("1d20 + vitality")).toBe("1d20 + Живучесть");
    expect(humanizeFormula("1d20 + knowledge")).toBe("1d20 + Знания");
    expect(humanizeFormula("1d20 + intelligence")).toBe("1d20 + Интеллект");
    expect(humanizeFormula("1d20 + willpower")).toBe("1d20 + Сила воли");
    expect(humanizeFormula("1d20 + charisma")).toBe("1d20 + Харизма");
    expect(humanizeFormula("1d20 + attention")).toBe(
      "1d20 + Внимательность",
    );
    expect(humanizeFormula("1d20 + magicPower")).toBe("1d20 + Сила магии");
  });

  it("does not mangle dice notation or arithmetic operators", () => {
    expect(humanizeFormula("2d6 + strength - 1")).toBe("2d6 + Сила - 1");
  });
});
