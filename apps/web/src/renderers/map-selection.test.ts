import { describe, expect, it } from "vitest";
import {
  pruneSelectionIds,
  rectanglesIntersect,
  selectionSummary,
  toggleSelectionId,
} from "./map-selection";

describe("map selection", () => {
  it("toggles an id without disturbing the other ids", () => {
    expect(toggleSelectionId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelectionId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("prunes inaccessible ids and preserves an unchanged reference", () => {
    const ids = ["a", "b"];
    expect(pruneSelectionIds(ids, new Set(ids))).toBe(ids);
    expect(pruneSelectionIds(ids, new Set(["b"]))).toEqual(["b"]);
  });

  it("uses strict rectangle overlap", () => {
    const selection = { x: 0, y: 0, width: 10, height: 10 };
    expect(
      rectanglesIntersect(selection, { x: 9, y: 9, width: 2, height: 2 }),
    ).toBe(true);
    expect(
      rectanglesIntersect(selection, { x: 10, y: 0, width: 2, height: 2 }),
    ).toBe(false);
  });

  it("reports counts by object type", () => {
    expect(selectionSummary({ tokenIds: ["a", "b"], drawingIds: ["c"] })).toBe(
      "Выбрано объектов: 3. Токенов: 2. Рисунков: 1.",
    );
  });
});
