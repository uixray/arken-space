import { describe, expect, it } from "vitest";
import { humanizeFormula } from "./formula-display";
import { arkenSystem } from "@arken/system";

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
    expect(humanizeFormula("agility + agility")).toBe("Ловкость + Ловкость");
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
    // UIX-424: раньше здесь стоял `luck` — теперь это настоящая
    // характеристика. Нераспознанным должен быть ключ, которого в системе нет
    // и не появится: например, снятая с бросков «Выносливость».
    expect(humanizeFormula("1d20 + endurance")).toBe("1d20 + endurance");
    expect(humanizeFormula("1d20 + strength + endurance")).toBe(
      "1d20 + Сила + endurance",
    );
  });

  it("is word-boundary safe: a key that is a substring of another word is left alone", () => {
    // "agility" must not be humanized inside an unrelated longer identifier.
    expect(humanizeFormula("1d20 + agilityBonus")).toBe("1d20 + agilityBonus");
    expect(humanizeFormula("1d20 + superstrength")).toBe(
      "1d20 + superstrength",
    );
    // and a real key still matches when it's a standalone token even if
    // another key is a prefix of it in spelling terms.
    expect(humanizeFormula("1d20 + reaction")).toBe("1d20 + Реакция");
  });

  it("handles every stat key the system defines", () => {
    // Перечислять их здесь заново значило бы завести ещё одну копию списка —
    // ту самую, из-за которой UIX-424 и начался. Проверяется правило: каждый
    // ключ системы получает подпись, и ни один не остаётся ключом.
    for (const stat of arkenSystem.stats)
      expect(humanizeFormula(`1d20 + ${stat.key}`), stat.key).toBe(
        `1d20 + ${stat.label}`,
      );
    expect(arkenSystem.stats.length).toBeGreaterThan(0);
  });

  it("does not mangle dice notation or arithmetic operators", () => {
    expect(humanizeFormula("2d6 + strength - 1")).toBe("2d6 + Сила - 1");
  });
});
