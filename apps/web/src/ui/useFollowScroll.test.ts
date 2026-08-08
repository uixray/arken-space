import { describe, expect, it } from "vitest";
import { isNearListBottom } from "./useFollowScroll";

describe("isNearListBottom", () => {
  it("treats an exact bottom scroll position as at bottom", () => {
    expect(
      isNearListBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 }),
    ).toBe(true);
  });

  it("treats a position within the threshold as at bottom", () => {
    expect(
      isNearListBottom({ scrollHeight: 1000, scrollTop: 660, clientHeight: 300 }),
    ).toBe(true);
  });

  it("treats a position beyond the threshold as not at bottom", () => {
    expect(
      isNearListBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 }),
    ).toBe(false);
  });

  it("honors a custom threshold", () => {
    expect(
      isNearListBottom(
        { scrollHeight: 1000, scrollTop: 500, clientHeight: 300 },
        250,
      ),
    ).toBe(true);
    expect(
      isNearListBottom(
        { scrollHeight: 1000, scrollTop: 400, clientHeight: 300 },
        250,
      ),
    ).toBe(false);
  });
});
