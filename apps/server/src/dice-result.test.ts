import { describe, expect, it } from "vitest";
import { normalizeDiceResult, normalizeSkillCard } from "./dice-result.js";

describe("normalizeDiceResult", () => {
  it("preserves a complete dice result", () => {
    expect(
      normalizeDiceResult({
        formula: "1d20 + agility",
        resolvedFormula: "1d20 + 3",
        terms: [{ notation: "1d20", rolls: [14], subtotal: 14 }],
        modifiers: [{ source: "agility", value: 3 }],
        total: 17,
        label: "Initiative",
      }),
    ).toMatchObject({ total: 17, terms: [{ rolls: [14] }] });
  });

  it("turns malformed legacy JSON into a non-dice message", () => {
    expect(normalizeDiceResult({ total: 20 })).toBeNull();
    expect(
      normalizeDiceResult({ terms: [], modifiers: [], total: Infinity }),
    ).toBeNull();
    expect(
      normalizeDiceResult({
        formula: "1d20",
        resolvedFormula: "1d20",
        terms: [
          {
            notation: "1d20",
            rolls: Array.from({ length: 101 }, () => 1),
            subtotal: 101,
          },
        ],
        modifiers: [],
        total: 101,
      }),
    ).toBeNull();
    expect(normalizeDiceResult(null)).toBeNull();
  });
});

describe("normalizeSkillCard", () => {
  it("accepts a versioned immutable card while keeping its dice result readable", () => {
    const result = {
      formula: "1d20",
      resolvedFormula: "1d20",
      terms: [{ notation: "1d20", rolls: [12], subtotal: 12 }],
      modifiers: [],
      total: 12,
    };
    const card = normalizeSkillCard({
      ...result,
      skillCard: {
        version: 1,
        execution: "EXECUTED",
        entry: {
          id: "11111111-1111-4111-8111-111111111111",
          revision: 3,
          sourceCatalogEntryId: null,
          kind: "ABILITY",
          name: "Flash",
          description: "",
          notes: null,
        },
        actor: {
          membershipId: "22222222-2222-4222-8222-222222222222",
          displayName: "Player",
          characterId: "33333333-3333-4333-8333-333333333333",
          characterName: "Rin",
        },
        action: {
          id: "hit",
          kind: "HIT",
          label: "Hit",
          dice: "1d20",
          advantage: false,
          consumeUse: true,
        },
        formula: "1d20",
        result,
        uses: { before: 1, after: 0, max: 1, recharge: "DAY" },
        visibility: "PUBLIC",
      },
    });
    expect(card).toMatchObject({
      version: 1,
      execution: "EXECUTED",
      uses: { before: 1, after: 0 },
    });
  });

  it("rejects an incomplete card without breaking legacy dice", () => {
    expect(normalizeSkillCard({ skillCard: { version: 1 } })).toBeNull();
  });
});
