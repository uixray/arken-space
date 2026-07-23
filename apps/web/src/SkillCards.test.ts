import { describe, expect, it } from "vitest";
import { parseSkillCard } from "./SkillCards";

const dice = {
  total: 17,
  skillCard: {
    version: 1,
    execution: "EXECUTED",
    actor: { characterName: "Aria" },
    entry: {
      id: "entry-1",
      name: "Flame Lash",
      kind: "ABILITY",
      description: "A controlled burst.",
      revision: 4,
    },
    action: {
      id: "lash",
      label: "Attack",
      kind: "HIT",
      dice: "1d20",
      consumeUse: true,
    },
    formula: "1d20 + agility",
    result: { total: 17, resolvedFormula: "1d20 + 3" },
    uses: { before: 2, after: 1, max: 2, recharge: "DAY" },
  },
};

describe("parseSkillCard", () => {
  it("keeps a versioned immutable action snapshot", () => {
    expect(parseSkillCard(dice)).toMatchObject({
      mode: "EXECUTE",
      characterName: "Aria",
      entry: { name: "Flame Lash", revision: 4 },
      action: { id: "lash", formula: "1d20 + agility" },
      result: { total: 17 },
      uses: { before: 2, after: 1, max: 2 },
    });
  });

  it("identifies passive shares without an action or resource mutation", () => {
    expect(
      parseSkillCard({
        skillCard: {
          version: 1,
          execution: "SHARED",
          entry: { id: "entry-2", name: "Lore", kind: "SKILL" },
        },
      }),
    ).toMatchObject({ mode: "SHARE", action: null, uses: null });
  });

  it("falls back for legacy, malformed, and unknown card versions", () => {
    expect(parseSkillCard({ total: 12 })).toBeNull();
    expect(parseSkillCard({ skillCard: { version: 2 } })).toBeNull();
    expect(
      parseSkillCard({
        skillCard: { version: 1, mode: "EXECUTE", entry: { id: "x" } },
      }),
    ).toBeNull();
  });

  it("retains a removed-source marker entirely from the event snapshot", () => {
    expect(
      parseSkillCard({
        ...dice,
        skillCard: {
          ...dice.skillCard,
          entry: { ...dice.skillCard.entry, sourceRemoved: true },
        },
      })?.entry.sourceRemoved,
    ).toBe(true);
  });

  it("parses the separate DTO skillCard projection", () => {
    expect(parseSkillCard({ skillCard: dice.skillCard })).toMatchObject({
      mode: "EXECUTE",
      entry: { name: "Flame Lash" },
      result: { total: 17 },
    });
  });
});
