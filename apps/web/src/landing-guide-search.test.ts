import { describe, expect, it } from "vitest";
import { canvasSections, chatSection } from "./landing-guide-content";
import {
  guideAnchor,
  resolveGuideHash,
  searchGuide,
} from "./landing-guide-search";

describe("landing guide navigation and search", () => {
  it("creates stable Russian anchors", () => {
    expect(guideAnchor("Туман войны")).toBe("guide-туман-войны");
  });
  it("only resolves known section hashes and ignores malformed encoding", () => {
    const sections = [...canvasSections, chatSection];
    expect(
      resolveGuideHash(
        "#guide-%D1%82%D1%83%D0%BC%D0%B0%D0%BD-%D0%B2%D0%BE%D0%B9%D0%BD%D1%8B",
        sections,
      ),
    ).toBe("guide-туман-войны");
    expect(resolveGuideHash("#guide-%", sections)).toBeNull();
    expect(resolveGuideHash("#guide-not-real", sections)).toBeNull();
    expect(resolveGuideHash("#other-anchor", sections)).toBeNull();
  });
  it("matches titles and actions without inventing sections", () => {
    const sections = [...canvasSections, chatSection];
    expect(searchGuide(sections, "туман").map((item) => item.title)).toEqual([
      "Туман войны",
    ]);
    expect(
      searchGuide(sections, "отменить").flatMap((item) =>
        item.shortcuts.map((row) => row.action),
      ),
    ).toContain("Отменить действие, снять выделение");
    expect(searchGuide(sections, "несуществующее")).toEqual([]);
  });
});
