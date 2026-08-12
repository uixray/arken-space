import { describe, expect, it } from "vitest";
import type { CharacterMediaDto } from "@arken/contracts";
import {
  computeAdjacentSwap,
  sortMediaByOrdering,
  stepViewerItem,
} from "./character-media-gallery-state";

function makeMedia(
  overrides: Partial<CharacterMediaDto> = {},
): CharacterMediaDto {
  return {
    id: "media-1",
    campaignId: "campaign-1",
    characterId: "character-1",
    assetId: "asset-1",
    category: "OTHER",
    caption: null,
    ordering: 0,
    visibility: "OWNER_GM",
    relatedEntityId: null,
    uploadedByMembershipId: "member-1",
    detachedAt: null,
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("sortMediaByOrdering", () => {
  it("sorts by ordering ascending", () => {
    const items = [
      makeMedia({ id: "c", ordering: 2 }),
      makeMedia({ id: "a", ordering: 0 }),
      makeMedia({ id: "b", ordering: 1 }),
    ];
    expect(sortMediaByOrdering(items).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("breaks ties on id for stability", () => {
    const items = [
      makeMedia({ id: "b", ordering: 0 }),
      makeMedia({ id: "a", ordering: 0 }),
    ];
    expect(sortMediaByOrdering(items).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("does not mutate the input array", () => {
    const items = [
      makeMedia({ id: "b", ordering: 1 }),
      makeMedia({ id: "a", ordering: 0 }),
    ];
    const original = [...items];
    sortMediaByOrdering(items);
    expect(items).toEqual(original);
  });
});

describe("computeAdjacentSwap", () => {
  const items = [
    makeMedia({ id: "a", ordering: 0, revision: 1 }),
    makeMedia({ id: "b", ordering: 1, revision: 2 }),
    makeMedia({ id: "c", ordering: 2, revision: 3 }),
  ];

  it("swaps a middle item upward with its predecessor", () => {
    const result = computeAdjacentSwap(items, "b", "up");
    expect(result).toEqual([
      { id: "b", revision: 2, ordering: 0 },
      { id: "a", revision: 1, ordering: 1 },
    ]);
  });

  it("swaps a middle item downward with its successor", () => {
    const result = computeAdjacentSwap(items, "b", "down");
    expect(result).toEqual([
      { id: "b", revision: 2, ordering: 2 },
      { id: "c", revision: 3, ordering: 1 },
    ]);
  });

  it("returns null when moving the first item up", () => {
    expect(computeAdjacentSwap(items, "a", "up")).toBeNull();
  });

  it("returns null when moving the last item down", () => {
    expect(computeAdjacentSwap(items, "c", "down")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(computeAdjacentSwap(items, "missing", "up")).toBeNull();
  });
});

describe("stepViewerItem", () => {
  const items = [
    makeMedia({ id: "a", ordering: 0 }),
    makeMedia({ id: "b", ordering: 1 }),
    makeMedia({ id: "c", ordering: 2 }),
  ];

  it("steps forward", () => {
    expect(stepViewerItem(items, "a", 1)).toBe("b");
  });

  it("steps backward", () => {
    expect(stepViewerItem(items, "b", -1)).toBe("a");
  });

  it("wraps forward past the end", () => {
    expect(stepViewerItem(items, "c", 1)).toBe("a");
  });

  it("wraps backward past the start", () => {
    expect(stepViewerItem(items, "a", -1)).toBe("c");
  });

  it("returns null for an empty gallery", () => {
    expect(stepViewerItem([], "a", 1)).toBeNull();
  });

  it("falls back to the first item for an unknown active id", () => {
    expect(stepViewerItem(items, "missing", 1)).toBe("a");
  });
});
