import { describe, expect, it } from "vitest";
import { proportionalTokenSize } from "./token-resize";

describe("proportional token resize", () => {
  it("preserves aspect ratio for ordinary drags", () => {
    expect(proportionalTokenSize({ width: 50, height: 25 }, 100)).toEqual({
      width: 100,
      height: 50,
    });
  });
  it("keeps tiny and oversized drags inside the API contract", () => {
    expect(proportionalTokenSize({ width: 100, height: 50 }, 1)).toEqual({
      width: 32,
      height: 16,
    });
    expect(proportionalTokenSize({ width: 100, height: 50 }, 5000)).toEqual({
      width: 1024,
      height: 512,
    });
  });
});
