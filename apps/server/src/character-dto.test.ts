import { describe, expect, it } from "vitest";
import { starterStatLayout } from "@arken/system";
import { characterDto, characterRollStats } from "./character-dto.js";

const baseCharacter = {
  id: "00000000-0000-4000-8000-000000000001",
  campaignId: "00000000-0000-4000-8000-000000000002",
  name: "Путник",
  ownerMembershipId: null,
  portraitAssetId: null,
  stats: { strength: 2 },
  statLayout: null,
  skills: [],
  spells: [],
  notes: "",
  resources: {},
  wallet: null,
  revision: 1,
} as unknown as Parameters<typeof characterDto>[0];

describe("UIX-706 character DTO", () => {
  it("does not re-add deleted starter skills on read", () => {
    const dto = characterDto(baseCharacter, [], [], starterStatLayout);
    expect(dto.skills).toEqual([]);
  });

  it("rolls missing values of layout STAT rows as 0 and keeps saved ones", () => {
    const layout = structuredClone(starterStatLayout);
    layout
      .find((group) => group.id === "combat")!
      .rows.push({ key: "bytObsosom", label: "быть обсосом", source: "STAT" });
    const stats = characterRollStats(
      { stats: { strength: 2 }, statLayout: layout } as never,
      starterStatLayout,
    );
    expect(stats.bytObsosom).toBe(0);
    expect(stats.strength).toBe(2);
    // Keys that no layout row declares are not invented.
    expect(stats).not.toHaveProperty("notOnTheSheet");
    // RESOURCE rows are pools, never formula numbers.
    expect(stats).not.toHaveProperty("physicalPower");
  });
});
