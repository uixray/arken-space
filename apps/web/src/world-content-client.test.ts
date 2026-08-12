import { describe, expect, it } from "vitest";
import type { WorldContentMediaDto } from "@arken/contracts";
import {
  computeWorldContentMediaSwap,
  isValidWorldContentSlug,
  legalWorldContentTransitions,
  parseTagList,
  slugifyWorldContentName,
  sortWorldContentMedia,
} from "./world-content-client";

function media(id: string, ordering: number): WorldContentMediaDto {
  return {
    id,
    worldContentId: "wc-1",
    assetId: `asset-${id}`,
    caption: null,
    ordering,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("world content lifecycle transitions", () => {
  it("mirrors the server state machine", () => {
    expect(legalWorldContentTransitions("DRAFT")).toEqual([
      "PUBLISHED",
      "ARCHIVED",
    ]);
    expect(legalWorldContentTransitions("PUBLISHED")).toEqual(["ARCHIVED"]);
    expect(legalWorldContentTransitions("ARCHIVED")).toEqual(["PUBLISHED"]);
  });

  it("never offers a self-transition", () => {
    for (const lifecycle of ["DRAFT", "PUBLISHED", "ARCHIVED"] as const) {
      expect(legalWorldContentTransitions(lifecycle)).not.toContain(lifecycle);
    }
  });
});

describe("world content slug validation", () => {
  it("accepts kebab-case lowercase slugs", () => {
    expect(isValidWorldContentSlug("old-harbor")).toBe(true);
    expect(isValidWorldContentSlug("a")).toBe(true);
    expect(isValidWorldContentSlug("a1-b2-c3")).toBe(true);
  });

  it("rejects anything not matching the server's slug schema", () => {
    expect(isValidWorldContentSlug("")).toBe(false);
    expect(isValidWorldContentSlug("Old Harbor")).toBe(false);
    expect(isValidWorldContentSlug("old_harbor")).toBe(false);
    expect(isValidWorldContentSlug("-old-harbor")).toBe(false);
    expect(isValidWorldContentSlug("old-harbor-")).toBe(false);
    expect(isValidWorldContentSlug("old--harbor")).toBe(false);
    expect(isValidWorldContentSlug("a".repeat(161))).toBe(false);
  });
});

describe("slug suggestion from name", () => {
  it("derives a kebab-case slug from a display name", () => {
    expect(slugifyWorldContentName("Old Harbor")).toBe("old-harbor");
    expect(slugifyWorldContentName("  The  Sunken   Keep!!  ")).toBe(
      "the-sunken-keep",
    );
  });

  it("transliterates diacritics into plain ascii before stripping", () => {
    expect(slugifyWorldContentName("Café Rouge")).toBe("cafe-rouge");
  });

  it("produces a slug that passes the validator for typical names", () => {
    const slug = slugifyWorldContentName("Duke Aldric of the Western March");
    expect(isValidWorldContentSlug(slug)).toBe(true);
  });
});

describe("tag list parsing", () => {
  it("trims, dedupes and drops empties", () => {
    expect(parseTagList("a, b ,  , a, c")).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList("   ")).toEqual([]);
  });
});

describe("world content media ordering", () => {
  const items = [media("a", 0), media("b", 1), media("c", 2)];

  it("sorts by ordering with a stable id tie-break", () => {
    expect(
      sortWorldContentMedia([items[2]!, items[0]!, items[1]!]).map((i) => i.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("swaps a middle entry with its neighbor, without touching revision", () => {
    const swap = computeWorldContentMediaSwap(items, "b", "up");
    expect(swap).toEqual([
      { id: "b", ordering: 0 },
      { id: "a", ordering: 1 },
    ]);
  });

  it("returns null at the boundary", () => {
    expect(computeWorldContentMediaSwap(items, "a", "up")).toBeNull();
    expect(computeWorldContentMediaSwap(items, "c", "down")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(computeWorldContentMediaSwap(items, "missing", "up")).toBeNull();
  });
});
